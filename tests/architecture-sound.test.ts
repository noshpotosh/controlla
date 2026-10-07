import assert from 'node:assert/strict';
import test from 'node:test';
import { validSounds } from '../src/client/engine/sound-policy.ts';
import { prepareAssignments } from '../src/client/engine/round-setup.ts';
import { RoundRunner } from '../src/client/engine/round.ts';
import { SessionProgress } from '../src/client/engine/progress.ts';
import { games } from '../src/client/minigames/catalog.ts';
import { simulatedPlayers } from '../src/client/devtools/game-harness/harness.ts';
import { buttonProbe } from './fixtures/games.ts';

const tone = { wave: 'sine', from: 440, length: 0.1, gain: 0.2 };
void test('sound declarations are bounded data and cannot override framework cues', () => {
  for (const game of games)
    if (game.sounds !== undefined)
      assert.equal(validSounds(game.sounds), true, game.id);
  for (const value of [
    null,
    [],
    { cue: [] },
    { cue: Array(9).fill(tone) },
    { prompt: [tone] },
    { end: [tone] },
    { '': [tone] },
    Object.fromEntries(
      Array.from({ length: 65 }, (_, i) => [String(i), [tone]]),
    ),
    ...[
      { from: 19 },
      { from: 20001 },
      { to: Infinity },
      { to: 0 },
      { at: -0.1 },
      { at: 2.1 },
      { length: 0 },
      { length: 2.1 },
      { gain: -1 },
      { gain: 1.01 },
      { wave: 'custom' },
      { noise: true },
      { noise: true, filter: 'lowpass' },
    ].map((patch) => ({ cue: [{ ...tone, ...patch }] })),
  ])
    assert.equal(validSounds(value), false, JSON.stringify(value));
  assert.equal(
    validSounds({
      cue: [
        {
          noise: true,
          filter: 'bandpass',
          from: 20,
          to: 20000,
          at: 2,
          length: 2,
          gain: 1,
        },
      ],
    }),
    true,
  );
  assert.equal(
    validSounds({
      cue: [{ wave: 'triangle', from: 20, length: 0.001, gain: 0 }],
    }),
    true,
  );
});

void test('invalid sound declarations fail setup before creating a candidate game', () => {
  let creates = 0,
    setups = 0;
  const descriptor = {
    ...buttonProbe,
    sounds: { prompt: [tone] } as never,
    setup() {
      setups++;
      return [];
    },
    create: () => {
      creates++;
      return buttonProbe.create();
    },
  };
  assert.throws(
    () => prepareAssignments(descriptor, 'standard', simulatedPlayers, 42),
    /sound declarations/,
  );
  assert.throws(
    () => new RoundRunner(descriptor, new SessionProgress()),
    /sound declarations/,
  );
  assert.equal(creates, 0);
  assert.equal(setups, 0);
});
