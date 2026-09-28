// 90°-step rotation for placed controls. Controls compute in their own
// (unrotated) frame; these helpers convert touches in and outputs back out,
// so games always receive values in the frame the player sees.
import type { SwipeDirection, Vector } from '../types.ts';
import type { Rotation } from './schema.ts';

const turns = (r: Rotation) => (((r / 90) % 4) + 4) % 4;
// Avoid -0 so outputs compare cleanly.
const z = (n: number) => n + 0;

/** Rotate a screen-space vector clockwise by `r` (screen +y is down). */
export function rotateVector(v: Vector, r: Rotation): Vector {
  switch (turns(r)) {
    case 1:
      return { x: z(-v.y), y: z(v.x) };
    case 2:
      return { x: z(-v.x), y: z(-v.y) };
    case 3:
      return { x: z(v.y), y: z(-v.x) };
    default:
      return { x: v.x, y: v.y };
  }
}

/** Screen offset from a control's centre → offset in its own frame. */
export const toLocal = (screen: Vector, r: Rotation): Vector =>
  rotateVector(screen, ((360 - r) % 360) as Rotation);

/** Local-frame output → screen frame. */
export const toScreen = rotateVector;

const DIRS: SwipeDirection[] = ['up', 'right', 'down', 'left'];
export const rotateDirection = (d: SwipeDirection, r: Rotation) =>
  DIRS[(DIRS.indexOf(d) + turns(r)) % 4];

export const isSideways = (r: Rotation) => turns(r) % 2 === 1;
