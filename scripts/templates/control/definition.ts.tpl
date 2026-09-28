import type { ControlDefinition } from '../api.ts';

export interface __PASCAL__Props {
  /** Example tunable prop; rename or remove. Defaults go in `defaults`. */
  sensitivity?: number;
}

export const __CAMEL__: ControlDefinition<__PASCAL__Props> = {
  type: '__TYPE__',
  displayName: '__TITLE__',
  description: 'TODO: one line on what the player does.',
  channel: 'value',
  // What it emits; a layout can only swap it for controls of the same kind.
  kind: 'vector',
  throttle: true,
  output: 'TODO: exactly what the game receives.',
  hint: '',
  variants: [],
  defaults: { sensitivity: 1 },
  // Editable in the designer's inspector.
  fields: [
    { key: 'sensitivity', label: 'Sensitivity', type: 'number', min: 0.1, max: 3, step: 0.1 },
  ],
  // Smallest footprint in layout grid cells (12×24 portrait grid).
  minSize: { w: 4, h: 4 },
};
