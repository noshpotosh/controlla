import type { ControlDefinition } from '../types.ts';

export interface DpadProps {
  /** 4-way (arrows only) or 8-way (adds diagonals). */
  directions?: 4 | 8;
}

export const dpad: ControlDefinition<DpadProps> = {
  type: 'dpad',
  displayName: 'D-pad',
  description: 'Four or eight fixed directions. Slide your thumb between them.',
  channel: 'value',
  throttle: false,
  drivesPointer: true,
  output: '{x, y} each −1, 0 or 1 (+y is down); {0, 0} on release.',
  hint: '',
  variants: [],
  defaults: { directions: 4 },
};
