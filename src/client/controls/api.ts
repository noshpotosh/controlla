/** Shared controller contracts. Pure types, with no runtime or UI dependencies. */
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

/** Semantic input requirements and their named controller layout bindings. */
export interface ControllerRequirements {
  inputs: Record<string, InputRequirement>;
  /** Inputs bind to same-named controls unless explicitly remapped here. */
  controller?: { layout: string; bind?: Record<string, string> };
}

/** Controller resolver input; contains no game lifecycle or scoring policy. */
export interface ControllerSpec extends ControllerRequirements {
  id: string;
  name: string;
  /** Preset for generated layouts; inferred from input count when omitted. */
  layout?: LayoutPreset;
}

export type Orientation = 'portrait' | 'landscape';
export type Rotation = 0 | 90 | 180 | 270;
export type MenuCorner =
  | 'top-left'
  | 'top-right'
  | 'bottom-left'
  | 'bottom-right';

/** Motion inputs a layout can switch on. They have no on-screen footprint. */
export type MotionInput = 'pointer' | 'tilt' | 'shake';

export interface GridRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface LayoutItem {
  /** Unique within the layout; game inputs bind to this name. */
  name: string;
  /** A touch control from the library (never a motion input). */
  type: WidgetType;
  /** Position and size in grid cells. */
  rect: GridRect;
  rotation: Rotation;
  label?: string;
  variant?: string;
  props?: Record<string, unknown>;
}

export interface ControllerLayout {
  schemaVersion: 2;
  /** Unique slug; also the file name. Fixed once created. */
  id: string;
  /** Display name; free to change. */
  name: string;
  orientation: Orientation;
  grid: { cols: number; rows: number };
  /** Corner reserved for the menu button. */
  menu: MenuCorner;
  /** Motion inputs this layout turns on. */
  motion: Record<MotionInput, boolean>;
  items: LayoutItem[];
}

/** Starting arrangements for a generated or newly designed layout. */
export type LayoutPreset = 'single' | 'stack' | 'duo' | 'gamepad';

/**
 * How a control reports to its adapter.
 * - `press`: occupies one of the 4 press slots (timestamped edges + journal).
 * - `value`: sends semantic values associated with a named action.
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

/**
 * The silhouette a control's frame takes inside its cell. `circle` is the
 * largest circle that fits; `capsule` rounds the short sides fully.
 */
export type ControlShape = 'rounded' | 'square' | 'circle' | 'capsule';

/**
 * How much colour a control carries at rest: `filled` is solid tone,
 * `tinted` washes the surface with it, `plain` is a neutral surface.
 */
export type ControlAppearance = 'filled' | 'tinted' | 'plain';

/**
 * A control's own colour. `player` follows the player's roster colour (the
 * default); the rest are a fixed palette, so one layout can colour-code its
 * controls. Every hue is light enough for dark ink.
 */
export type ControlColor =
  | 'player'
  | 'red'
  | 'orange'
  | 'yellow'
  | 'green'
  | 'mint'
  | 'teal'
  | 'blue'
  | 'indigo'
  | 'purple'
  | 'pink'
  | 'white';

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
  /** Values can also steer the shared pointer coordinates. */
  drivesPointer?: boolean;
  /** Human-readable description of what the game receives. */
  output: string;
  /** Default hint shown under the control; games may override via props.hint. */
  hint: string;
  variants: readonly string[];
  defaults: P;
  /** Props the designer can edit (the shared `hint` is always editable). */
  fields: readonly Field[];
  /**
   * Comfortable footprint in layout grid cells (portrait 12×24 grid). New
   * controls start this size; smaller is allowed but flagged in the designer.
   */
  recommendedSize: { w: number; h: number };
  /** Shapes the control supports; the first is its default. */
  shapes: readonly ControlShape[];
  /** Appearances the control supports; the first is its default. */
  appearances: readonly ControlAppearance[];
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

export interface StrokeOutput {
  x: number;
  y: number;
  pressure: number;
  phase: 'move';
}

export type ControlValue =
  | number
  | string
  | Vector
  | SwipeOutput
  | HoldOutput
  | StrokeOutput;
