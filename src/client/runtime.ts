import { Network, type Channel, type LinkStats } from './network.ts';
import { ClockSync, now } from './engine/timing.ts';
import {
  DisplayPlayback,
  SNAPSHOT_RETRY_MESSAGE,
} from './playback/display-playback.ts';
import { games, findGame } from './minigames/catalog.ts';
import { catalogSnapshotPolicy } from './engine/snapshots.ts';
import { ProgressAssembler } from './engine/history.ts';
import { completedResults } from './engine/progress.ts';
import { freezeSnapshot } from './game-screen/screen.ts';
import type { ScreenPort, ScreenFrame } from './game-screen/port.ts';
import type {
  Progress,
  ReadonlyDeep,
  RoundSnapshot,
  PresentationEvent,
} from './api/index.ts';
import { SessionAuthority } from './engine/session.ts';
import {
  encodeInput,
  decodeInput,
  newer,
  type InputFrame,
} from './engine/protocol.ts';
import { Motion } from './controls/motion/provider.ts';
import type { MotionStatus } from './controls/motion/contracts.ts';
import { channelOf, PRESS_SLOTS, usesPressSlot } from './controls/registry.ts';
import {
  parseActivationValue,
  parseControlValue,
  valueFitsEnvelope,
} from './controls/value.ts';
import type { ControlPort, ControllerConfig, Widget } from './controls/api.ts';
import type { WidgetValueMessage } from './engine/reliable-input.ts';
import {
  clampGain,
  DEFAULT_GAIN,
  GyroPointer,
  PointerSmoother,
} from './controls/motion/pointer.ts';

