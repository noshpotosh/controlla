import { Network, type Channel, type LinkStats } from './network.ts';
import { ClockSync, Samples } from '../core/timing.ts';
import { SnapshotBuffer } from '../core/snapshots.ts';
import { SessionAuthority } from '../core/session.ts';
import { encodeInput, decodeInput } from '../core/protocol.ts';
import { Motion } from './motion.ts';
import { channelOf, PRESS_SLOTS, usesPressSlot } from '../controls/registry.ts';
import {
  clampGain,
  DEFAULT_GAIN,
  GyroPointer,
  PointerSmoother,
} from '../core/pointer.ts';
import {
  now,
  type ControllerConfig,
  type GameEvent,
  type GameState,
  type Identity,
  type InputFrame,
  type Message,
  type Point,
  type Role,
  type Result,
  type Roster,
} from '../core/types.ts';
export interface RuntimeView {
  identity: Identity | null;
  roster: Roster;
  status: string;
  warning: string;
  ended: boolean;
  state: GameState | null;
  config: ControllerConfig | null;
  phase: string;
  D: number;
  limitingVenue: string | null;
  telemetry: Message | null;
  links: Record<string, LinkStats>;
  /** The aim settings panel (sensitivity, recenter) is open. */
  adjustingAim: boolean;
  sensitivity: number;
  motionEnabled: boolean;
  sensorHz: number;
  history: { gameId: string; results: Result[] }[];
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
  buffer = new SnapshotBuffer();
  motion = new Motion();
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
  private gyroPointer = new GyroPointer();
  private lastPointerSample = 0;
  private pointerPoint: Point = { x: 0.5, y: 0.5 };
  private recenters = 0;
  private events: GameEvent[] = [];
  private eventIds = new Set<string>();
  private audio: AudioContext | null = null;
  private wake: WakeLockSentinel | null = null;
  private disconnects: { at: number; status: string }[] = [];
  private snapshotDelays = new Samples();
  private lastSnapshotSize = 0;
  private lastFullSize = 0;
  private sendRate = 60;
  private bootId = crypto.randomUUID();
  private lastPresentedKey = '';
  private joinedAt = now();
  private lastShake = 0;
  private widgetLastSent = new Map<string, number>();
  // Throttled values that arrived inside the window; sent when it closes so
  // the last value (e.g. a stick returning to centre) is never dropped.
  private widgetPending = new Map<
    string,
    { value: unknown; timer: ReturnType<typeof setTimeout> }
  >();
  view: RuntimeView = {
    identity: null,
    roster: { players: [], venues: [] },
    status: 'Connecting…',
    warning: '',
    ended: false,
    state: null,
    config: null,
    phase: 'lobby',
    D: 0,
    limitingVenue: null,
    telemetry: null,
    links: {},
    adjustingAim: false,
    sensitivity: DEFAULT_GAIN,
    motionEnabled: false,
    sensorHz: 0,
    history: [],
    panelLatency: null,
    wakeLock: false,
    controllerPath: 'venue',
  };
  constructor(public options: JoinOptions) {
    this.network = new Network(options.endpoint, options);
    this.network.onWelcome = (i) => this.welcome(i);
    this.network.onRoster = (r) => this.roster(r);
    this.network.onMessage = (f, c, d) => this.receive(f, c, d);
    this.network.onWarning = (m) => this.warn(m);
    this.network.onStatus = (s) => {
      this.view.status = s;
      if (s === 'Reconnecting…')
        this.disconnects.push({ at: Date.now(), status: s });
      this.notify();
    };
    this.network.onEnded = (reason) => {
      this.view.ended = true;
      this.warn(reason);
      this.view.status = 'Session ended';
      this.motion.stop();
      this.authority = null;
      this.notify();
    };
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
  }
  private welcome(identity: Identity) {
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
    this.authority?.setRoster(roster);
    const me = this.view.identity;
    if (me?.role === 'display') this.sendUp({ type: 'venueHello' });
    if (me?.role === 'controller') {
      const venue = roster.venues.find((v) => v.id === me.venueId);
      if (!venue?.connected) {
        this.view.status = 'Reconnecting — your screen went away';
        this.motion.stop();
      } else {
        this.view.status = 'Connected';
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
    if (p.venueId === this.view.identity?.id)
      this.network.send(id, 'ctrl', message);
    else
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
        if (player.venueId === me.id)
          this.localCursors.set(from, {
            point: { x: frame.x, y: frame.y },
            at: now(),
            color: player.color,
            name: player.name,
          });
        if (me.role === 'host') this.authority?.input(from, data);
        else {
          const packet = new Uint8Array(data.byteLength + 1);
          packet[0] = player.seat;
          packet.set(new Uint8Array(data), 1);
          this.network.send(me.hostId, 'input', packet.buffer);
        }
      } else if (channel === 'ctrl') {
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
        )
          this.network.send(data.target, 'ctrl', data.message);
      } else this.displayMessage(channel, data);
    }
  }
  private clockReply(msg: Message) {
    this.clock.observe(msg.t0, msg.t1, msg.t2, now());
  }
  private displayMessage(channel: Channel, msg: Message) {
    if (channel === 'snapshot' && msg.type === 'snapshot') {
      if (this.buffer.receive(msg.snapshot)) {
        this.sendUp({ type: 'snapshotAck', id: msg.snapshot.id });
        this.view.D = msg.delay;
        this.view.limitingVenue = msg.limitingVenue;
        this.snapshotDelays.add(Math.max(0, this.time() - msg.snapshot.time));
        this.lastSnapshotSize = JSON.stringify(msg.snapshot).length;
        this.lastFullSize = JSON.stringify(
          this.buffer.history.get(msg.snapshot.id)?.state,
        ).length;
        if (this.view.identity?.role === 'host' || this.clock.samples >= 10)
          this.sendUp({
            type: 'venueStats',
            delay: Math.max(0, this.time() - msg.snapshot.time),
          });
      } else this.sendUp({ type: 'resync' });
    } else if (channel === 'events' && msg.type === 'event') {
      const event = msg.event as GameEvent;
      if (!this.eventIds.has(event.id)) {
        this.eventIds.add(event.id);
        this.events.push(event);
        if (this.eventIds.size > 2000)
          this.eventIds.delete(this.eventIds.values().next().value!);
      }
    } else if (msg.type === 'clockReply') this.clockReply(msg);
    else if (msg.type === 'telemetry') {
      this.view.telemetry = msg;
      this.notify();
    } else if (msg.type === 'history') {
      this.view.history = msg.history;
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
        this.edges = [0, 0, 0, 0];
        this.edgeTimes = [0, 0, 0, 0];
        this.buttonState = 0;
        this.seq = 0;
        this.nextSend = 0;
        this.pointerSmoother.reset();
        this.latestPoint =
          config.sensors.pointer.enabled ||
          config.widgets.some((w) => w.space === 'normalized')
            ? { x: 0.5, y: 0.5 }
            : { x: 0, y: 0 };
      }
      this.applySensorConfig();
      this.sendUp({ type: 'ready', generation: config.generation });
      this.notify();
    } else if (msg.type === 'phase') {
      this.view.phase = msg.phase;
      this.view.history = msg.history ?? this.view.history;
      this.notify();
    } else if (msg.type === 'error') this.warn(msg.message);
  }
  private applySensorConfig() {
    const c = this.view.config;
    if (!c) return;
    // Keep sampling whenever permission is granted, even under a touch-only
    // config: the host only upgrades to pointer/tilt after it sees samples,
    // and stopping here (e.g. on a roster update before that upgrade lands)
    // made the no-samples check report the phone as having no motion sensors.
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
      !document.hidden
    ) {
      const config = this.view.config;
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
        Math.abs(Math.hypot(...this.motion.gravity) - 9.81) >
          config.sensors.shake.thresholdG * 9.81 &&
        local - this.lastShake > 600
      ) {
        this.lastShake = local;
        const shake = config.widgets.find((w) => w.type === 'shake');
        if (shake) this.action(shake.action, 1);
      }
      if (config.sensors.pointer.enabled && this.motion.confidence > 0) {
        // Integrate once per motion sample so a stalled sensor never replays
        // its last rate.
        const sampleAt = this.motion.lastAt;
        if (sampleAt !== this.lastPointerSample) {
          const dt = this.lastPointerSample
            ? Math.min(0.05, (sampleAt - this.lastPointerSample) / 1000)
            : 0;
          this.lastPointerSample = sampleAt;
          this.pointerPoint = this.pointerSmoother.sample(
            this.gyroPointer.update(
              this.motion.rate,
              this.motion.up,
              dt,
              sampleAt,
            ),
            sampleAt,
          );
        }
        point = this.pointerPoint;
      } else if (config.sensors.tilt.enabled) point = this.motion.tilt;
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
            ? this.motion.confidence
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
    await this.motion.enable();
    this.view.motionEnabled =
      this.motion.capabilities.sensors.gyro.permission === 'granted';
    this.sendUp({
      type: 'capabilities',
      capabilities: this.motion.capabilities,
    });
    if (!this.view.motionEnabled)
      this.warn(
        'Motion is unavailable. Touch controls are ready. To try again, check motion permissions in your browser’s site settings.',
      );
    setTimeout(() => {
      if (this.stopped || !this.view.motionEnabled) return;
      if (!this.motion.lastAt) {
        this.motion.capabilities.sensors.gyro.present = false;
        this.motion.capabilities.sensors.accel.present = false;
        this.sendUp({
          type: 'capabilities',
          capabilities: this.motion.capabilities,
        });
        this.warn(
          'This browser is not delivering motion samples. Touch controls are active.',
        );
      } else
        this.sendUp({
          type: 'capabilities',
          capabilities: this.motion.capabilities,
        });
    }, 1800);
    this.notify();
  }
  async unlock() {
    try {
      this.audio ??= new AudioContext();
      await this.audio.resume();
    } catch {
      /* Audio may be unavailable. */
    }
    await this.acquireWake();
  }
  private async acquireWake() {
    try {
      if ('wakeLock' in navigator) {
        this.wake = await navigator.wakeLock.request('screen');
        this.view.wakeLock = true;
        this.wake.addEventListener('release', () => {
          this.view.wakeLock = false;
        });
      }
    } catch {
      this.view.wakeLock = false;
    }
  }
  previewPoint() {
    return { ...this.latestPoint };
  }
  setPoint(point: Point) {
    this.latestPoint = point;
  }
  action(action: string, value: unknown) {
    const widget = this.view.config?.widgets.find((w) => w.action === action);
    if (!widget) return;
    const { throttle, drivesPointer } = channelOf(widget.type),
      at = now(),
      wait = WIDGET_THROTTLE_MS - (at - (this.widgetLastSent.get(action) ?? 0));
    if (!throttle || wait <= 0) this.sendWidget(action, value);
    else {
      const pending = this.widgetPending.get(action);
      if (pending) pending.value = value;
      else
        this.widgetPending.set(action, {
          value,
          timer: setTimeout(() => this.flushWidget(action), wait),
        });
    }
    if (drivesPointer) {
      const p = value as Point;
      this.setPoint(
        widget.space === 'normalized'
          ? { x: (p.x + 1) / 2, y: (p.y + 1) / 2 }
          : p,
      );
    } else if (widget.type === 'shake') {
      // Shake is detected by the runtime itself, so it fires its own edge.
      this.press(action, true);
      this.press(action, false);
    }
  }
  private sendWidget(action: string, value: unknown) {
    const pending = this.widgetPending.get(action);
    if (pending) clearTimeout(pending.timer);
    this.widgetPending.delete(action);
    this.widgetLastSent.set(action, now());
    this.sendUp({ type: 'widget', action, value });
  }
  private flushWidget(action: string) {
    const pending = this.widgetPending.get(action);
    if (pending) this.sendWidget(action, pending.value);
  }
  press(action: string, down: boolean) {
    const config = this.view.config;
    if (!config) return;
    const buttons = config.widgets.filter((w) => usesPressSlot(w.type));
    const button = buttons.findIndex((w) => w.action === action);
    if (button < 0 || button >= PRESS_SLOTS) return;
    // A press may carry meaning in its value (swipe vector, hold charge):
    // make sure that value leaves before the edge does.
    this.flushWidget(action);
    const mask = 1 << button;
    if (down && !(this.buttonState & mask)) {
      if (config.sensors.pointer.enabled) {
        // Tapping jolts the phone; register where the player was aiming.
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
  presented(state: GameState) {
    const key = `${state.startAt}:${state.promptId}`;
    if (key === this.lastPresentedKey) return;
    this.lastPresentedKey = key;
    this.sendUp({
      type: 'presented',
      round: state.startAt,
      promptId: state.promptId,
      at: this.time(),
    });
  }
  snapshotMetrics() {
    return {
      oneWay: this.snapshotDelays.summary(),
      lastBytes: this.lastSnapshotSize,
      deltaRatio: this.lastFullSize
        ? this.lastSnapshotSize / this.lastFullSize
        : null,
      starvations: this.buffer.starvations,
    };
  }
  renderState() {
    const state = this.buffer.sample(this.time() - this.view.D);
    this.view.state = state;
    const presentationTime = this.time() - this.view.D;
    for (const event of this.events.filter((e) => e.time <= presentationTime))
      this.playEvent(event);
    this.events = this.events.filter((e) => e.time > presentationTime);
    return state;
  }
  cursors() {
    return [...this.localCursors.entries()]
      .filter(([, c]) => now() - c.at < 1000)
      .map(([id, c]) => ({ id, ...c }));
  }
  private playEvent(event: GameEvent) {
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
      if (
        this.motion.capabilities.sensors.gyro.permission === 'granted' &&
        this.motion.lastAt &&
        now() - this.motion.lastAt > 2000
      )
        this.warn(
          'Motion samples stopped. Return to the browser or use touch controls.',
        );
    }
    this.notify();
  }
  setPanelLatency(value: number | null) {
    this.view.panelLatency = value;
    this.notify();
  }
  exportSummary() {
    const summary = {
      version: 1,
      at: new Date().toISOString(),
      room: this.view.identity?.room,
      softwareOnly: true,
      motionToPhotonCameraMs: this.view.panelLatency,
      snapshots: {
        delay: this.snapshotDelays.summary(),
        lastBytes: this.lastSnapshotSize,
        deltaRatio: this.lastFullSize
          ? this.lastSnapshotSize / this.lastFullSize
          : null,
        starvations: this.buffer.starvations,
      },
      telemetry: this.view.telemetry,
      links: this.view.links,
      disconnects: this.disconnects,
      pointer: {
        gain: this.view.sensitivity,
        recenters: this.recenters,
      },
      completed: this.view.history,
      authority: this.authority?.summary(),
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
    this.motion.stop();
    this.buttonState = 0;
  };
  private visibility = () => {
    this.buttonState = 0;
    if (document.hidden) {
      this.motion.stop();
      if (this.view.identity?.role === 'host')
        this.warn(
          'Keep the host screen visible. Background throttling affects everyone.',
        );
    } else {
      void this.acquireWake();
      this.applySensorConfig();
      this.probe();
      this.sendUp({ type: 'hello', bootId: this.bootId });
    }
  };
  close() {
    this.stopped = true;
    this.network.close();
    this.motion.stop();
    if (this.loop) clearInterval(this.loop);
    if (this.syncTimer) clearInterval(this.syncTimer);
    if (this.diagnosticsTimer) clearInterval(this.diagnosticsTimer);
    for (const { timer } of this.widgetPending.values()) clearTimeout(timer);
    this.widgetPending.clear();
    void this.wake?.release();
    // close() can run twice (React strict mode, hot reload); closing again throws.
    if (this.audio && this.audio.state !== 'closed')
      void this.audio.close().catch(() => {});
    document.removeEventListener('visibilitychange', this.visibility);
    window.removeEventListener('beforeunload', this.beforeUnload);
    window.removeEventListener('pagehide', this.pageHide);
  }
}
