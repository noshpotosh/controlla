import type { ControlDefinition } from '../types.ts';

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
  throttle: true,
  drivesPointer: true,
  output:
    '{x, y} from −1 to 1 inside the unit circle (+y is down), dead zone applied; {0, 0} on release.',
  hint: '',
  variants: [],
  defaults: { deadzone: 0.12, floating: true },
};
