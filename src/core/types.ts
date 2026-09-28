import type { ControlValue } from '../controls/value.ts';
import type { LayoutPreset } from '../controls/layouts.ts';
import type { MenuCorner, Rotation } from '../controls/layout/schema.ts';
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
  | 'aim-pad'
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
  /** Placement on the controller: normalized [x, y, w, h]. Motion inputs
   *  with no touch fallback have none and aren't drawn. */
  rect?: [number, number, number, number];
  /** Quarter-turn rotation; outputs are converted back to the screen frame. */
  rotation?: Rotation;
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
  /** Corner reserved for the menu button. */
  menu: MenuCorner;
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
  /**
   * The controller layout this game uses (an id in src/layouts). Inputs bind
   * to the layout's controls by name; `bind` maps input → control name when
   * they differ.
   */
  controller?: { layout: string; bind?: Record<string, string> };
  /** Preset used when there is no designed controller; picked from the input count when omitted. */
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
  /** Immutable semantic value captured with a value-bearing activation. */
  value?: ControlValue;
  playerId: string;
  generation: number;
  button: number;
  counter: number;
  time: number;
  x: number;
  y: number;
}
export interface Snapshot<S extends object = object> {
  id: number;
  time: number;
  state: S;
}
export interface WireSnapshot<S extends object = object> {
  id: number;
  time: number;
  base: number | null;
  patch: Partial<S>;
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
