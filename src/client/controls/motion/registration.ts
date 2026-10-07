import type { AimLockPolicy, MotionCommand } from './contracts.ts';
export type {
  AimLockPolicy,
  MotionCommand,
  MotionControlCommand,
  MotionControlState,
  MotionControlPort,
} from './contracts.ts';
/** Pure semantic motion contracts. Presentation is registered separately. */
import type {
  Capabilities,
  Channel,
  ControlValue,
  MotionInput,
  OutputKind,
} from '../api.ts';
import type { MotionSnapshot } from './contracts.ts';

export type Vec3 = readonly [number, number, number];
export type Availability =
  | { available: true }
  | { available: false; reason: string };
export type Validated<T> =
  | { ok: true; value: T }
  | { ok: false; reason: string };
export interface MotionClocks {
  localTime(): number;
  authorityTime(localAt: number): number;
}
export interface ValidatedMotionSample extends MotionSnapshot {
  readonly linearAcceleration: Vec3 | null;
}
export type MotionOutput =
  | { type: 'value'; value: ControlValue; at: number; confidence?: number }
  | {
      type: 'activation';
      value?: ControlValue;
      at: number;
      capture?: 'locked-aim';
    }
  | {
      type: 'aim-lock';
      captureAt: number;
      policy: AimLockPolicy;
    }
  | { type: 'aim-release'; at: number; immediate?: true }
  | { type: 'held'; down: boolean }
  | { type: 'haptic'; ms: number };
export interface MotionInputProcessor<P extends object> {
  configure(config: Readonly<P>): void;
  process(sample: ValidatedMotionSample): readonly MotionOutput[];
  command(command: MotionCommand): readonly MotionOutput[];
  reset(reason: 'epoch' | 'inactive' | 'configuration' | 'cancel'): void;
  dispose(): void;
}
export interface MotionDefinition<P extends object> {
  type: MotionInput;
  description: string;
  channel: Channel;
  kind: OutputKind;
  throttle: boolean;
  calibration?: { recenter: boolean };
  transport: { motionVector: boolean; pressSlots: 0 | 1 };
  availability(capabilities: Readonly<Capabilities>): Availability;
  validateConfig(value: unknown): Validated<P>;
  parseValue(value: unknown): ControlValue | undefined;
  parseActivation(value: unknown): ControlValue | undefined;
  create(clocks: MotionClocks): MotionInputProcessor<P>;
}

/** Pure resolution/validation metadata cannot reach sensor or processor implementations. */
export type MotionMetadata<P extends object> = Omit<
  MotionDefinition<P>,
  'create'
>;

/** InputFrame carries four timestamped press slots, shared by touch and motion. */
export const PRESS_SLOTS = 4;
