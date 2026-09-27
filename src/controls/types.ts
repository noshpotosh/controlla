// Shared contracts for the controller library. Pure types: safe to import from
// core/session code that must not pull in React.
import type { Widget, WidgetType } from '../core/types.ts';

/**
 * How a control reports to the game.
 * - `press`: occupies one of the 4 press slots (timestamped edges + journal).
 * - `value`: sends semantic values that land in `InputFrame.values[action]`.
 * - `both`: sends a value, then a press edge the game can time exactly.
 */
export type Channel = 'press' | 'value' | 'both';

export interface ControlDefinition<P extends object = object> {
  type: WidgetType;
  displayName: string;
  /** One line for the gallery and docs. */
  description: string;
  channel: Channel;
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
