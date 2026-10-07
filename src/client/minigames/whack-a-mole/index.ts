import type { GameDescriptor } from '../../api/index.ts';
import { WhackAMole, isWhackState } from './game.ts';
import { AIM_BOUNDS, WHACK, type WhackState } from './model.ts';
import { WhackAMoleRenderer } from './renderer.ts';

export const whackAMole: GameDescriptor<WhackState> = {
  id: 'whack-a-mole',
  name: 'Whack-a-Mole',
  instructions: [
    'Point your phone at the screen to move your hammer.',
    'Hold the button to lock your aim, then swing to whack: 10 points, golden moles 30.',
    'Each mole can only be whacked once, so be first!',
    "Don't hit bomb moles: lose 20 points and get dizzy.",
    'Score double in the final ten-second frenzy.',
  ],
  players: { min: 1, max: 8 },
  timing: { kind: 'timed', durationMs: WHACK.duration },
  modes: [{ id: 'standard', name: 'Standard' }],
  defaultMode: 'standard',
  controls: {
    inputs: {
      aim: {
        required: true,
        prefer: 'pointer',
        fallback: 'aim-pad',
        label: 'Aim',
        motion: { bounds: AIM_BOUNDS },
      },
      whack: {
        required: true,
        prefer: 'chop',
        fallback: 'button',
        label: 'Whack',
      },
    },
    controller: { layout: 'aim-and-whack' },
  },
  presentation: { cursors: false },
  // A whack is dated to the start of the swing; a short window keeps it snappy
  // while still ordering near-simultaneous whacks on the same mole.
  arbitrationMs: 40,
  create: () => new WhackAMole(),
  createRenderer: () => new WhackAMoleRenderer(),
  isState: isWhackState,
};
