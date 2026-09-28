import type { Capabilities, ControlValue } from '../controls/api.ts';
export type Role = 'host' | 'display' | 'controller';
export type Point = { x: number; y: number };
export type Quaternion = [number, number, number, number];
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
