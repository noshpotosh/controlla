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
/** Where the phone's top edge points, for anchoring aim to the real world. */
export interface AimReference {
  /** Heading (rad, clockwise), or null when the top edge is too steep to tell. */
  readonly yaw: number | null;
  /** Elevation of the top edge (rad, up positive), or null before gravity settles. */
  readonly pitch: number | null;
  /** Heading is held to the compass, so slow turns and gyro drift show up in it. */
  readonly anchored: boolean;
  /** Changes whenever the reference jumps: re-aligned, or the grip flipped. */
  readonly epoch: number;
}
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
  /** Where the top edge points, from gravity and, when available, the compass. */
  readonly aim: AimReference;
  /** The latest compass reading (degrees clockwise from north), for diagnostics. */
  readonly compass: Readonly<{
    fresh: boolean;
    heading: number | null;
    accuracy: number | null;
  }>;
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
/** Commands are dated by the input owner, never by a retained view callback. */
export type MotionControlCommand = MotionCommand extends infer C
  ? C extends MotionCommand
    ? Omit<C, 'at'>
    : never
  : never;
export interface MotionControlState {
  readonly held: boolean;
  readonly activations: number;
  readonly point: Readonly<{ x: number; y: number }>;
}
export interface MotionControlPort {
  getSnapshot(this: void): MotionControlState;
  command(this: void, command: MotionControlCommand): void;
}
