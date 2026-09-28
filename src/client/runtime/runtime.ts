import { Network } from '../transport/network.ts';
import type { LinkStats, Transport } from '../transport/contracts.ts';
import { ClockSync, now } from '../engine/timing.ts';
import {
  DisplayPlayback,
  SNAPSHOT_RETRY_MESSAGE,
} from './playback/display-playback.ts';
import { games, findGame } from '../minigames/catalog.ts';
import { catalogSnapshotPolicy } from '../engine/snapshots.ts';
import { ProgressAssembler } from '../engine/history.ts';
import { completedResults } from '../engine/progress.ts';
import { freezeSnapshot } from '../game-screen/screen.ts';
import type { ScreenPort, ScreenFrame } from '../game-screen/port.ts';
import type {
  Progress,
  ReadonlyDeep,
  RoundSnapshot,
  PresentationEvent,
} from '../api/index.ts';
import { SessionAuthority } from '../engine/session.ts';
import { Motion } from '../controls/motion/provider.ts';
import type { MotionStatus } from '../controls/motion/contracts.ts';
import type { ControlPort, ControllerConfig, Widget } from '../controls/api.ts';
import { DEFAULT_GAIN } from '../controls/motion/pointer.ts';
import { ControllerInput } from './controller-input/controller-input.ts';

