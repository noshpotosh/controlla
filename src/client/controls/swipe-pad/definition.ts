import { rotateDirection, rotateVector } from '../layout/rotation.ts';
import type { ControlDefinition, SwipeOutput } from '../api.ts';

export interface SwipePadProps {
  /** Shortest swipe that counts, as a fraction of the pad's shorter side. */
  minDistance?: number;
}

export const swipePad: ControlDefinition<SwipePadProps> = {
  type: 'swipe-pad',
  displayName: 'Swipe pad',
  description: 'Flick across the pad. Direction, length and speed all count.',
  channel: 'both',
  kind: 'swipe',
  throttle: false,
  output:
    'On lift: {dir, x, y, distance, velocity} then a press edge. Too-short swipes are ignored.',
  hint: 'Swipe',
  variants: [],
  defaults: { minDistance: 0.12 },
  fields: [
    {
      key: 'minDistance',
      label: 'Shortest swipe',
      type: 'number',
      min: 0.04,
      max: 0.5,
      step: 0.02,
    },
  ],
  recommendedSize: { w: 4, h: 4 },
  shapes: ['rounded', 'square', 'capsule'],
  appearances: ['plain', 'tinted'],
  rotateOutput(value, r) {
    const s = value as SwipeOutput;
    return { ...s, ...rotateVector(s, r), dir: rotateDirection(s.dir, r) };
  },
};
