import type { ControlDefinition } from '../types.ts';

export interface SwipePadProps {
  /** Shortest swipe that counts, as a fraction of the pad's shorter side. */
  minDistance?: number;
}

export const swipePad: ControlDefinition<SwipePadProps> = {
  type: 'swipe-pad',
  displayName: 'Swipe pad',
  description: 'Flick across the pad. Direction, length and speed all count.',
  channel: 'both',
  throttle: false,
  output:
    'On lift: {dir, x, y, distance, velocity} then a press edge. Too-short swipes are ignored.',
  hint: 'Swipe',
  variants: [],
  defaults: { minDistance: 0.12 },
};
