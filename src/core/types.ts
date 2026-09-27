import type { LayoutPreset } from '../controls/layouts.ts';
export type Role = 'host' | 'display' | 'controller';
export type Point = { x: number; y: number };
export type Quaternion = [number, number, number, number];
export type Permission = 'prompt' | 'granted' | 'denied' | 'unavailable';
export interface Capabilities {
  sensors: {
    gyro: { present: boolean; permission: Permission };
    accel: { present: boolean; permission: Permission };
  };
  maxTouchPoints: number;
  vibration: boolean;
  refreshRateHz: number;
  devicePixelRatio: number;
  safeAreaInsets: { top: number; bottom: number; left: number; right: number };
  viewport: { w: number; h: number };
}
export type WidgetType =
  | 'button'
  | 'dpad'
  | 'stick'
  | 'swipe-pad'
  | 'draw-canvas'
  | 'slider'
  | 'dial'
  | 'hold-meter'
  | 'tilt'
  | 'shake'
  | 'pointer'
  | 'text';
export interface Widget {
  id: string;
  type: WidgetType;
  label: string;
  action: string;
  /** Named slot in the config's layout preset (see src/controls/layouts.ts). */
  slot?: string;
  /** Normalized [x, y, w, h]; only used by the `custom` layout. */
  rect?: [number, number, number, number];
  /** Visual variant from the control's definition (e.g. button tone). */
  variant?: string;
  /** Control-specific props; defaults come from the control's definition. */
  props?: Record<string, unknown>;
  space?: 'normalized' | 'signed';
}
export interface ControllerConfig {
  schemaVersion: 1;
  configId: string;
  generation: number;
  orientation: 'portrait' | 'landscape' | 'any';
  layout: LayoutPreset;
  sensors: {
    pointer: { enabled: boolean; rateHz: number };
    tilt: { enabled: boolean };
    shake: { enabled: boolean; thresholdG: number };
    accel: { enabled: boolean };
  };
  haptics: { enabled: boolean };
  widgets: Widget[];
  substitutions: string[];
}
export interface InputRequirement {
  required: boolean;
  prefer: WidgetType;
  fallback?: WidgetType | null;
  /** Caption shown on the phone; defaults to the action name. */
  label?: string;
  slot?: string;
  variant?: string;
  props?: Record<string, unknown>;
}
export interface Manifest {
  id: string;
  name: string;
  players: { min: number; max: number };
  inputs: Record<string, InputRequirement>;
  /** Controller layout preset; picked from the input count when omitted. */
  layout?: LayoutPreset;
  expectedDurationSec: number;
  scoring: 'points' | 'time';
  onPlayerDropped: 'pause' | 'substitute' | 'freeze';
  retroactiveInput: boolean;
  interpolatable: string[];
  discrete: string[];
}
export interface Player {
  id: string;
  venueId: string;
  seat: number;
  name: string;
  color: string;
  connected: boolean;
  disconnectedAt?: number;
  capabilities?: Capabilities;
}
export interface Venue {
  id: string;
  name: string;
  connected: boolean;
}
export interface Roster {
  players: Player[];
  venues: Venue[];
}
export interface Identity {
  id: string;
  role: Role;
  room: string;
  venueId: string;
  token: string;
  hostId: string;
}
export interface InputFrame {
  seq: number;
  time: number;
  generation: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  buttons: number;
  edges: number[];
  edgeTimes: number[];
  confidence: number;
  values?: Record<string, unknown>;
}
export interface Press {
  playerId: string;
  generation: number;
  button: number;
  counter: number;
  time: number;
  x: number;
  y: number;
}
export interface GameEvent {
  id: string;
  time: number;
  kind: 'hit' | 'prompt' | 'end';
  playerId?: string;
}
export interface GameState {
  gameId: string;
  mode: string;
  phase: 'lobby' | 'countdown' | 'running' | 'results';
  startAt: number;
  endAt: number;
  target: Point;
  targetAt: number;
  promptId: number;
  scores: Record<string, number>;
  cursors: Record<string, Point>;
  racers: Record<string, Point>;
  results: Result[];
  flash: boolean;
}
export interface Result {
  playerId: string;
  score: number;
  rank: number;
  stats: Record<string, number>;
}
export interface Snapshot {
  id: number;
  time: number;
  state: GameState;
}
export interface WireSnapshot {
  id: number;
  time: number;
  base: number | null;
  patch: Partial<GameState>;
}
// Extensible wire envelopes are validated by role and message handlers at ingress.
// oxlint-disable-next-line typescript/no-explicit-any -- heterogeneous JSON wire envelope
export type Message = { type: string; [key: string]: any };
export const COLORS = [
  '#b6ff65',
  '#74d9ff',
  '#ff91bc',
  '#ffc66e',
  '#b7a0ff',
  '#72f0cd',
  '#ff8066',
  '#eaf1ff',
];
export const now = () => performance.now();
export const clamp = (x: number, low = 0, high = 1) =>
  Math.min(high, Math.max(low, x));
