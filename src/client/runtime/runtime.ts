import { BrowserResources } from './browser/browser-resources.ts';
import type { BrowserEnvironment } from './browser/contracts.ts';
import { downloadSummary } from './browser/download.ts';
import { Diagnostics } from './diagnostics/diagnostics.ts';
import { Network } from '../transport/network.ts';
import type { LinkStats, Transport } from '../transport/contracts.ts';
import { ClockSync, now } from '../engine/timing.ts';
import {
  DisplayPlayback,
  SNAPSHOT_RETRY_MESSAGE,
} from './playback/display-playback.ts';
import { games, findGame } from '../minigames/catalog.ts';
import { catalogSnapshotPolicy } from '../engine/snapshots.ts';
import { completedResults } from '../engine/progress.ts';
import { freezeSnapshot } from '../game-screen/screen.ts';
import type { ScreenPort, ScreenFrame } from '../game-screen/port.ts';
import type { Progress, ReadonlyDeep, RoundSnapshot } from '../api/index.ts';
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

let fallbackBootSequence = 0;

/** LAN HTTP is not a secure context, so Web Crypto UUIDs may be unavailable. */
export function runtimeBootId(
  cryptoApi: { randomUUID?(): string } | null = globalThis.crypto,
): string {
  return (
    cryptoApi?.randomUUID?.() ??
    `boot-${Date.now().toString(36)}-${++fallbackBootSequence}-${Math.random().toString(36).slice(2)}`
  );
}

