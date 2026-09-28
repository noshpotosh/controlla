export type Point = { x: number; y: number };
export type Quaternion = [number, number, number, number];
export const clamp = (x: number, low = 0, high = 1) =>
  Math.min(high, Math.max(low, x));
