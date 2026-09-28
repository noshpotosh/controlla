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
  kind: 'charge',
  throttle: true,
  output:
    '{charge 0–1, released:false} while held; on release {charge, released:true} then a press edge.',
  hint: 'Hold, then let go',
  variants: [],
  defaults: { holdMs: 1000 },
  fields: [
    {
      key: 'holdMs',
      label: 'Time to full (ms)',
      type: 'number',
      min: 200,
      max: 4000,
      step: 100,
    },
  ],
  minSize: { w: 4, h: 4 },
};