import type { Message } from './engine/messages.ts';
import type { Point } from '../core/types.ts';
import { type Identity, type Role, type Roster } from '../shared/room.ts';
export interface RuntimeView {
  identity: Identity | null;
  roster: Roster;
  status: string;
  warning: string;
  ended: boolean;
  state: ReadonlyDeep<RoundSnapshot<object>> | null;
  progress: ReadonlyDeep<Progress>;
  gameId: string | null;
  mode: string | null;
  roundId: string | null;
  roundError: string | null;
  config: ControllerConfig | null;
  phase: string;
  /** Local control lifetime, independent of the wire configuration generation. */
  inputEpoch: number;
  D: number;
  limitingVenue: string | null;
  telemetry: Message | null;
  links: Record<string, LinkStats>;
  /** The aim settings panel (sensitivity, recenter) is open. */
  adjustingAim: boolean;
  sensitivity: number;
  motionEnabled: boolean;
  motionStatus: MotionStatus;
  sensorHz: number;
  history: ReturnType<typeof completedResults>;
  panelLatency: number | null;
  wakeLock: boolean;
  controllerPath: 'venue' | 'direct-to-session';
}
// Pointer sensitivity is a property of the player and phone, not the room.
const POINTER_GAIN_KEY = 'controlla:pointer-gain';
export interface JoinOptions {
  role: Role;
  room?: string;
  venueId?: string;
  name?: string;
  endpoint: string;
  token?: string;
}
const WIDGET_THROTTLE_MS = 30;
export class Runtime {
  network: Network;
  clock = new ClockSync();
  private readonly playback: DisplayPlayback;
  private progress = new ProgressAssembler();
  private endedAuthoritySummary: unknown = null;
  readonly screenPort: ScreenPort = {
    advanceFrame: () => this.advanceFrame(),
    presented: (roundId, eventIds) => this.presented(roundId, eventIds),
  };
  readonly motion: Motion;
  private authority: SessionAuthority | null = null;
  private listeners = new Set<() => void>();
  private loop: ReturnType<typeof setInterval> | null = null;
  private diagnosticsTimer: ReturnType<typeof setInterval> | null = null;
  private syncTimer: ReturnType<typeof setInterval> | null = null;
  private stopped = false;
  private lastUi = 0;
  private lastSend = 0;
  private nextSend = 0;
  private pointerSmoother = new PointerSmoother();
  private seq = 0;
  private latestPoint: Point = { x: 0.5, y: 0.5 };
  private velocity: Point = { x: 0, y: 0 };
  private buttonState = 0;
  private edges = [0, 0, 0, 0];
  private edgeTimes = [0, 0, 0, 0];
  private localCursors = new Map<
    string,
    { point: Point; at: number; color: string; name: string }
  >();
  // Cursor admission mirrors the local phone's config/ACK and binary ordering.
  // Remote venues observe the same trusted config as they relay it to the phone.
  private cursorInputs = new Map<
    string,
    { generation: number; ready: boolean; seq: number | null }
  >();
  private gyroPointer = new GyroPointer();
  private lastPointerSample: number | null = null;
  private motionEpoch = -1;
  private lastShakeSample = -1;
  private pageSuspended = false;
  private motionCapabilitiesKey = '';
  private pointerPoint: Point = { x: 0.5, y: 0.5 };
  private recenters = 0;
  private audio: AudioContext | null = null;
  private wake: WakeLockSentinel | null = null;
  private wakePending = false;
  private disconnects: { at: number; status: string }[] = [];
  private sendRate = 60;
  private bootId = crypto.randomUUID();
  private joinedAt = now();
  private lastShake = 0;
  private widgetLastSent = new Map<string, number>();
  // Throttled values that arrived inside the window; sent when it closes so
  // the last value (e.g. a stick returning to centre) is never dropped.
  private widgetPending = new Map<
    string,
    { sample: WidgetValueMessage; timer: ReturnType<typeof setTimeout> }
  >();
  private widgetLatest = new Map<string, WidgetValueMessage>();
  private widgetSequences = new Map<string, number>();
  view: RuntimeView = {
    identity: null,
    roster: { players: [], venues: [] },
    status: 'Connecting…',
    warning: '',
    ended: false,
    state: null,
    progress: freezeSnapshot({ revision: 0, totals: {}, rounds: [] }),
    gameId: null,
    mode: null,
    roundId: null,
    roundError: null,
    config: null,
    phase: 'lobby',
    inputEpoch: 0,
    D: 0,
    limitingVenue: null,
    telemetry: null,
    links: {},
    adjustingAim: false,
    sensitivity: DEFAULT_GAIN,
    motionEnabled: false,
    motionStatus: 'prompt',
    sensorHz: 0,
    history: [],
    panelLatency: null,
    wakeLock: false,
    controllerPath: 'venue',
  };
  constructor(
    public options: JoinOptions,
    motion = new Motion(),
  ) {
    this.playback = new DisplayPlayback(
      catalogSnapshotPolicy(games),
      (gameId, mode) =>
        !!findGame(gameId)?.modes.some((candidate) => candidate.id === mode),
      {
        acknowledge: (id) => this.sendUp({ type: 'snapshotAck', id }),
        resync: () => this.sendUp({ type: 'resync' }),
        venueStats: (delay) => this.sendUp({ type: 'venueStats', delay }),
        presented: (roundId, eventId, at) =>
          this.sendUp({ type: 'presented', roundId, eventId, at }),
        recoveryWarning: (active) => {
          if (active) this.warn(SNAPSHOT_RETRY_MESSAGE);
          else if (this.view.warning === SNAPSHOT_RETRY_MESSAGE) {
            this.view.warning = '';
            this.notify();
          }
        },
        playEvent: (event) => this.playEvent(event),
      },
    );
    this.motion = motion;
    this.network = new Network(options.endpoint, options);
    this.network.onWelcome = (i) => this.welcome(i);
    this.network.onRoster = (r) => this.roster(r);
    this.network.onMessage = (f, c, d) => this.receive(f, c, d);
    this.network.onWarning = (m) => this.warn(m);
    this.network.onStatus = (s) => {
      this.view.status = s;
      if (s === 'Reconnecting…' || s === 'Reload required') {
        this.motion.suspend();
        this.playback.disconnect();
        this.clearLocalCursors();
        this.clearWidgetInput();
        this.buttonState = 0;
        this.disconnects.push({ at: Date.now(), status: s });
      }
      this.notify();
    };
    this.motion.subscribe(() => this.motionChanged());
    if (document.hidden) this.motion.suspend();
    this.motionChanged();
    this.network.onEnded = (reason) => {
      this.view.ended = true;
      this.playback.end();
      this.clearLocalCursors();
      this.warn(reason);
      this.view.status = 'Session ended';
      this.motion.dispose();
      this.view.motionStatus = 'disposed';
      this.clearWidgetInput();
      this.buttonState = 0;
      this.endedAuthoritySummary =
        this.authority?.summary() ?? this.endedAuthoritySummary;
      this.authority?.dispose();
      this.authority = null;
      this.notify();
    };
  }
  private motionChanged() {
    if (this.stopped || this.view.ended) return;
    const snapshot = this.motion.getSnapshot();
    this.view.motionEnabled = snapshot.permission === 'granted';
    this.view.motionStatus = snapshot.status;
    const capabilities = this.motion.capabilities;
    const key = JSON.stringify(capabilities);
    if (key !== this.motionCapabilitiesKey) {
      this.motionCapabilitiesKey = key;
      if (
        this.view.identity?.role === 'controller' &&
        this.view.status === 'Connected'
      )
        this.sendUp({ type: 'capabilities', capabilities });
    }
    this.notify();
  }
  subscribe(fn: () => void) {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }
  private notify() {
    this.view = { ...this.view };
    for (const fn of this.listeners) fn();
  }
  warn(message: string) {
    this.view.warning = message;
    this.notify();
  }
  start() {
    this.network.connect();
    this.loop = setInterval(() => this.tick(), 1000 / 120);
    this.diagnosticsTimer = setInterval(() => void this.diagnostics(), 2000);
    this.syncTimer = setInterval(() => this.probe(), 1500);
    document.addEventListener('visibilitychange', this.visibility);
    window.addEventListener('beforeunload', this.beforeUnload);
    window.addEventListener('pagehide', this.pageHide);
    window.addEventListener('pageshow', this.pageShow);
  }
  private welcome(identity: Identity) {
    this.clearLocalCursors();
    // A request sent on the previous connection may never have reached authority.
    // The next missing-base update must be able to request a fresh snapshot again.
    this.playback.reconnect();
    this.view.identity = identity;
    this.view.warning = '';
    try {
      localStorage.setItem(
        `controlla:resume:${identity.role}:${identity.room}:${identity.venueId}`,
        JSON.stringify(identity),
      );
      if (identity.role === 'controller') {
        const stored = localStorage.getItem(POINTER_GAIN_KEY);
        if (stored) this.view.sensitivity = clampGain(Number(stored));
        this.gyroPointer.gain = this.view.sensitivity;
      }
    } catch {
      /* Private browsing can disallow storage. */
    }
    if (identity.role === 'host' && !this.authority)
      this.authority = new SessionAuthority(identity.id, {
        toPlayer: (id, msg) => this.toPlayer(id, msg),
        toVenue: (id, msg) => this.toVenue(id, 'ctrl', msg),
        snapshot: (id, msg) => this.toVenue(id, 'snapshot', msg),
        event: (id, event) =>
          this.toVenue(id, 'events', { type: 'event', event }),
        warning: (msg) => this.warn(msg),
      });
    for (let i = 0; i < 10; i++)
      setTimeout(() => {
        if (!this.stopped) this.probe();
      }, i * 80);
    this.notify();
  }
  private roster(roster: Roster) {
    this.view.roster = roster;
    for (const id of this.cursorInputs.keys())
      if (
        !roster.players.some(
          (player) =>
            player.id === id &&
            player.connected &&
            player.venueId === this.view.identity?.id,
        )
      ) {
        this.cursorInputs.delete(id);
        this.localCursors.delete(id);
      }
    this.authority?.setRoster(roster);
    const me = this.view.identity;
    if (me?.role === 'display') this.sendUp({ type: 'venueHello' });
    if (me?.role === 'controller') {
      const venue = roster.venues.find((v) => v.id === me.venueId);
      if (!venue?.connected) {
        this.view.status = 'Reconnecting — your screen went away';
        this.motion.suspend();
        this.clearWidgetInput();
        this.buttonState = 0;
      } else {
        this.view.status = 'Connected';
        if (!document.hidden && !this.pageSuspended) this.motion.resume();
        this.sendUp({ type: 'hello', bootId: this.bootId });
        this.sendUp({
          type: 'capabilities',
          capabilities: this.motion.capabilities,
        });
        if (this.view.config) this.applySensorConfig();
      }
    }
    this.notify();
  }
  private toVenue(id: string, channel: Channel, msg: Message) {
    if (id === this.view.identity?.id)
      queueMicrotask(() => this.displayMessage(channel, structuredClone(msg)));
    else this.network.send(id, channel, msg);
  }
  private toPlayer(id: string, message: Message) {
    const p = this.view.roster.players.find((p) => p.id === id);
    if (!p) return;
    if (p.venueId === this.view.identity?.id) {
      this.cursorConfig(id, message);
      this.network.send(id, 'ctrl', message);
    } else
      this.network.send(p.venueId, 'ctrl', {
        type: 'toController',
        target: id,
        message,
      });
  }
  private sendUp(message: Message) {
    const me = this.view.identity;
    if (!me || this.view.ended) return;
    if (me.role === 'host') this.authority?.control(me.id, message);
    else if (me.role === 'display')
      this.network.send(me.hostId, 'ctrl', message);
    else
      this.network.send(
        this.view.controllerPath === 'direct-to-session'
          ? me.hostId
          : me.venueId,
        'ctrl',
        message,
      );
  }
  private receive(from: string, channel: Channel, raw: Message | ArrayBuffer) {
    const data = raw as Message;
    const me = this.view.identity;
    if (!me) return;
    if (me.role === 'controller') {
      if (channel === 'ctrl' && (from === me.venueId || from === me.hostId))
        this.controllerMessage(data);
      return;
    }
    const player = this.view.roster.players.find(
      (p) => p.id === from && (p.venueId === me.id || me.role === 'host'),
    );
    if (player) {
      if (channel === 'input' && data instanceof ArrayBuffer) {
        let frame: InputFrame;
        try {
          frame = decodeInput(data, this.time());
        } catch {
          return;
        }
        const cursor = this.cursorInputs.get(from);
        const time = this.time();
        if (
          !this.stopped &&
          !this.view.ended &&
          player.connected &&
          player.venueId === me.id &&
          cursor?.ready &&
          frame.generation === cursor.generation &&
          frame.time <= time + 100 &&
          time - frame.time <= 2000 &&
          (cursor.seq === null || newer(frame.seq, cursor.seq))
        ) {
          cursor.seq = frame.seq;
          this.localCursors.set(from, {
            point: { x: frame.x, y: frame.y },
            at: now(),
            color: player.color,
            name: player.name,
          });
        }
        if (me.role === 'host') this.authority?.input(from, data);
        else {
          const packet = new Uint8Array(data.byteLength + 1);
          packet[0] = player.seat;
          packet.set(new Uint8Array(data), 1);
          this.network.send(me.hostId, 'input', packet.buffer);
        }
      } else if (channel === 'ctrl') {
        const cursor = this.cursorInputs.get(from);
        if (cursor && player.connected && player.venueId === me.id) {
          if (data.type === 'ready' && data.generation === cursor.generation)
            cursor.ready = true;
          else if (data.type === 'hello') {
            cursor.ready = false;
            this.localCursors.delete(from);
          }
        }
        if (me.role === 'host') this.authority?.control(from, data);
        else
          this.network.send(me.hostId, 'ctrl', {
            type: 'fromController',
            playerId: from,
            message: data,
          });
      }
      return;
    }
    if (me.role === 'host') {
      const venue = this.view.roster.venues.find(
        (v) => v.id === from && v.connected,
      );
      if (!venue) return;
      if (
        channel === 'input' &&
        data instanceof ArrayBuffer &&
        data.byteLength === 48
      ) {
        const packet = new Uint8Array(data),
          p = this.view.roster.players.find(
            (p) => p.seat === packet[0] && p.venueId === from,
          );
        if (p) this.authority?.input(p.id, data.slice(1));
      } else if (channel === 'ctrl') {
        if (data.type === 'fromController') {
          const p = this.view.roster.players.find(
            (p) => p.id === data.playerId && p.venueId === from,
          );
          if (p) this.authority?.control(p.id, data.message);
        } else this.authority?.control(from, data);
      }
      return;
    }
    if (from === me.hostId) {
      if (channel === 'ctrl' && data.type === 'toController') {
        if (
          this.view.roster.players.some(
            (p) => p.id === data.target && p.venueId === me.id,
          )
        ) {
          this.cursorConfig(data.target, data.message);
          this.network.send(data.target, 'ctrl', data.message);
        }
      } else this.displayMessage(channel, data);
    }
  }
  private cursorConfig(playerId: string, message: Message) {
    if (
      this.stopped ||
      this.view.ended ||
      !message ||
      message.type !== 'config' ||
      message.config?.schemaVersion !== 1 ||
      !Number.isInteger(message.config.generation) ||
      message.config.generation < 0 ||
      message.config.generation > 65535 ||
      !this.view.roster.players.some(
        (player) =>
          player.id === playerId &&
          player.connected &&
          player.venueId === this.view.identity?.id,
      )
    )
      return;
    const generation = message.config.generation as number;
    if (this.cursorInputs.get(playerId)?.generation === generation) return;
    this.cursorInputs.set(playerId, { generation, ready: false, seq: null });
    this.localCursors.delete(playerId);
  }
  private clearLocalCursors() {
    this.cursorInputs.clear();
    this.localCursors.clear();
  }
  private clockReply(msg: Message) {
    this.clock.observe(msg.t0, msg.t1, msg.t2, now());
  }
  private acceptProgress(msg: Message) {
    const progress = this.progress.receive(msg);
    if (!progress) return;
    this.view.progress = freezeSnapshot(structuredClone(progress));
    this.view.history = completedResults(progress);
    this.notify();
  }
  private acceptPhase(msg: Message) {
    const phase = this.playback.acceptPhase({
      phase: msg.phase,
      roundId: msg.roundId,
      gameId: msg.gameId,
      mode: msg.mode,
      error: msg.error,
    });
    if (!phase) return;
    Object.assign(this.view, phase);
    this.notify();
  }
  private displayMessage(channel: Channel, msg: Message) {
    if (channel === 'snapshot' && msg.type === 'snapshot') {
      this.playback.acceptSnapshot(
        msg.snapshot,
        msg.delay,
        msg.limitingVenue,
        this.time(),
        this.view.identity?.role === 'host' || this.clock.samples >= 10,
      );
      this.view.D = this.playback.delay;
      this.view.limitingVenue = this.playback.limitingVenue;
    } else if (channel === 'events' && msg.type === 'event') {
      this.playback.acceptEvent(msg.event);
    } else if (msg.type === 'clockReply') this.clockReply(msg);
    else if (msg.type === 'phase') this.acceptPhase(msg);
    else if (msg.type === 'progressBatch') this.acceptProgress(msg);
    else if (msg.type === 'telemetry') {
      this.view.telemetry = msg;
      this.notify();
    }
  }
  private controllerMessage(msg: Message) {
    if (msg.type === 'clockReply') this.clockReply(msg);
    else if (msg.type === 'config') {
      const config = msg.config as ControllerConfig;
      if (config.schemaVersion !== 1 || config.widgets.length > 24) {
        this.warn('Unsupported controller configuration');
        return;
      }
      const changed =
        this.view.config?.generation !== config.generation ||
        this.view.config?.configId !== config.configId;
      this.view.config = config;
      if (changed) {
        this.clearWidgetInput(true);
        this.edges = [0, 0, 0, 0];
        this.edgeTimes = [0, 0, 0, 0];
        this.buttonState = 0;
        this.seq = 0;
        this.nextSend = 0;
        this.pointerSmoother.reset();
        this.lastPointerSample = null;
        this.latestPoint = config.sensors.pointer.enabled
          ? { ...this.pointerPoint }
          : config.widgets.some((w) => w.space === 'normalized')
            ? { x: 0.5, y: 0.5 }
            : { x: 0, y: 0 };
      }
      this.applySensorConfig();
      this.sendUp({ type: 'ready', generation: config.generation });
      this.notify();
    } else if (msg.type === 'phase') this.acceptPhase(msg);
    else if (msg.type === 'progressBatch') this.acceptProgress(msg);
    else if (msg.type === 'error') this.warn(msg.message);
  }
  private applySensorConfig() {
    const c = this.view.config;
    if (!c) return;
    // A config may request sampling, but never overrides suspension/disposal.
    this.motion.start();
    this.sendRate = c.sensors.pointer.enabled
      ? Math.min(
          c.sensors.pointer.rateHz,
          this.motion.capabilities.refreshRateHz,
        )
      : 60;
  }
  private probe() {
    if (this.view.identity?.role !== 'host')
      this.sendUp({ type: 'clock', t0: now() });
  }
  time() {
    return this.view.identity?.role === 'host' ? now() : this.clock.time(now());
  }
  private tick() {
    if (this.stopped || this.view.ended) return;
    const local = now(),
      time = this.time();
    this.authority?.tick(local);
    const me = this.view.identity;
    if (
      me?.role === 'controller' &&
      this.view.config &&
      this.view.status === 'Connected' &&
      !document.hidden &&
      !this.pageSuspended
    ) {
      const config = this.view.config;
      const motion = this.motion.getSnapshot();
      if (motion.epoch !== this.motionEpoch) {
        this.motionEpoch = motion.epoch;
        this.lastPointerSample = null;
        this.gyroPointer.resumeAt(this.pointerPoint);
        this.pointerSmoother.reset();
      }
      let point = this.latestPoint;
      if (me.venueId !== me.hostId && local - this.joinedAt > 8000) {
        this.view.controllerPath = this.network.isOpen(me.venueId)
          ? 'venue'
          : 'direct-to-session';
        if (this.view.controllerPath === 'direct-to-session')
          this.network.ensureHostFallback();
      }
      if (
        config.sensors.shake.enabled &&
        motion.accelFresh &&
        motion.sequence !== this.lastShakeSample &&
        Math.abs(Math.hypot(...motion.gravity) - 9.81) >
          config.sensors.shake.thresholdG * 9.81 &&
        local - this.lastShake > 600
      ) {
        this.lastShake = local;
        const shake = config.widgets.find((w) => w.type === 'shake');
        if (shake) this.action(shake.action, 1, config.generation);
      }
      this.lastShakeSample = motion.sequence;
      if (config.sensors.pointer.enabled && motion.pointerFresh) {
        // Integrate once per motion sample so a stalled sensor never replays
        // its last rate.
        const sampleAt = motion.at!;
        if (sampleAt !== this.lastPointerSample) {
          const dt =
            this.lastPointerSample !== null
              ? Math.min(0.05, (sampleAt - this.lastPointerSample) / 1000)
              : 0;
          this.lastPointerSample = sampleAt;
          this.pointerPoint = this.pointerSmoother.sample(
            this.gyroPointer.update(
              [...motion.rate],
              [...motion.up],
              dt,
              sampleAt,
            ),
            sampleAt,
          );
        }
        point = this.pointerPoint;
      } else if (config.sensors.tilt.enabled)
        point = motion.accelFresh ? motion.tilt : { x: 0, y: 0 };
      if (local >= this.nextSend) {
        const interval = 1000 / this.sendRate;
        // Keep the deadline anchored instead of accumulating timer overshoot.
        // After a suspension, send once without trying to catch up old frames.
        this.nextSend =
          local - this.nextSend > interval
            ? local + interval
            : this.nextSend + interval;
        const dt = Math.max(0.001, (local - this.lastSend) / 1000);
        this.velocity = {
          x: Math.max(-8, Math.min(8, (point.x - this.latestPoint.x) / dt)),
          y: Math.max(-8, Math.min(8, (point.y - this.latestPoint.y) / dt)),
        };
        this.latestPoint = point;
        this.lastSend = local;
        const frame: InputFrame = {
          seq: this.seq++ % 65536,
          time,
          generation: config.generation,
          ...point,
          vx: this.velocity.x,
          vy: this.velocity.y,
          buttons: this.buttonState,
          edges: this.edges,
          edgeTimes: this.edgeTimes,
          confidence: config.sensors.pointer.enabled
            ? motion.confidence
            : config.sensors.tilt.enabled
              ? Number(motion.accelFresh)
              : 1,
        };
        this.network.send(
          this.view.controllerPath === 'direct-to-session'
            ? me.hostId
            : me.venueId,
          'input',
          encodeInput(frame),
        );
      }
    }
    if (local - this.lastUi > 100) {
      this.lastUi = local;
      this.view.sensorHz = this.motion.rateHz || 0;
      this.notify();
    }
  }
  async enableMotion() {
    if (this.stopped || this.view.ended) return;
    await this.motion.enable();
    if (this.stopped || this.view.ended) return;
    this.motionChanged();
  }
  async unlock() {
    if (this.stopped || this.view.ended) return;
    try {
      this.audio ??= new AudioContext();
      await this.audio.resume();
    } catch {
      /* Audio may be unavailable. */
    }
    if (!this.stopped && !this.view.ended) await this.acquireWake();
  }
  private async acquireWake() {
    if (
      this.stopped ||
      this.view.ended ||
      this.wakePending ||
      this.wake ||
      !('wakeLock' in navigator)
    )
      return;
    this.wakePending = true;
    try {
      const wake = await navigator.wakeLock.request('screen');
      if (this.stopped || this.view.ended) {
        await wake.release();
        return;
      }
      this.wake = wake;
      this.view.wakeLock = true;
      wake.addEventListener('release', () => {
        if (this.wake === wake) {
          this.wake = null;
          this.view.wakeLock = false;
        }
      });
    } catch {
      this.view.wakeLock = false;
    } finally {
      this.wakePending = false;
    }
  }
  previewPoint() {
    return { ...this.latestPoint };
  }
  setPoint(point: Point) {
    this.latestPoint = point;
  }
  /** A view retains its configuration epoch even after React starts unmounting it. */
  portFor(widget: Widget, generation: number): ControlPort {
    const epoch = this.view.inputEpoch;
    const active = () =>
      epoch === this.view.inputEpoch &&
      this.view.config?.generation === generation;
    return {
      value: (value) => {
        if (active()) this.action(widget.action, value, generation);
      },
      press: (down) => {
        if (active()) this.press(widget.action, down, generation);
      },
      haptic: (ms) => {
        if (active()) this.haptic(ms);
      },
    };
  }
  action(
    action: string,
    raw: unknown,
    generation = this.view.config?.generation,
  ) {
    const config = this.view.config;
    if (
      !config ||
      generation !== config.generation ||
      this.stopped ||
      this.view.ended ||
      document.hidden ||
      this.view.status !== 'Connected' ||
      !valueFitsEnvelope(raw)
    )
      return;
    const widget = config.widgets.find((w) => w.action === action);
    if (!widget || channelOf(widget.type).channel === 'press') return;
    const value = parseControlValue(widget.type, raw);
    if (value === undefined) return;
    const sample: WidgetValueMessage = {
      type: 'widget',
      action,
      generation: config.generation,
      seq: (this.widgetSequences.get(action) ?? -1) + 1,
      time: this.time(),
      value,
    };
    this.widgetSequences.set(action, sample.seq);
    this.widgetLatest.set(action, sample);
    const { throttle, drivesPointer } = channelOf(widget.type),
      at = now(),
      wait =
        WIDGET_THROTTLE_MS -
        (at - (this.widgetLastSent.get(action) ?? -Infinity));
    if (!throttle || wait <= 0) this.sendWidget(sample);
    else {
      const pending = this.widgetPending.get(action);
      if (pending) pending.sample = sample;
      else
        this.widgetPending.set(action, {
          sample,
          timer: setTimeout(() => this.flushWidget(action), wait),
        });
    }
    if (drivesPointer) {
      const point = value as Point;
      this.setPoint(
        widget.space === 'normalized'
          ? { x: (point.x + 1) / 2, y: (point.y + 1) / 2 }
          : { ...point },
      );
    } else if (widget.type === 'shake') {
      this.press(action, true, generation);
      this.press(action, false, generation);
    }
  }
  private sendWidget(sample: WidgetValueMessage) {
    const pending = this.widgetPending.get(sample.action);
    if (pending) clearTimeout(pending.timer);
    this.widgetPending.delete(sample.action);
    if (
      sample.generation !== this.view.config?.generation ||
      this.stopped ||
      this.view.ended ||
      document.hidden ||
      this.view.status !== 'Connected'
    )
      return;
    this.widgetLastSent.set(sample.action, now());
    this.sendUp(structuredClone(sample));
  }
  private flushWidget(action: string) {
    const pending = this.widgetPending.get(action);
    if (pending) this.sendWidget(pending.sample);
  }
  private clearWidgetInput(resetSequence = false) {
    this.view.inputEpoch++;
    for (const { timer } of this.widgetPending.values()) clearTimeout(timer);
    this.widgetPending.clear();
    this.widgetLatest.clear();
    this.widgetLastSent.clear();
    // Retiring a held touch control also retires its legacy continuous frame.
    // Its old unmount callback is deliberately inert and cannot send a release.
    const config = this.view.config;
    if (!config?.sensors.pointer.enabled && !config?.sensors.tilt.enabled) {
      this.latestPoint = config?.widgets.some(
        (widget) => widget.space === 'normalized',
      )
        ? { x: 0.5, y: 0.5 }
        : { x: 0, y: 0 };
      this.velocity = { x: 0, y: 0 };
    }
    if (resetSequence) this.widgetSequences.clear();
  }
  press(
    action: string,
    down: boolean,
    generation = this.view.config?.generation,
  ) {
    const config = this.view.config;
    if (
      !config ||
      generation !== config.generation ||
      this.stopped ||
      this.view.ended ||
      document.hidden ||
      this.view.status !== 'Connected'
    )
      return;
    const buttons = config.widgets.filter((w) => usesPressSlot(w.type));
    const button = buttons.findIndex((w) => w.action === action);
    if (button < 0 || button >= PRESS_SLOTS) return;
    const mask = 1 << button;
    if (down && !(this.buttonState & mask)) {
      const both = channelOf(buttons[button].type).channel === 'both';
      const sample = this.widgetLatest.get(action);
      const value =
        both && sample
          ? parseActivationValue(buttons[button].type, sample.value)
          : undefined;
      if (
        both &&
        (!sample ||
          sample.generation !== config.generation ||
          value === undefined)
      )
        return;
      this.flushWidget(action);
      if (config.sensors.pointer.enabled) {
        this.pointerPoint = this.latestPoint =
          this.gyroPointer.holdForPress(now());
        this.pointerSmoother.reset();
      }
      this.edges[button] = (this.edges[button] + 1) % 256;
      this.edgeTimes[button] = this.time();
      this.sendUp({
        type: 'press',
        press: {
          generation: config.generation,
          button,
          counter: this.edges[button],
          time: this.edgeTimes[button],
          ...this.latestPoint,
          ...(both ? { value } : {}),
        },
      });
    }
    this.buttonState = down
      ? this.buttonState | mask
      : this.buttonState & ~mask;
  }
  haptic(ms = 10) {
    if (this.view.config?.haptics.enabled) navigator.vibrate?.(ms);
  }
  beginAdjustAim() {
    if (!this.view.motionEnabled) {
      this.warn('Tap Enable motion before adjusting your aim.');
      return;
    }
    this.view.warning = '';
    this.view.adjustingAim = true;
    this.motion.start();
    this.notify();
  }
  finishAdjustAim() {
    this.view.adjustingAim = false;
    this.notify();
  }
  /** Screen widths per radian of turn; takes effect immediately. */
  setSensitivity(gain: number) {
    this.view.sensitivity = this.gyroPointer.gain = clampGain(gain);
    try {
      localStorage.setItem(POINTER_GAIN_KEY, String(this.view.sensitivity));
    } catch {
      /* Private browsing can disallow storage; the setting lasts this session. */
    }
    this.notify();
  }
  recenter() {
    this.gyroPointer.recenter();
    this.pointerSmoother.reset();
    this.pointerPoint = this.latestPoint = this.gyroPointer.current;
    this.recenters++;
    this.notify();
  }
  startGame(id: string, mode: string) {
    try {
      this.authority?.start(id, mode);
      this.view.warning = '';
      this.notify();
    } catch (error) {
      this.warn(error instanceof Error ? error.message : String(error));
    }
  }
  abortGame() {
    this.authority?.abort();
  }
  presented(roundId: string, eventIds: readonly string[]) {
    this.playback.presented(roundId, eventIds, this.time());
  }
  snapshotMetrics() {
    return this.playback.metrics();
  }
  private advanceFrame(): ReadonlyDeep<ScreenFrame> {
    const frame = this.playback.advanceFrame(
      this.time(),
      Object.fromEntries(
        this.cursors().map((cursor) => [cursor.id, { ...cursor.point }]),
      ),
    );
    this.view.state = this.playback.sampledSnapshot;
    return frame;
  }
  renderState() {
    return this.advanceFrame().snapshot;
  }
  cursors() {
    return [...this.localCursors.entries()]
      .filter(([, c]) => now() - c.at < 1000)
      .map(([id, c]) => ({ id, ...c }));
  }
  private playEvent(event: PresentationEvent) {
    if (!['hit', 'prompt', 'end'].includes(event.kind)) return;
    if (!this.audio || this.audio.state !== 'running') return;
    try {
      const oscillator = this.audio.createOscillator(),
        gain = this.audio.createGain();
      oscillator.frequency.value =
        event.kind === 'hit' ? 680 : event.kind === 'prompt' ? 420 : 250;
      gain.gain.setValueAtTime(0.04, this.audio.currentTime);
      gain.gain.exponentialRampToValueAtTime(
        0.001,
        this.audio.currentTime + 0.1,
      );
      oscillator.connect(gain);
      gain.connect(this.audio.destination);
      oscillator.start();
      oscillator.stop(this.audio.currentTime + 0.12);
    } catch {
      /* Closed audio context. */
    }
  }
  private async diagnostics() {
    if (this.view.ended) return;
    this.view.links = await this.network.stats();
    if (this.view.identity?.role === 'controller') {
      this.sendUp({
        type: 'clockStats',
        offset: this.clock.offset,
        error: Number.isFinite(this.clock.error) ? this.clock.error : null,
        rtt: this.clock.rtts.summary(),
        sensorHz: this.motion.rateHz,
        pointerGain: this.view.sensitivity,
        recenters: this.recenters,
        transport:
          this.view.links[
            this.view.controllerPath === 'direct-to-session'
              ? this.view.identity.hostId
              : this.view.identity.venueId
          ] ?? null,
        path: this.view.controllerPath,
      });
    }
    this.notify();
  }
  setPanelLatency(value: number | null) {
    this.view.panelLatency = value;
    this.notify();
  }
  exportSummary() {
    const metrics = this.snapshotMetrics();
    const summary = {
      version: 2,
      at: new Date().toISOString(),
      room: this.view.identity?.room,
      softwareOnly: true,
      motionToPhotonCameraMs: this.view.panelLatency,
      snapshots: {
        delay: metrics.oneWay,
        lastBytes: metrics.lastBytes,
        deltaRatio: metrics.deltaRatio,
        starvations: metrics.starvations,
      },
      telemetry: this.view.telemetry,
      links: this.view.links,
      disconnects: this.disconnects,
      pointer: {
        gain: this.view.sensitivity,
        recenters: this.recenters,
      },
      completed: this.view.history,
      progress: this.view.progress,
      authority: this.authority?.summary() ?? this.endedAuthoritySummary,
    };
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(summary, null, 2)], {
        type: 'application/json',
      }),
    );
    const a = document.createElement('a');
    a.href = url;
    a.download = `controlla-${this.view.identity?.room ?? 'session'}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  private beforeUnload = (event: BeforeUnloadEvent) => {
    if (this.view.identity?.role === 'host' && !this.view.ended) {
      event.preventDefault();
      // oxlint-disable-next-line typescript/no-deprecated -- legacy Safari beforeunload compatibility
      event.returnValue = '';
    }
  };
  private pageHide = () => {
    this.pageSuspended = true;
    this.clearWidgetInput();
    this.motion.suspend();
    this.buttonState = 0;
    this.notify();
  };
  private pageShow = () => {
    this.pageSuspended = false;
    this.visibility();
  };
  private visibility = () => {
    if (this.stopped || this.view.ended) return;
    this.buttonState = 0;
    if (document.hidden || this.pageSuspended) {
      this.clearWidgetInput();
      this.motion.suspend();
      if (this.view.identity?.role === 'host')
        this.warn(
          'Keep the host screen visible. Background throttling affects everyone.',
        );
    } else {
      this.motion.resume();
      void this.acquireWake();
      this.applySensorConfig();
      this.probe();
      this.sendUp({ type: 'hello', bootId: this.bootId });
    }
    this.notify();
  };
  close() {
    this.stopped = true;
    this.playback.dispose();
    this.clearLocalCursors();
    this.network.close();
    this.endedAuthoritySummary =
      this.authority?.summary() ?? this.endedAuthoritySummary;
    this.authority?.dispose();
    this.authority = null;
    this.motion.dispose();
    if (this.loop) clearInterval(this.loop);
    if (this.syncTimer) clearInterval(this.syncTimer);
    if (this.diagnosticsTimer) clearInterval(this.diagnosticsTimer);
    this.clearWidgetInput(true);
    void this.wake?.release();
    this.wake = null;
    this.view.wakeLock = false;
    // close() can run twice (React strict mode, hot reload); closing again throws.
    if (this.audio && this.audio.state !== 'closed')
      void this.audio.close().catch(() => {});
    document.removeEventListener('visibilitychange', this.visibility);
    window.removeEventListener('beforeunload', this.beforeUnload);
    window.removeEventListener('pagehide', this.pageHide);
    window.removeEventListener('pageshow', this.pageShow);
  }
}
