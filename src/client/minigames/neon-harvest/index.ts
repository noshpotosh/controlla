import { sounds } from './sounds.ts';
import type { GameDescriptor } from '../../api/index.ts';
import { NeonHarvest, isNeonHarvestState } from './game.ts';
import { HARVEST, type NeonHarvestState } from './model.ts';
import { NeonHarvestRenderer } from './renderer.ts';

export const neonHarvest: GameDescriptor<NeonHarvestState> = {
  id: 'neon-harvest',
  name: 'Neon Harvest',
  instructions: [
    'Steer to collect sparks for 10 points and gold for 30.',
    'Keep your chain going to build a multiplier up to 5×.',
    'Avoid mines: lose up to 50 points and get stunned for one second.',
    'PULSE collects nearby sparks and clears mines; recharges in six seconds.',
    'Score double points in the final ten seconds.',
  ],
  players: { min: 1, max: 8 },
  timing: { kind: 'timed', durationMs: HARVEST.duration },
  modes: [{ id: 'standard', name: 'Standard' }],
  defaultMode: 'standard',
  controls: {
    inputs: {
      aim: {
        required: true,
        prefer: 'pointer',
        fallback: 'aim-pad',
        label: 'Aim',
      },
      pulse: { required: true, prefer: 'button', label: 'PULSE' },
    },
    controller: { layout: 'aim-and-pulse' },
  },
  presentation: { cursors: false },
  sounds,
  create: () => new NeonHarvest(),
  createRenderer: () => new NeonHarvestRenderer(),
  isState: isNeonHarvestState,
};
