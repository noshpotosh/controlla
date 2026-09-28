// Shared contracts for the controller library. Pure types: safe to import from
// core/session code that must not pull in React.
import type { Widget, WidgetType } from '../core/types.ts';
import type { Rotation } from './layout/schema.ts';

/**
 * How a control reports to the game.
 * - `press`: occupies one of the 4 press slots (timestamped edges + journal).
 * - `value`: sends semantic values that land in `InputFrame.values[action]`.
 * - `both`: sends a value, then a press edge the game can time exactly.
 */
export type Channel = 'press' | 'value' | 'both';

/**
 * The shape of what a control emits. A layout may swap one control for
 * another only when the kinds match (a D-pad for a stick, never a button).
 */
export type OutputKind =
  | 'vector'
  | 'press'
  | 'swipe'
  | 'charge'
  | 'scalar'
  | 'angle'
  | 'text'
  | 'stroke';

/** An editable prop, rendered by the designer's inspector. */
export type Field = { key: string; label: string } & (
  | { type: 'number'; min: number; max: number; step: number }
  | { type: 'boolean' }
  | { type: 'select'; options: readonly (string | number)[] }
  | { type: 'icon' }
  | { type: 'text' }
);

export interface ControlDefinition<P extends object = object> {
  type: WidgetType;
  displayName: string;
  /** One line for the gallery and docs. */
  description: string;
  channel: Channel;
  kind: OutputKind;
  /** Continuous values are rate-limited (latest value always delivered). */
  throttle: boolean;
  /** Values also steer the frame's x/y (legacy cursor/racer path). */
  drivesPointer?: boolean;
  /** Human-readable description of what the game receives. */
  output: string;
  /** Default hint shown under the control; games may override via props.hint. */
  hint: string;
  variants: readonly string[];
  defaults: P;
  /** Props the designer can edit (the shared `hint` is always editable). */
  fields: readonly Field[];
  /** Smallest footprint in layout grid cells (portrait 12×24 grid). */
  minSize: { w: number; h: number };
  /**
   * Map a value from the control's own frame to the screen frame when the
   * control is placed rotated. Omit for values with no direction.
   */
  rotateOutput?: (value: unknown, rotation: Rotation) => unknown;
}

/** Everything a control may do. Views never touch the Runtime directly. */
export interface ControlPort {
  value: (value: unknown) => void;
  press: (down: boolean) => void;
  /** Short vibration on activation; the port decides whether haptics are on. */
  haptic: (ms?: number) => void;
}

/** Props every control view receives. */
export interface ControlViewProps<P extends object = object> {
  widget: Widget;
  port: ControlPort;
  props: P & CommonProps;
}

/** Props shared by every control, settable from a game's manifest. */
export interface CommonProps {
  hint?: string;
  /** Hide the caption/hint chrome (e.g. very small slots). */
  bare?: boolean;
}

// Typed outputs, for games reading `InputFrame.values[action]`.
export type Vector = { x: number; y: number };
export type DpadOutput = Vector;
export type StickOutput = Vector;
export type SwipeDirection = 'up' | 'down' | 'left' | 'right';
export interface SwipeOutput {
  dir: SwipeDirection;
  /** Displacement as a fraction of the pad size; +y is down. */
  x: number;
  y: number;
  distance: number;
  /** Pad-sizes per second. */
  velocity: number;
}
export interface HoldOutput {
  charge: number;
  /** True on the final value sent at release (followed by a press edge). */
  released: boolean;
}
