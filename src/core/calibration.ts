import type { Quaternion, Point } from './types.ts';
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
export function tangent(ref: Quaternion, q: Quaternion): Point {
  const [x, y, z] = rotate(multiply(inverse(ref), q), [0, 0, -1]);
  if (-z < 0.03) throw new Error('Aim toward the screen');
  return { x: x / -z, y: -y / -z };
}
export function project(h: number[], p: Point): Point {
  const d = h[6] * p.x + h[7] * p.y + h[8];
  if (Math.abs(d) < 1e-8) throw new Error('Pointer is outside projection');
  return {
    x: (h[0] * p.x + h[1] * p.y + h[2]) / d,
    y: (h[3] * p.x + h[4] * p.y + h[5]) / d,
  };
}
export function solve(a: number[][]): number[] {
  const n = a.length;
  let maxPivot = 0,
    minPivot = Infinity;
  for (let c = 0; c < n; c++) {
    let row = c;
    for (let r = c + 1; r < n; r++)
      if (Math.abs(a[r][c]) > Math.abs(a[row][c])) row = r;
    [a[c], a[row]] = [a[row], a[c]];
    const pivot = a[c][c];
    if (Math.abs(pivot) < 1e-9)
      throw new Error(
        'Calibration points are too close. Aim at all four corners.',
      );
    maxPivot = Math.max(maxPivot, Math.abs(pivot));
    minPivot = Math.min(minPivot, Math.abs(pivot));
    for (let k = c; k <= n; k++) a[c][k] /= pivot;
    for (let r = 0; r < n; r++)
      if (r !== c) {
        const f = a[r][c];
        for (let k = c; k <= n; k++) a[r][k] -= f * a[c][k];
      }
  }
  if (maxPivot / minPivot > 1e7)
    throw new Error('Unstable calibration. Hold still and try again.');
  return a.map((row) => row[n]);
}
export function fitHomography(points: Point[]): number[] {
  if (points.length !== 4) throw new Error('Four corners required');
  const cross = points.map((p, i) => {
    const b = points[(i + 1) % 4],
      c = points[(i + 2) % 4];
    return (b.x - p.x) * (c.y - b.y) - (b.y - p.y) * (c.x - b.x);
  });
  if (
    cross.some((v) => Math.abs(v) < 1e-5) ||
    !cross.every((v) => Math.sign(v) === Math.sign(cross[0]))
  )
    throw new Error(
      'Corners must form a rectangle in order: top-left, top-right, bottom-right, bottom-left.',
    );
  const targets = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
      { x: 0, y: 1 },
    ],
    a: number[][] = [];
  points.forEach(({ x, y }, i) => {
    const { x: u, y: v } = targets[i];
    a.push(
      [x, y, 1, 0, 0, 0, -u * x, -u * y, u],
      [0, 0, 0, x, y, 1, -v * x, -v * y, v],
    );
  });
  return [...solve(a), 1];
}
export interface Calibration {
  ref: Quaternion;
  h: number[];
  at: number;
  count: number;
  recenters: number;
  roll: number;
}
export function calibrate(
  samples: Quaternion[],
  previous?: Calibration,
): Calibration {
  if (samples.length !== 5) throw new Error('Five samples required');
  const h = fitHomography(samples.slice(1).map((q) => tangent(samples[0], q)));
  const center = project(h, { x: 0, y: 0 });
  if (Math.hypot(center.x - 0.5, center.y - 0.5) > 0.18)
    throw new Error('Center does not match the corners. Try again.');
  return {
    ref: samples[0],
    h,
    at: Date.now(),
    count: (previous?.count ?? 0) + 1,
    recenters: previous?.recenters ?? 0,
    roll: 0,
  };
}
export function recenter(cal: Calibration, current: Quaternion): Calibration {
  // A hand-fitted H need not map tangent origin to exact screen center.
  const h = cal.h,
    [x, y] = solve([
      [h[0] - 0.5 * h[6], h[1] - 0.5 * h[7], 0.5 * h[8] - h[2]],
      [h[3] - 0.5 * h[6], h[4] - 0.5 * h[7], 0.5 * h[8] - h[5]],
    ]);
  const to = [x, -y, -1],
    n = Math.hypot(...to),
    v = to.map((c) => c / n);
  const rotation = normalize([v[1], -v[0], 0, 1 - v[2]]);
  return {
    ...cal,
    ref: multiply(current, inverse(rotation)),
    recenters: cal.recenters + 1,
  };
}
