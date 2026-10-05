import type { GameDescriptor } from '../../api/index.ts';
import { DoubleDash, isDoubleDashState, type DoubleDashState } from './game.ts';
import { DoubleDashRenderer } from './renderer.ts';

export const doubleDash: GameDescriptor<DoubleDashState> = {
  id: 'double-dash',
  name: 'Mario Kart: Double Dash!!',
  players: { min: 1, max: 4 },
  durationMs: 60 * 60 * 1000,
  durationLabel: 'Free play',
  modes: [{ id: 'free-play', name: 'Free play' }],
  defaultMode: 'free-play',
  instructions: [
    'Tilt your phone to steer. Hold Accelerate; hold Drift through corners.',
    'Use the menu arrows and Accelerate to select racers and tracks. Brake goes back.',
    'On Start / Swap, press up to start or pause; press down to swap riders.',
    'Choose multiplayer in the game for up to four phones. End game returns to the room (one-hour session limit).',
    'Play on the host computer using your local Double Dash game image.',
  ],
  controls: {
    inputs: {
      steer: {
        required: true,
        prefer: 'tilt',
        fallback: 'stick',
        label: 'Steer',
      },
      navigate: { required: true, prefer: 'dpad', label: 'Menus' },
      options: { required: true, prefer: 'dpad', label: 'Start / Swap' },
      accelerate: {
        required: true,
        prefer: 'button',
        held: true,
        label: 'Accelerate / Confirm',
      },
      brake: {
        required: true,
        prefer: 'button',
        held: true,
        label: 'Brake / Back',
      },
      drift: { required: true, prefer: 'button', held: true, label: 'Drift' },
      item: { required: true, prefer: 'button', held: true, label: 'Item' },
    },
    controller: { layout: 'double-dash' },
  },
  presentation: { cursors: false },
  arbitrationMs: 0,
  create: () => new DoubleDash(),
  createRenderer: () => new DoubleDashRenderer(),
  isState: isDoubleDashState,
};
