import { Runtime, type JoinOptions } from '../runtime/runtime.ts';
import type { Motion } from '../controls/motion/provider.ts';
import type { Identity } from '../../shared/room.ts';
import { MAX_GAIN, MIN_GAIN } from '../controls/motion/pointer.ts';
import { standingsForPresentation } from './standings.ts';
import type {
  JoinRequest,
  ShellSession,
  ShellView,
  MotionDiagnosticsPort,
  Percentiles,
  PlayerDiagnostics,
} from './ports.ts';

function freeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.freeze(value);
    for (const child of Object.values(value)) freeze(child);
  }
  return value;
}
function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object'
    ? (value as Record<string, unknown>)
    : {};
}
const number = (value: unknown, fallback = 0): number =>
  typeof value === 'number' ? value : fallback;
const optionalNumber = (value: unknown) =>
  typeof value === 'number' ? value : undefined;
const text = (value: unknown, fallback = '') =>
  typeof value === 'string' ? value : fallback;
function percentiles(value: unknown): Percentiles | null {
  if (!value || typeof value !== 'object') return null;
  const v = record(value);
  return {
    p50: number(v.p50),
    p95: number(v.p95),
    p99: number(v.p99),
    jitter: number(v.jitter),
  };
}
function playerDiagnostics(value: unknown): PlayerDiagnostics {
  const p = record(value),
    c = record(p.clock);
  return {
    id: text(p.id),
    name: text(p.name),
    hz: number(p.hz),
    loss: number(p.loss),
    age: optionalNumber(p.age) ?? null,
    delay: percentiles(p.delay),
    confidence: number(p.confidence),
    buffer: number(p.buffer),
    horizon: number(p.horizon),
    substitutions: Array.isArray(p.substitutions)
      ? p.substitutions.filter((x): x is string => typeof x === 'string')
      : [],
    clock: p.clock
      ? {
          error: optionalNumber(c.error),
          offset: optionalNumber(c.offset),
          rtt: percentiles(c.rtt),
          sensorHz: optionalNumber(c.sensorHz),
          recenters: optionalNumber(c.recenters),
          path: typeof c.path === 'string' ? c.path : undefined,
        }
      : null,
  };
}
/** Project only UI data. Reading it never advances the presentation clock. */
function project(runtime: Runtime): ShellView {
  const v = runtime.view,
    identity = v.identity,
    telemetry = record(v.telemetry);
  return freeze({
    identity: identity
      ? {
          id: identity.id,
          role: identity.role,
          room: identity.room,
          venueId: identity.venueId,
          hostId: identity.hostId,
        }
      : null,
    roster: {
      players: v.roster.players.map(
        ({ id, venueId, seat, name, color, connected }) => ({
          id,
          venueId,
          seat,
          name,
          color,
          connected,
        }),
      ),
      venues: v.roster.venues.map(({ id, name, connected }) => ({
        id,
        name,
        connected,
      })),
    },
    status: v.status,
    warning: v.warning,
    ended: v.ended,
    phase: v.phase,
    config: v.config ? structuredClone(v.config) : null,
    inputEpoch: v.inputEpoch,
    D: v.D,
    limitingVenue: v.limitingVenue,
    adjustingAim: v.adjustingAim,
    sensitivity: v.sensitivity,
    sensitivityRange: { min: MIN_GAIN, max: MAX_GAIN },
    motionEnabled: v.motionEnabled,
    motionStatus: v.motionStatus,
    sensorHz: v.sensorHz,
    panelLatency: v.panelLatency,
    wakeLock: v.wakeLock,
    controllerPath: v.controllerPath,
    standings: {
      ...standingsForPresentation(
        v.progress,
        v.state?.progress ?? null,
        v.phase,
      ),
    },
    diagnostics: {
      players: Array.isArray(telemetry.players)
        ? telemetry.players.map(playerDiagnostics)
        : [],
      presentationSpreadMs:
        optionalNumber(telemetry.presentationSpreadMs) ?? null,
      links: Object.fromEntries(
        Object.entries(v.links).map(([id, l]) => [
          id,
          {
            path: l.path,
            rtt: l.rtt,
            localCandidate: l.localCandidate,
            remoteCandidate: l.remoteCandidate,
          },
        ]),
      ),
      snapshots: structuredClone(runtime.snapshotMetrics()),
    },
  });
}
export function motionDiagnostics(
  source: Pick<Motion, 'start' | 'onSample' | 'recentSamples' | 'capabilities'>,
): MotionDiagnosticsPort {
  return {
    start: () => source.start(),
    subscribe: (listener) =>
      source.onSample((sample) => listener(structuredClone(sample))),
    recentSamples: () => source.recentSamples(),
    permission: () => source.capabilities.sensors.gyro.permission,
  };
}
/** One adapter per joined session; ports and snapshot identities remain stable. */
export function adaptRuntime(runtime: Runtime): ShellSession {
  let closed = false;
  let snapshot = project(runtime);
  const listeners = new Set<() => void>();
  const observations = new Set<() => void>();
  const off = runtime.subscribe(() => {
    if (closed) return;
    snapshot = project(runtime);
    for (const listener of listeners) listener();
  });
  const motion = motionDiagnostics(runtime.motion);
  const active = (run: () => void) => {
    if (!closed) run();
  };
  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      if (closed) return () => {};
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    room: {
      endpoint: runtime.options.endpoint,
      unlock: async () => {
        if (!closed) await runtime.unlock();
      },
      warn: (message) => active(() => runtime.warn(message)),
      exportSummary: () => active(() => runtime.exportSummary()),
      setPanelLatency: (value) => active(() => runtime.setPanelLatency(value)),
    },
    host:
      runtime.options.role === 'host'
        ? {
            startGame: (id, mode) => active(() => runtime.startGame(id, mode)),
            abortGame: () => active(() => runtime.abortGame()),
          }
        : null,
    phone: {
      enableMotion: async () => {
        if (!closed) await runtime.enableMotion();
      },
      beginAdjustAim: () => active(() => runtime.beginAdjustAim()),
      finishAdjustAim: () => active(() => runtime.finishAdjustAim()),
      setSensitivity: (value) => active(() => runtime.setSensitivity(value)),
      recenter: () => active(() => runtime.recenter()),
      previewPoint: () =>
        closed ? { x: 0.5, y: 0.5 } : runtime.previewPoint(),
      chopCount: () => (closed ? 0 : runtime.chopCount()),
      holdAim: (down) => active(() => runtime.holdAim(down)),
      portFor(widget, generation) {
        const port = runtime.portFor(widget, generation);
        return {
          value: (value) => active(() => port.value(value)),
          press: (down) => active(() => port.press(down)),
          haptic: (ms) => active(() => port.haptic(ms)),
        };
      },
    },
    motion: {
      start: () => active(motion.start),
      permission: () => (closed ? 'unavailable' : motion.permission()),
      recentSamples: () => (closed ? [] : motion.recentSamples()),
      subscribe(listener) {
        if (closed) return () => {};
        const stop = motion.subscribe((sample) => {
          if (!closed) listener(sample);
        });
        const unsubscribe = () => {
          if (observations.delete(unsubscribe)) stop();
        };
        observations.add(unsubscribe);
        return unsubscribe;
      },
    },
    screen: {
      advanceFrame: () =>
        closed
          ? {
              snapshot: null,
              presentationTime: 0,
              delay: 0,
              localCursors: {},
              status: 'ended',
              message: 'Session ended.',
            }
          : runtime.screenPort.advanceFrame(),
      presented: (roundId, events) =>
        active(() => runtime.screenPort.presented(roundId, events)),
    },
    close() {
      if (closed) return;
      closed = true;
      off();
      listeners.clear();
      for (const stop of observations) stop();
      runtime.close();
    },
  };
}
function resumeToken(request: JoinRequest): string | undefined {
  if (!request.resume || request.role === 'host') return undefined;
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)!;
      if (
        !key.startsWith(
          `controlla:resume:${request.role}:${request.room.toUpperCase()}:`,
        )
      )
        continue;
      const identity = JSON.parse(localStorage.getItem(key)!) as Identity;
      if (
        !request.venue ||
        identity.venueId === request.venue ||
        identity.venueId.startsWith(request.venue.toLowerCase())
      )
        return identity.token;
    }
  } catch {
    /* Storage is optional. */
  }
}
export function createSession(
  request: JoinRequest,
  create: (options: JoinOptions) => Runtime = (options) => new Runtime(options),
): ShellSession {
  const room = request.room.toUpperCase().trim(),
    venueId = request.venue.trim();
  if (
    request.role !== 'host' &&
    !/^[23456789ABCDEFGHJKMNPQRSTVWXYZ]{4,6}$/i.test(room)
  )
    throw new Error('Enter the room code shown on the screen.');
  if (request.role === 'controller' && !venueId)
    throw new Error(
      'Open the room on a screen first, then enter its screen code or open its phone link.',
    );
  if (!['ws:', 'wss:'].includes(new URL(request.endpoint).protocol))
    throw new Error('Room service address must start with ws:// or wss://');
  const runtime = create({
    role: request.role,
    room,
    venueId,
    name: request.name,
    endpoint: request.endpoint,
    token: resumeToken({ ...request, room, venue: venueId }),
  });
  const session = adaptRuntime(runtime);
  try {
    runtime.start();
    void session.room.unlock();
    return session;
  } catch (error) {
    session.close();
    throw error;
  }
}
