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
export interface AimLockPolicy {
  rate: number;
  calmMs: number;
  maxMs: number;
  lookbackMs: number;
}
export type MotionCommand =
  | { type: 'press'; down: boolean; at: number }
  | { type: 'cancel'; at: number }
  | { type: 'recenter'; at: number }
  | { type: 'sensitivity'; value: number; at: number }
  | { type: 'aim-lock'; at: number; policy: AimLockPolicy }
  | { type: 'aim-release'; at: number; immediate?: true };
export type MotionOutput =
  | { type: 'value'; value: ControlValue; at: number }
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
  type: MotionInput | 'jolt';
  channel: Channel;
  kind: OutputKind;
  throttle: boolean;
  transport: { motionVector: boolean; pressSlots: 0 | 1 };
  availability(capabilities: Readonly<Capabilities>): Availability;
  validateConfig(value: unknown): Validated<P>;
  parseValue(value: unknown): ControlValue | undefined;
  parseActivation(value: unknown): ControlValue | undefined;
  create(clocks: MotionClocks): MotionInputProcessor<P>;
}
