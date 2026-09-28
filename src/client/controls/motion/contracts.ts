import type { Capabilities, Permission } from '../api.ts';
export type MotionStatus =
  | 'prompt'
  | 'requesting'
  | 'waiting'
  | 'active'
  | 'suspended'
  | 'unavailable'
  | 'disposed';
type Frozen<T> = T extends object
  ? { readonly [K in keyof T]: Frozen<T[K]> }
  : T;
export interface MotionSnapshot {
  readonly status: MotionStatus;
  readonly permission: Permission;
  readonly capabilities: Frozen<Capabilities>;
  readonly epoch: number;
  readonly sequence: number;
  readonly at: number | null;
  readonly accelFresh: boolean;
  readonly pointerFresh: boolean;
  readonly confidence: number;
  readonly rateHz: number;
  readonly rate: readonly number[];
  readonly gravity: readonly number[];
  readonly up: readonly number[];
  readonly tilt: Readonly<{ x: number; y: number }>;
}