import type { Channel, Message } from '../engine/messages.ts';
import { SessionRouter } from './session-routing/session-router.ts';
import type { Point } from '../../core/types.ts';
import { type Identity, type Role, type Roster } from '../../shared/room.ts';
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
export class Runtime {
  readonly network: Transport;
  clock = new ClockSync();
  private readonly playback: DisplayPlayback;
  private progress = new ProgressAssembler();
  private endedAuthoritySummary: unknown = null;
  readonly screenPort: ScreenPort = {
    advanceFrame: () => this.advanceFrame(),
    presented: (roundId, eventIds) => this.presented(roundId, eventIds),
  };
  readonly motion: Motion;
  private readonly input: ControllerInput;
  private authority: SessionAuthority | null = null;
  private listeners = new Set<() => void>();
  private loop: ReturnType<typeof setInterval> | null = null;
  private diagnosticsTimer: ReturnType<typeof setInterval> | null = null;
  private syncTimer: ReturnType<typeof setInterval> | null = null;
  private stopped = false;
  private lastUi = 0;
  private readonly router: SessionRouter;
  private pageSuspended = false;
  private motionCapabilitiesKey = '';
  private audio: AudioContext | null = null;
  private wake: WakeLockSentinel | null = null;
  private wakePending = false;
  private disconnects: { at: number; status: string }[] = [];
  private bootId = crypto.randomUUID();
  private joinedAt = now();
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
    transport?: Transport,
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
    this.router = new SessionRouter(
      {
        localTime: now,
        authorityTime: () => this.time(),
        defer: (callback) => queueMicrotask(callback),
      },
      {
        send: (to, channel, data) => this.network.send(to, channel, data),
        authorityInput: (id, data) => this.authority?.input(id, data),
        authorityControl: (from, message) =>
          this.authority?.control(from, message),
        display: (channel, message) => this.displayMessage(channel, message),
        controller: (message) => this.controllerMessage(message),
      },
    );
    this.input = new ControllerInput(
      {
        localTime: now,
        authorityTime: () => this.time(),
        schedule: (callback, delay) => {
          const timer = setTimeout(callback, delay);
          return () => clearTimeout(timer);
        },
      },
      {
        frame: (data) => this.router.sendFrame(data),
        reliable: (message) => this.sendUp(message),
        haptic: (ms) => navigator.vibrate?.(ms),
      },
    );
    this.motion = motion;
    this.network = transport ?? new Network(options.endpoint, options);
    this.network.onWelcome = (i) => this.welcome(i);
    this.network.onRoster = (r) => this.roster(r);
    this.network.onMessage = (f, c, d) => this.receive(f, c, d);
    this.network.onWarning = (m) => this.warn(m);
    this.network.onStatus = (s) => {
      this.view.status = s;
      if (s === 'Reconnecting…' || s === 'Reload required') {
        this.motion.suspend();
        this.playback.disconnect();
        this.router.disconnect();
        this.input.setActive(false);
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
      this.input.end();
      this.router.end();
      this.warn(reason);
      this.view.status = 'Session ended';
      this.motion.dispose();
      this.view.motionStatus = 'disposed';

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
    this.syncInput();
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
    this.router.welcome(identity);
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
        if (stored) this.input.setSensitivity(Number(stored));
        this.view.sensitivity = this.input.getSnapshot().sensitivity;
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
    this.router.setRoster(roster);
    this.authority?.setRoster(roster);
    const me = this.view.identity;
    if (me?.role === 'display') this.sendUp({ type: 'venueHello' });
    if (me?.role === 'controller') {
      const venue = roster.venues.find((v) => v.id === me.venueId);
      if (!venue?.connected) {
        this.view.status = 'Reconnecting — your screen went away';
        this.motion.suspend();
        this.input.setActive(false);
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
  private toVenue(id: string, channel: Channel, message: Message) {
    this.router.toVenue(id, channel, message);
  }
  private toPlayer(id: string, message: Message) {
    this.router.toPlayer(id, message);
  }
  private sendUp(message: Message) {
    this.router.sendUp(message);
  }
  private receive(from: string, channel: Channel, data: Message | ArrayBuffer) {
    this.router.receive(from, channel, data);
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
      this.view.config = config;
      this.input.configure(config);
      this.syncInput();
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
    this.input.setRefreshRate(this.motion.capabilities.refreshRateHz);
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
    const local = now();
    this.syncInput();
    this.authority?.tick(local);
    const me = this.view.identity;
    if (
      me?.role === 'controller' &&
      this.view.config &&
      this.view.status === 'Connected' &&
      !document.hidden &&
      !this.pageSuspended
    ) {
      if (me.venueId !== me.hostId && local - this.joinedAt > 8000) {
        this.view.controllerPath = this.network.isOpen(me.venueId)
          ? 'venue'
          : 'direct-to-session';
        if (this.view.controllerPath === 'direct-to-session')
          this.network.ensureHostFallback();
      }
      this.router.setControllerRoute(this.view.controllerPath);
      this.input.tick(this.motion.getSnapshot());
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
  private syncInput() {
    this.input.setActive(
      !this.stopped &&
        !this.view.ended &&
        this.view.identity?.role === 'controller' &&
        this.view.status === 'Connected' &&
        !document.hidden &&
        !this.pageSuspended,
    );
    this.view.inputEpoch = this.input.getSnapshot().epoch;
  }
  previewPoint() {
    return this.input.previewPoint();
  }
  setPoint(point: Point) {
    this.input.setPoint(point);
  }
  portFor(widget: Widget, generation: number): ControlPort {
    this.syncInput();
    return this.input.portFor(widget, generation);
  }
  action(
    action: string,
    raw: unknown,
    generation = this.view.config?.generation,
  ) {
    this.syncInput();
    this.input.action(action, raw, generation);
  }
  press(
    action: string,
    down: boolean,
    generation = this.view.config?.generation,
  ) {
    this.syncInput();
    this.input.press(action, down, generation);
  }
  haptic(ms = 10) {
    this.syncInput();
    this.input.haptic(ms);
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
    this.input.setSensitivity(gain);
    this.view.sensitivity = this.input.getSnapshot().sensitivity;
    try {
      localStorage.setItem(POINTER_GAIN_KEY, String(this.view.sensitivity));
    } catch {
      /* Private browsing can disallow storage; the setting lasts this session. */
    }
    this.notify();
  }
  recenter() {
    this.input.recenter();
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
    return this.router.cursors();
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
        recenters: this.input.getSnapshot().recenters,
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
        recenters: this.input.getSnapshot().recenters,
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
    this.input.setActive(false);
    this.motion.suspend();
    this.notify();
  };
  private pageShow = () => {
    this.pageSuspended = false;
    this.visibility();
  };
  private visibility = () => {
    if (this.stopped || this.view.ended) return;
    if (document.hidden || this.pageSuspended) {
      this.input.setActive(false);
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
    this.input.dispose();
    this.router.dispose();
    this.network.close();
    this.endedAuthoritySummary =
      this.authority?.summary() ?? this.endedAuthoritySummary;
    this.authority?.dispose();
    this.authority = null;
    this.motion.dispose();
    if (this.loop) clearInterval(this.loop);
    if (this.syncTimer) clearInterval(this.syncTimer);
    if (this.diagnosticsTimer) clearInterval(this.diagnosticsTimer);
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
