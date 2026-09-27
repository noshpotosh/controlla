import type { ControlDefinition } from '../types.ts';

export interface HoldMeterProps {
  /** Time to reach full charge. */
  holdMs?: number;
}

export const holdMeter: ControlDefinition<HoldMeterProps> = {
  type: 'hold-meter',
  displayName: 'Hold meter',
  description:
    'Press and hold to charge, release to fire. Great for power shots.',
  channel: 'both',
  throttle: true,
  output:
    '{charge 0–1, released:false} while held; on release {charge, released:true} then a press edge.',
  hint: 'Hold, then let go',
  variants: [],
  defaults: { holdMs: 1000 },
};
