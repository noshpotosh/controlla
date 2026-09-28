// Pure gesture math shared by controls. No DOM, so it runs under node:test.
import type { SwipeDirection, Vector } from '../api.ts';

export const clamp = (x: number, low = -1, high = 1) =>
  Math.min(high, Math.max(low, x));

/** Keep a vector inside the unit circle. */
export function radialClamp(v: Vector, max = 1): Vector {
  const m = Math.hypot(v.x, v.y);
  return m <= max ? v : { x: (v.x / m) * max, y: (v.y / m) * max };
}

/**
 * Radial dead zone that rescales the live range so output still reaches 1:
 * magnitudes below `zone` read 0, then ramp linearly to full at the rim.
 */
export function deadzone(v: Vector, zone: number): Vector {
  const m = Math.hypot(v.x, v.y);
  if (m <= zone) return { x: 0, y: 0 };
  const scaled = Math.min(1, (m - zone) / (1 - zone));
  return { x: (v.x / m) * scaled, y: (v.y / m) * scaled };
}

/** Snap an offset to 4 or 8 unit directions (screen space, +y down). */
export function snapDirection(v: Vector, directions: 4 | 8): Vector {
  if (v.x === 0 && v.y === 0) return { x: 0, y: 0 };
  const sectors = directions,
    step = (Math.PI * 2) / sectors,
    index = Math.round(Math.atan2(v.y, v.x) / step),
    angle = index * step;
  // Round away float noise so diagonals are exactly ±1.
  return {
    x: Math.round(Math.cos(angle)) || 0,
    y: Math.round(Math.sin(angle)) || 0,
  };
}

export function dominantDirection(v: Vector): SwipeDirection {
  return Math.abs(v.x) >= Math.abs(v.y)
    ? v.x < 0
      ? 'left'
      : 'right'
    : v.y < 0
      ? 'up'
      : 'down';
}

export const round = (x: number, places = 3) =>
  Math.round(x * 10 ** places) / 10 ** places;
