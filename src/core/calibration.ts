import type { Quaternion } from './types.ts';
export const identity: Quaternion = [0, 0, 0, 1];
export const normalize = (q: Quaternion): Quaternion => {
  const n = Math.hypot(...q);
  if (n < 1e-10) throw new Error('Invalid orientation');
  return q.map((v) => v / n) as Quaternion;
};
export const inverse = (q: Quaternion): Quaternion => [
  -q[0],
  -q[1],
  -q[2],
  q[3],
];
export function multiply(a: Quaternion, b: Quaternion): Quaternion {
  const [x, y, z, w] = a,
    [X, Y, Z, W] = b;
  return normalize([
    w * X + x * W + y * Z - z * Y,
    w * Y - x * Z + y * W + z * X,
    w * Z + x * Y - y * X + z * W,
    w * W - x * X - y * Y - z * Z,
  ]);
}
export function axisAngle(
  x: number,
  y: number,
  z: number,
  angle: number,
): Quaternion {
  const n = Math.hypot(x, y, z);
  if (n < 1e-10) return [...identity];
  const s = Math.sin(angle / 2) / n;
  return [x * s, y * s, z * s, Math.cos(angle / 2)];
}
export function rotate(q: Quaternion, v: number[]): number[] {
  const [x, y, z, w] = q,
    [a, b, c] = v;
  const tx = 2 * (y * c - z * b),
    ty = 2 * (z * a - x * c),
    tz = 2 * (x * b - y * a);
  return [
    a + w * tx + y * tz - z * ty,
    b + w * ty + z * tx - x * tz,
    c + w * tz + x * ty - y * tx,
  ];
}
