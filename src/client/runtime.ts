import { Network, type Channel, type LinkStats } from './network.ts';
import { ClockSync, Samples } from '../core/timing.ts';
import { SnapshotBuffer } from '../core/snapshots.ts';
import { SessionAuthority } from '../core/session.ts';
import { encodeInput, decodeInput } from '../core/protocol.ts';
import { Motion } from './motion.ts';
import { PointerSmoother } from '../core/pointer.ts';
import {
  centerCalibration,
  clampGain,
  DEFAULT_GAIN,
  gainOf,
  project,
  recenter,
  tangent,
  type Calibration,
} from '../core/calibration.ts';
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
  /** -1 idle, 0 aim at center, 1 move the live cursor into each corner. */
  calibrationStep: number;
  /** Bits 0–3: top-left, top-right, bottom-right, bottom-left reached. */
  cornersReached: number;
  sensitivity: number;
  calibrated: boolean;
  motionEnabled: boolean;
  sensorHz: number;
  history: { gameId: string; results: Result[] }[];
  panelLatency: number | null;
  wakeLock: boolean;
  controllerPath: 'venue' | 'direct-to-session';
}
export interface JoinOptions {
  role: Role;
  room?: string;
  venueId?: string;
  name?: string;
  endpoint: string;
  token?: string;
}
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
  private calibration: Calibration | null = null;
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
  private calibrationTargets = new Map<
    string,
    { step: number; reached: number; name: string; color: string }
  >();
  private joinedAt = now();
  private lastShake = 0;
  private widgetLastSent = new Map<string, number>();
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
    calibrationStep: -1,
    cornersReached: 0,
    sensitivity: DEFAULT_GAIN,
    calibrated: false,
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
        const stored = localStorage.getItem(this.calibrationKey());
        if (stored) {
          const value = JSON.parse(stored);
          if (value.ref?.length === 4 && value.h?.length === 9) {
            this.calibration = value;
            this.motion.q = value.fusionQuaternion ?? this.motion.q;
            this.view.calibrated = true;
          }
        }
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
    for (const id of this.calibrationTargets.keys())
      if (!roster.players.some((p) => p.id === id && p.connected))
        this.calibrationTargets.delete(id);
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
        if (data.type === 'calibration') {
          if (data.step === 0 || data.step === 1)
            this.calibrationTargets.set(from, {
              step: data.step,
              reached:
                Number.isInteger(data.reached) &&
                data.reached >= 0 &&
                data.reached <= 15
                  ? data.reached
                  : 0,
              name: player.name,
              color: player.color,
            });
          else this.calibrationTargets.delete(from);
          this.notify();
        } else if (me.role === 'host') this.authority?.control(from, data);
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
      if (
        config.sensors.pointer.enabled &&
        this.calibration &&
        this.motion.confidence > 0
      ) {
        try {
          point = this.pointerSmoother.sample(
            project(
              this.calibration.h,
              tangent(this.calibration.ref, this.motion.q),
            ),
            this.motion.lastAt,
          );
          if (this.view.calibrationStep === 1) this.trackCorners(point);
        } catch {
          /* Keep last valid position when aimed behind the screen. */
        }
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
            ? this.calibration
              ? this.motion.confidence
              : 0
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
    const at = now();
    if (
      at - (this.widgetLastSent.get(action) ?? 0) > 30 ||
      ['swipe-pad', 'shake', 'hold-meter', 'text'].includes(widget.type)
    ) {
      this.widgetLastSent.set(action, at);
      this.sendUp({ type: 'widget', action, value });
    }
    if (widget.type === 'stick' || widget.type === 'dpad') {
      const p = value as Point;
      this.setPoint(
        widget.space === 'normalized'
          ? { x: (p.x + 1) / 2, y: (p.y + 1) / 2 }
          : p,
      );
    } else if (
      ['swipe-pad', 'shake', 'hold-meter'].includes(widget.type) &&
      (widget.type !== 'hold-meter' || value === 1)
    ) {
      this.press(action, true);
      this.press(action, false);
    }
  }
  press(action: string, down: boolean) {
    const config = this.view.config;
    if (!config) return;
    const buttons = config.widgets.filter((w) =>
      ['button', 'swipe-pad', 'shake', 'hold-meter'].includes(w.type),
    );
    const button = buttons.findIndex((w) => w.action === action);
    if (button < 0 || button > 3) return;
    const mask = 1 << button;
    if (down && !(this.buttonState & mask)) {
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
      if (config.haptics.enabled) navigator.vibrate?.(12);
    }
    this.buttonState = down
      ? this.buttonState | mask
      : this.buttonState & ~mask;
  }
  beginCalibration() {
    if (!this.view.motionEnabled) {
      this.warn('Tap Enable motion before calibrating.');
      return;
    }
    this.view.sensitivity = gainOf(this.calibration);
    this.view.warning = '';
    this.motion.start();
    this.setCalibrationStep(0);
  }
  /** Step 0: the current pose becomes screen center and the cursor goes live. */
  captureCalibration() {
    if (this.motion.confidence < 0.5) {
      this.warn('Waiting for fresh motion samples. Move your phone gently.');
      return;
    }
    this.calibration = centerCalibration(
      [...this.motion.q],
      this.view.sensitivity,
      this.calibration ?? undefined,
    );
    this.pointerSmoother.reset();
    this.view.warning = '';
    this.setCalibrationStep(1);
  }
  /** Step 1 only: rescale the live cursor around the captured center. */
  setSensitivity(gain: number) {
    if (this.view.calibrationStep !== 1 || !this.calibration) return;
    this.view.sensitivity = clampGain(gain);
    this.calibration = {
      ...centerCalibration(this.calibration.ref, this.view.sensitivity),
      count: this.calibration.count,
      recenters: this.calibration.recenters,
    };
    this.notify();
  }
  redoCenter() {
    this.setCalibrationStep(0);
  }
  finishCalibration() {
    if (this.view.calibrationStep !== 1 || this.view.cornersReached !== 15)
      return;
    this.view.calibrated = true;
    this.saveCalibration();
    this.setCalibrationStep(-1);
  }
  private setCalibrationStep(step: number) {
    this.view.calibrationStep = step;
    this.view.cornersReached = 0;
    this.sendCalibrationMarker();
    this.notify();
  }
  private sendCalibrationMarker() {
    this.network.send(this.view.identity!.venueId, 'ctrl', {
      type: 'calibration',
      step: this.view.calibrationStep,
      reached: this.view.cornersReached,
    });
  }
  /** Marks corners of the canonical area the live cursor has reached. */
  private trackCorners(p: Point) {
    const edge = 0.08,
      left = p.x < edge,
      right = p.x > 1 - edge,
      top = p.y < edge,
      bottom = p.y > 1 - edge,
      hit =
        (top && left ? 1 : 0) |
        (top && right ? 2 : 0) |
        (bottom && right ? 4 : 0) |
        (bottom && left ? 8 : 0),
      reached = this.view.cornersReached | hit;
    if (reached === this.view.cornersReached) return;
    this.view.cornersReached = reached;
    this.sendCalibrationMarker();
    this.notify();
  }
  recenter() {
    if (!this.calibration) return;
    try {
      this.calibration = recenter(this.calibration, this.motion.q);
      this.pointerSmoother.reset();
      this.latestPoint = { x: 0.5, y: 0.5 };
      this.saveCalibration();
      this.notify();
    } catch (error) {
      this.warn(String(error));
    }
  }
  private calibrationKey() {
    // v2: aim axis is the phone's top edge; older saved fits used its back.
    return `controlla:calibration:v2:${this.view.identity?.room}:${this.view.identity?.venueId}`;
  }
  private saveCalibration() {
    try {
      localStorage.setItem(
        this.calibrationKey(),
        JSON.stringify({
          ...this.calibration,
          fusionQuaternion: this.motion.q,
        }),
      );
    } catch {
      this.warn(
        'Calibration works, but this browser cannot save it for reconnect.',
      );
    }
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
  calibrationMarkers() {
    return [...this.calibrationTargets.values()];
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
        calibrationAge: this.calibration
          ? Date.now() - this.calibration.at
          : null,
        recenters: this.calibration?.recenters ?? 0,
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
      calibration: this.calibration
        ? {
            count: this.calibration.count,
            recenters: this.calibration.recenters,
          }
        : null,
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
    if (this.calibration) this.saveCalibration();
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
    void this.wake?.release();
    // close() can run twice (React strict mode, hot reload); closing again throws.
    if (this.audio && this.audio.state !== 'closed')
      void this.audio.close().catch(() => {});
    document.removeEventListener('visibilitychange', this.visibility);
    window.removeEventListener('beforeunload', this.beforeUnload);
    window.removeEventListener('pagehide', this.pageHide);
  }
}
