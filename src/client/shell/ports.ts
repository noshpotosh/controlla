import type { MotionControlPort } from '../controls/motion/contracts.ts';
import type { MotionStatus } from '../controls/motion/contracts.ts';
/** Application UI contracts; no runtime, transport, React or game implementation. */
import type {
  ControllerConfig,
  ControlPort,
  Widget,
  Permission,
} from '../controls/api.ts';
import type { Point } from '../../core/types.ts';
import type { Identity, Role, Player, Venue } from '../../shared/room.ts';
import type { RawMotionSample } from '../controls/motion/trace.ts';
import type { ScreenPort } from '../game-screen/port.ts';

export interface JoinRequest {
  role: Role;
  room: string;
  venue: string;
  name: string;
  endpoint: string;
  resume: boolean;
}
export type { Role } from '../../shared/room.ts';
export interface GameChoice {
  readonly id: string;
  readonly name: string;
  readonly players: Readonly<{ min: number; max: number }>;
  readonly durationMs: number;
  readonly modes: readonly Readonly<{ id: string; name: string }>[];
  readonly defaultMode: string;
  readonly instructions?: readonly string[];
}
export interface Percentiles {
  readonly p50: number;
  readonly p95: number;
  readonly p99: number;
  readonly jitter: number;
}
export interface PlayerDiagnostics {
  readonly id: string;
  readonly name: string;
  readonly hz: number;
  readonly loss: number;
  readonly age: number | null;
  readonly delay: Percentiles | null;
  readonly confidence: number;
  readonly buffer: number;
  readonly horizon: number;
  readonly substitutions: readonly string[];
  readonly clock: Readonly<{
    error?: number;
    offset?: number;
    rtt?: Percentiles | null;
    sensorHz?: number;
    recenters?: number;
    path?: string;
  }> | null;
}
export interface DiagnosticsView {
  readonly players: readonly PlayerDiagnostics[];
  readonly presentationSpreadMs: number | null;
  readonly links: Readonly<
    Record<
      string,
      Readonly<{
        path: string;
        rtt: number | null;
        localCandidate?: string;
        remoteCandidate?: string;
      }>
    >
  >;
  readonly snapshots: Readonly<{
    lastBytes: number;
    deltaRatio: number | null;
    oneWay: Percentiles;
    starvations: number;
  }>;
}
/** Detached and recursively frozen. Config keeps the controller library's input type. */
export interface ShellView {
  readonly identity: Readonly<Omit<Identity, 'token'>> | null;
  readonly roster: Readonly<{
    players: readonly Readonly<
      Pick<Player, 'id' | 'venueId' | 'seat' | 'name' | 'color' | 'connected'>
    >[];
    venues: readonly Readonly<Venue>[];
  }>;
  readonly status: string;
  readonly warning: string;
  readonly ended: boolean;
  readonly phase: string;
  readonly config: ControllerConfig | null;
  readonly inputEpoch: number;
  readonly D: number;
  readonly limitingVenue: string | null;
  readonly adjustingAim: boolean;
  readonly sensitivity: number;
  readonly sensitivityRange: Readonly<{ min: number; max: number }>;
  readonly motionEnabled: boolean;
  readonly motionStatus: MotionStatus;
  readonly sensorHz: number;
  readonly panelLatency: number | null;
  readonly wakeLock: boolean;
  readonly controllerPath: 'venue' | 'direct-to-session';
  readonly standings: Readonly<Record<string, number>>;
  readonly diagnostics: DiagnosticsView;
}
export interface RoomActions {
  readonly endpoint: string;
  unlock(this: void): Promise<void>;
  warn(this: void, message: string): void;
  exportSummary(this: void): void;
  setPanelLatency(this: void, value: number | null): void;
}
export interface HostActions {
  startGame(this: void, id: string, mode: string): void;
  abortGame(this: void): void;
}
export interface PhoneActions {
  enableMotion(this: void): Promise<void>;
  beginAdjustAim(this: void): void;
  finishAdjustAim(this: void): void;
  setSensitivity(this: void, value: number): void;
  recenter(this: void): void;
  previewPoint(this: void): Point;
  motionPortFor(
    this: void,
    widget: Widget,
    generation: number,
  ): MotionControlPort;
  portFor(this: void, widget: Widget, generation: number): ControlPort;
}
/** Observation only; samples are detached and subscriptions retire with the session. */
export interface MotionDiagnosticsPort {
  start(this: void): void;
  subscribe(
    this: void,
    listener: (sample: RawMotionSample) => void,
  ): () => void;
  recentSamples(this: void): RawMotionSample[];
  permission(this: void): Permission;
}
export interface SessionPort {
  getSnapshot(this: void): ShellView;
  subscribe(this: void, listener: () => void): () => void;
  readonly room: RoomActions;
  readonly host: HostActions | null;
  readonly phone: PhoneActions;
  readonly motion: MotionDiagnosticsPort;
}
/** Only the composition owner receives lifecycle and screen capabilities. */
export interface ShellSession extends SessionPort {
  readonly screen: ScreenPort;
  close(this: void): void;
}
