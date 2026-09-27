import { rotateVector } from '../layout/rotation.ts';
import type { ControlDefinition, Vector } from '../types.ts';

export interface DpadProps {
  /** 4-way (arrows only) or 8-way (adds diagonals). */
  directions?: 4 | 8;
}

export const dpad: ControlDefinition<DpadProps> = {
  type: 'dpad',
  displayName: 'D-pad',
  description: 'Four or eight fixed directions. Slide your thumb between them.',
  channel: 'value',
  kind: 'vector',
  throttle: false,
  drivesPointer: true,
  output: '{x, y} each −1, 0 or 1 (+y is down); {0, 0} on release.',
  hint: '',
  variants: [],
  defaults: { directions: 4 },
  fields: [
    { key: 'directions', label: 'Directions', type: 'select', options: [4, 8] },
  ],
  minSize: { w: 5, h: 5 },
  rotateOutput: (v, r) => rotateVector(v as Vector, r),
};
