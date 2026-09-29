/** Public game contracts. No runtime, transport or React imports. */
import type { ControllerRequirements } from '../controls/api.ts';
import type { Point } from '../../core/types.ts';
import type { Player } from '../../shared/room.ts';

export type { Point } from '../../core/types.ts';
export type { Player } from '../../shared/room.ts';
export type {
  ControllerRequirements,
  InputRequirement,
  ControlValue,
  Vector,
  DpadOutput,
  StickOutput,
  SwipeDirection,
  SwipeOutput,
  HoldOutput,
  StrokeOutput,
} from '../controls/api.ts';
export type ReadonlyDeep<T> = T extends object
  ? { readonly [K in keyof T]: ReadonlyDeep<T[K]> }
  : T;

export interface Outcome {
  playerId: string;
  /** Equal placement means a tie. Lower is better; raw scores stay game-local. */
  placement: number;
  score: number;
  stats?: Record<string, number>;
}

export interface RoundRecord {
  roundId: string;
  gameId: string;
  mode: string;
  players: Player[];
  status: 'completed' | 'aborted';
  outcomes: Outcome[];
  awards: Record<string, number>;
}

export interface Progress {
  revision: number;
  totals: Record<string, number>;
  rounds: RoundRecord[];
}

export type Completion = 'accepted' | 'duplicate' | 'closed' | 'invalid';

export interface GameContext {
  readonly mode: string;
  readonly players: ReadonlyDeep<Player[]>;
  readonly startAt: number;
  readonly endAt: number;
}

export interface Action {
  playerId: string;
  name: string;
  time: number;
  /** Accepted aim captured with the action, not a later continuous value. */
  aim: Point;
  /** Semantic value captured with a value-bearing press, never a later value. */
  value?: unknown;
}

/** Capture time stays stable; observedAt describes a validated held-value observation. */
export interface ValueSample {
  value: unknown;
  time: number;
  observedAt?: number;
}

export interface GameInput {
  /** Settling delivers only the final accepted action batch, with dt zero. */
  phase: 'running' | 'settling';
  time: number;
  dt: number;
  presentationDelay: number;
  values: Readonly<Record<string, Readonly<Record<string, ValueSample>>>>;
  actions: readonly Action[];
}

export interface PresentationEvent {
  clock: 'presentation' | 'authority';
  measure?: boolean;
  id: string;
  time: number;
  kind: string;
  playerId?: string;
}

export interface GameInstance<S extends object> {
  load(): void | Promise<void>;
  ready(): boolean;
  start(context: GameContext): void;
  tick(input: GameInput): readonly PresentationEvent[];
  /** Called once by the framework after its final input drain. */
  finalize(): Outcome[];
  snapshot(): S;
  disconnect(playerId: string, time: number): void;
  reconnect(playerId: string): void;
  dispose(): void;
}

export interface RoundProgress {
  revision: number;
  totals: Record<string, number>;
  awards: Record<string, number>;
}

export type CompactProgress = RoundProgress;

export interface RoundSnapshot<S extends object = object> {
  schemaVersion: 1;
  mode: string;
  roundId: string;
  gameId: string;
  phase: 'countdown' | 'running' | 'settling' | 'results' | 'aborted' | 'error';
  startAt: number;
  endAt: number;
  players: Player[];
  state: S | null;
  cursors: Record<string, Point>;
  events: PresentationEvent[];
  outcomes: Outcome[];
  progress: RoundProgress;
  error: string | null;
}

export interface Presentation<S extends object> {
  context: CanvasRenderingContext2D;
  width: number;
  height: number;
  time: number;
  delay: number;
  snapshot: ReadonlyDeep<RoundSnapshot<S>>;
  /** Immediate positions for this display; presentation only, never authoritative input. */
  readonly localCursors?: ReadonlyDeep<Record<string, Point>>;
  /** Display preference; renderers must not read browser globals to discover it. */
  readonly reducedMotion?: boolean;
}

export interface GameRenderer<S extends object> {
  render(presentation: Presentation<S>): void | readonly string[];
  dispose(): void;
}

export interface GameDescriptor<S extends object = object> {
  id: string;
  name: string;
  players: { min: number; max: number };
  durationMs: number;
  modes: readonly { id: string; name: string }[];
  defaultMode: string;
  instructions?: readonly string[];
  controls: ControllerRequirements;
  presentation: { cursors: boolean };
  /**
   * Optional. How long presses wait (ms) so presses from different phones reach
   * `tick` ordered by timestamp. Default and maximum 200; shorter feels more
   * responsive but orders fewer late arrivals.
   */
  arbitrationMs?: number;
  create(options?: { mode: string }): GameInstance<S>;
  createRenderer(): GameRenderer<S>;
  /** Validate game state at the snapshot boundary. */
  isState(value: unknown): value is S;
  /** Optional. Default is hold-before; never interpolate discrete fields. */
  interpolate?(before: S, after: S, ratio: number): S;
}
