import { rotateVector } from '../layout/rotation.ts';
import type { ControlDefinition, Vector } from '../api.ts';

export interface StickProps {
  /** Fraction of travel that reads as zero. */
  deadzone?: number;
  /** Centre the stick wherever the thumb lands instead of the pad centre. */
  floating?: boolean;
}

export const stick: ControlDefinition<StickProps> = {
  type: 'stick',
  displayName: 'Stick',
  description: 'An analog thumbstick. Centres where your thumb lands.',
  channel: 'value',
  kind: 'vector',
  throttle: true,
  drivesPointer: true,
  output:
    '{x, y} from −1 to 1 inside the unit circle (+y is down), dead zone applied; {0, 0} on release.',
  hint: '',
  variants: [],
  defaults: { deadzone: 0.12, floating: true },
  fields: [
    {
      key: 'deadzone',
      label: 'Dead zone',
      type: 'number',
      min: 0,
      max: 0.5,
      step: 0.02,
    },
    { key: 'floating', label: 'Centre under thumb', type: 'boolean' },
  ],
  recommendedSize: { w: 5, h: 5 },
  shapes: ['rounded', 'circle', 'square'],
  appearances: ['plain', 'tinted'],
  rotateOutput: (v, r) => rotateVector(v as Vector, r),
};
