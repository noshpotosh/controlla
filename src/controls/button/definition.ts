import type { ControlDefinition } from '../types.ts';
import type { IconName } from '../kit/icons.ts';

export interface ButtonProps {
  /** Glyph from the shared icon set; falls back to the label's first letter. */
  icon?: IconName;
}

export const button: ControlDefinition<ButtonProps> = {
  type: 'button',
  displayName: 'Button',
  description: 'A big, chunky action button. Tap or hold.',
  channel: 'press',
  throttle: false,
  output: 'Press and release edges, timestamped (Press journal).',
  hint: '',
  variants: ['accent', 'neutral', 'danger'],
  defaults: {},
};
