// The palette a control can be coloured from (pure data: the designer and
// validation read it). The hues themselves are tokens: --ctl-hue-<name>.
import type { ControlColor } from './api.ts';

export const CONTROL_COLORS: readonly ControlColor[] = [
  'player',
  'red',
  'orange',
  'yellow',
  'green',
  'mint',
  'teal',
  'blue',
  'indigo',
  'purple',
  'pink',
  'white',
];

export const isControlColor = (v: unknown): v is ControlColor =>
  CONTROL_COLORS.includes(v as ControlColor);
