// Pure gesture math for __TITLE__ (no DOM) so it can be unit tested.
import { round } from '../kit/geometry.ts';

export function __CAMEL__Value(x: number, y: number) {
  return { x: round(x), y: round(y) };
}
