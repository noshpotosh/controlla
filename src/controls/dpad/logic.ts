import { snapDirection } from '../kit/geometry.ts';
import type { DpadOutput, Vector } from '../types.ts';

/** Offsets closer to the centre than this (fraction of radius) read neutral. */
export const DPAD_CENTER_ZONE = 0.22;

/** Map a touch offset from the pad centre (−1..1 each axis) to a direction. */
export function dpadDirection(offset: Vector, directions: 4 | 8): DpadOutput {
  return Math.hypot(offset.x, offset.y) < DPAD_CENTER_ZONE
    ? { x: 0, y: 0 }
    : snapDirection(offset, directions);
}

export const sameDirection = (a: DpadOutput, b: DpadOutput) =>
  a.x === b.x && a.y === b.y;
