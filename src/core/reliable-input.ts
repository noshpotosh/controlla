import type { ControlValue } from '../controls/value.ts';

export interface WidgetValueMessage {
  type: 'widget';
  action: string;
  generation: number;
  /** Monotonic per action within one configuration generation. */
  seq: number;
  /** Authority-clock time captured when the control produced this value. */
  time: number;
  value: ControlValue;
}
