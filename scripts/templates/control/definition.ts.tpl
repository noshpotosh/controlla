import type { ControlDefinition } from '../types.ts';

export interface __PASCAL__Props {
  /** Example tunable prop; rename or remove. Defaults go in `defaults`. */
  sensitivity?: number;
}

export const __CAMEL__: ControlDefinition<__PASCAL__Props> = {
  type: '__TYPE__',
  displayName: '__TITLE__',
  description: 'TODO: one line on what the player does.',
  channel: 'value',
  throttle: true,
  output: 'TODO: exactly what the game receives.',
  hint: '',
  variants: [],
  defaults: { sensitivity: 1 },
};