export class Runtime {
  readonly network: Transport;
  clock = new ClockSync();
  private readonly playback: DisplayPlayback;
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
  private readonly resources: BrowserResources;
  private readonly diagnostic: Diagnostics;
  private offMotion: () => void;
  private started = false;
  private connectionEpoch = 0;
  private probeTimers = new Set<ReturnType<typeof setTimeout>>();
  private motionCapabilitiesKey = '';
  private bootId = runtimeBootId();
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
    browserEnvironment?: BrowserEnvironment,
  ) {
    this.resources = new BrowserResources(
      {
        lifecycle: (suspended, warnHost) =>
          this.visibility(suspended, warnHost),
        shouldWarnBeforeUnload: () =>
          !this.stopped &&
          !this.view.ended &&
          this.view.identity?.role === 'host',
        wakeChanged: (held) => {
          this.view.wakeLock = held;
          if (!this.stopped) this.notify();
        },
      },
      browserEnvironment,
    );
    this.diagnostic = new Diagnostics({
      stats: () => this.network.stats(),
      snapshot: () => ({
        identity: this.view.identity
          ? {
              role: this.view.identity.role,
              hostId: this.view.identity.hostId,
              venueId: this.view.identity.venueId,
              room: this.view.identity.room,
            }
          : null,
        clock: {
          offset: this.clock.offset,
          error: this.clock.error,
          rtt: this.clock.rtts.summary(),
        },
        sensorHz: this.motion.rateHz,
        pointer: {
          gain: this.input.getSnapshot().sensitivity,
          recenters: this.input.getSnapshot().recenters,
        },
        path: this.view.controllerPath,
        metrics: this.playback.metrics(),
        completed: this.playback.completedResults(),
        progress: this.playback.getProgress(),
        authority: this.authority?.summary() ?? this.endedAuthoritySummary,
      }),
      publish: (links, message) => {
        this.view.links = links;
        if (message) this.sendUp(message);
        this.notify();
      },
    });
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
        playEvent: (event) => this.resources.playEvent(event),
      },
    );
    this.router = new SessionRouter(
      {
        localTime: now,
        authorityTime: () => this.time(),
        defer: (callback) => queueMicrotask(callback),
      },
      {
        isOpen: (id) => this.network.isOpen(id),
        ensureHostFallback: () => this.network.ensureHostFallback(),
        cursors: {
          roster: (id, roster) => this.playback.cursors.setRoster(id, roster),
          configure: (id, message) =>
            this.playback.cursors.configure(id, message),
          input: (player, frame, time, local) =>
            this.playback.cursors.input(player, frame, time, local),
          control: (player, message) =>
            this.playback.cursors.control(player, message),
          clear: () => this.playback.cursors.clear(),
        },
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
    this.network.onWarning = (m) => {
      if (!this.stopped && !this.view.ended) this.warn(m);
    };
    this.network.onStatus = (s) => {
      if (this.stopped || this.view.ended) return;
      this.view.status = s;
      if (s === 'Reconnecting…' || s === 'Reload required') {
        this.motion.suspend();
        this.playback.disconnect();
        this.router.disconnect();
        this.input.setActive(false);
        this.cancelProbes();
        this.diagnostic.disconnect(s, Date.now());
      }
      this.notify();
    };
    this.offMotion = this.motion.subscribe(() => this.motionChanged());
    if (this.resources.suspended) this.motion.suspend();
    this.motionChanged();
    this.network.onEnded = (reason) => {
      if (this.stopped || this.view.ended) return;
      this.view.ended = true;
      this.stopScheduling();
      this.diagnostic.dispose();
      this.resources.dispose();
      this.offMotion();
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
    if (this.stopped) return;
    this.view.warning = message;
    this.notify();
  }
  start() {
    if (this.started || this.stopped || this.view.ended) return;
    this.started = true;
    this.resources.start();
    this.network.connect();
    if (this.stopped || this.view.ended) return;
    this.loop = setInterval(() => this.tick(), 1000 / 120);
    this.diagnosticsTimer = setInterval(
      () => void this.diagnostic.poll(),
      2000,
    );
    this.syncTimer = setInterval(() => this.probe(), 1500);
  }
  private welcome(identity: Identity) {
    if (this.stopped || this.view.ended) return;
    this.cancelProbes();
    this.diagnostic.invalidate();
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
    const epoch = this.connectionEpoch;
    for (let i = 0; i < 10; i++) {
      const timer = setTimeout(() => {
        this.probeTimers.delete(timer);
        if (!this.stopped && !this.view.ended && epoch === this.connectionEpoch)
          this.probe();
      }, i * 80);
      this.probeTimers.add(timer);
    }
    this.notify();
  }
  private roster(roster: Roster) {
    if (this.stopped || this.view.ended) return;
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
        if (!this.resources.suspended) this.motion.resume();
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
    if (!this.playback.acceptProgress(msg)) return;
    this.view.progress = this.playback.getProgress();
    this.view.history = this.playback.completedResults();
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
      this.diagnostic.acceptTelemetry(msg);
      this.view.telemetry = structuredClone(msg);
      this.notify();
    }
  }
  private controllerMessage(msg: Message) {
    if (msg.type === 'clockReply') this.clockReply(msg);
    else if (msg.type === 'config') {
      const config = msg.config as ControllerConfig;
      if (!this.input.configure(config)) {
        this.warn('Unsupported controller configuration');
        return;
      }
      this.view.config = this.input.getConfiguration();
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
      !this.resources.suspended
    ) {
      this.view.controllerPath = this.router.updateControllerRoute();
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
    await this.resources.unlock();
  }
  private syncInput() {
    this.input.setActive(
      !this.stopped &&
        !this.view.ended &&
        this.view.identity?.role === 'controller' &&
        this.view.status === 'Connected' &&
        !this.resources.suspended,
    );
    const input = this.input.getSnapshot();
    this.view.inputEpoch = input.epoch;
    this.view.adjustingAim = input.adjustingAim;
    this.view.sensitivity = input.sensitivity;
  }
  previewPoint() {
    return this.input.previewPoint();
  }
  chopCount() {
    return this.input.getSnapshot().chops;
  }
  holdAim(down: boolean) {
    this.input.holdAim(down);
  }
  setPoint(point: Point) {
    this.input.setPoint(point);
  }
  portFor(widget: Widget, generation: number): ControlPort {
    this.syncInput();
    return this.input.portFor(widget, generation);
  }
  action(action: string, raw: unknown, generation?: number) {
    this.syncInput();
    this.input.action(action, raw, generation);
  }
  press(action: string, down: boolean, generation?: number) {
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
    this.input.beginAdjustAim();
    this.motion.start();
    this.notify();
  }
  finishAdjustAim() {
    this.input.finishAdjustAim();
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
    const cursors = this.cursors();
    const frame = this.playback.advanceFrame(
      this.time(),
      Object.fromEntries(
        cursors.map((cursor) => [cursor.id, { ...cursor.point }]),
      ),
      Object.fromEntries(
        cursors.map((cursor) => [
          cursor.id,
          { name: cursor.name, color: cursor.color },
        ]),
      ),
    );
    this.view.state = this.playback.sampledSnapshot;
    return frame;
  }
  renderState() {
    return this.advanceFrame().snapshot;
  }
  cursors() {
    return this.playback.cursors.cursors(now());
  }
  setPanelLatency(value: number | null) {
    this.diagnostic.setPanelLatency(value);
    this.view.panelLatency = value;
    this.notify();
  }
  exportSummary() {
    downloadSummary(this.diagnostic.report(), this.view.identity?.room);
  }
  private visibility(suspended: boolean, warnHost: boolean) {
    if (this.stopped || this.view.ended) return;
    if (suspended) {
      this.input.setActive(false);
      this.motion.suspend();
      if (warnHost && this.view.identity?.role === 'host')
        this.warn(
          'Keep the host screen visible. Background throttling affects everyone.',
        );
    } else {
      this.motion.resume();
      void this.resources.acquireWake();
      this.applySensorConfig();
      this.probe();
      this.sendUp({ type: 'hello', bootId: this.bootId });
    }
    this.notify();
  }
  private cancelProbes() {
    this.connectionEpoch++;
    for (const timer of this.probeTimers) clearTimeout(timer);
    this.probeTimers.clear();
  }
  private stopScheduling() {
    this.cancelProbes();
    if (this.loop) clearInterval(this.loop);
    if (this.syncTimer) clearInterval(this.syncTimer);
    if (this.diagnosticsTimer) clearInterval(this.diagnosticsTimer);
    this.loop = this.syncTimer = this.diagnosticsTimer = null;
  }
  close() {
    if (this.stopped) return;
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
    this.stopScheduling();
    this.offMotion();
    this.diagnostic.dispose();
    this.resources.dispose();
    this.listeners.clear();
  }
}
