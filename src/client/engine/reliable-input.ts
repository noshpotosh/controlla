import type { ControlValue } from '../controls/api.ts';

export interface Press {
  /** Immutable semantic value captured with a value-bearing activation. */
  value?: ControlValue;
  playerId: string;
  generation: number;
  button: number;
  counter: number;
  time: number;
  x: number;
  y: number;
}

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
