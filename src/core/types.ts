import type { ControlValue } from '../client/controls/api.ts';
export type Point = { x: number; y: number };
export type Quaternion = [number, number, number, number];
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
export const now = () => performance.now();
export const clamp = (x: number, low = 0, high = 1) =>
  Math.min(high, Math.max(low, x));
