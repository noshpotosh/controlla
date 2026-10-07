import type { GameDescriptor } from '../../api/index.ts';
import {
  __CLASS__Game,
  is__CLASS__State,
  type __CLASS__State,
} from './game.ts';
import { __CLASS__Renderer } from './renderer.ts';

export const __EXPORT__: GameDescriptor<__CLASS__State> = {
  id: '__SLUG__',
  name: '__TITLE__',
  players: { min: 1, max: 8 },
  timing: { kind: 'timed', durationMs: 15000 },
  modes: [{ id: 'standard', name: 'Standard' }],
  defaultMode: 'standard',
  instructions: [
    'Press SCORE to earn a point. Replace these starter rules with your game.',
  ],
  controls: {
    inputs: { score: { required: true, prefer: 'button', label: 'SCORE' } },
  },
  presentation: { cursors: false },
  create: () => new __CLASS__Game(),
  createRenderer: () => new __CLASS__Renderer(),
  isState: is__CLASS__State,
};
