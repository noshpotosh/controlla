import { round } from '../kit/geometry.ts';

/** Charge from 0 to 1 after holding for `elapsedMs`. */
export const chargeAt = (elapsedMs: number, holdMs: number) =>
  round(Math.min(1, Math.max(0, elapsedMs / Math.max(1, holdMs))));
