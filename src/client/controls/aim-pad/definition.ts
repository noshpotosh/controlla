import { rotateVector } from '../layout/rotation.ts';
import type { ControlDefinition, Vector } from '../api.ts';

export const aimPad: ControlDefinition = {
  type: 'aim-pad',
  displayName: 'Aim pad',
  description:
    'Absolute aim across the whole rectangle. Keeps its position when released.',
  channel: 'value',
  kind: 'vector',
  throttle: true,
  drivesPointer: true,
  output:
    '{x, y} in the square −1 to 1 (+y is down); starts at {0, 0} and holds its last position on release or cancellation. No press edge.',
  hint: 'Touch to aim · lift to hold',
  variants: [],
  defaults: {},
  fields: [],
  recommendedSize: { w: 5, h: 5 },
  shapes: ['rounded', 'square', 'circle'],
  appearances: ['plain', 'tinted'],
  rotateOutput: (value, rotation) => rotateVector(value as Vector, rotation),
};
