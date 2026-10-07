import assert from 'node:assert/strict';
import test from 'node:test';
import { games } from '../src/client/minigames/catalog.ts';
import { buttonProbe } from './fixtures/games.ts';
import type { GameDescriptor } from '../src/client/api/index.ts';
import { room } from './fixtures/catalog-room.ts';

void test('live catalog runs every mode through the generic host/remote boundary and retains game statistics', (t) => {
  const r = room(t);
  for (const game of games) {
    for (const mode of game.modes) {
      const opening = r.begin(game.id, mode.id);
      r.at(opening.startAt + 40);
      r.at(opening.endAt);
      assert.equal(r.host.frames.at(-1)!.state.phase, 'settling');
      r.at(opening.endAt + 200);
      r.at(opening.endAt + 400);
      const host = r.host.sample(r.time() - 160)!;
      const remote = r.remote.sample(r.time() - 160)!;
      assert.deepEqual(remote, host);
      assert.equal(host.gameId, game.id);
      assert.equal(host.mode, mode.id);
      assert.equal(host.phase, 'results');
      const awards = Object.fromEntries(
        host.outcomes.map((outcome) => [
          outcome.playerId,
          host.outcomes.filter((other) => other.placement > outcome.placement)
            .length,
        ]),
      );
      assert.deepEqual(host.progress.awards, awards);
      assert.equal(
        'rounds' in host.progress,
        false,
        'snapshots do not carry report history',
      );
      for (const result of r.authority.summary().completed.at(-1)!.results)
        assert.deepEqual(
          result.stats,
          host.outcomes.find((outcome) => outcome.playerId === result.playerId)!
            .stats ?? {},
        );
    }
  }
  assert.equal(
    r.authority.summary().completed.length,
    games.reduce((total, game) => total + game.modes.length, 0),
  );
  assert.deepEqual(r.hydration.view(), r.authority.summary().progress);
  assert.deepEqual(r.warnings, []);
});

void test('unknown choices leave configuration intact; late players cannot enter a running round', (t) => {
  const r = room(t);
  const before = structuredClone(r.configs);
  assert.throws(() => r.authority.start('missing', 'standard'), /Unknown/);
  assert.throws(() => r.authority.start('neon-harvest', 'missing'), /mode/i);
  assert.deepEqual(r.configs, before);
  const opening = r.begin('neon-harvest');
  r.players.push({ ...r.players[0], id: 'late', name: 'Late', seat: 2 });
  r.authority.setRoster(r.roster);
  r.at(opening.startAt + 20);
  r.fire('late', 0.5, 0.5);
  r.at(r.time() + 250);
  assert.deepEqual(
    r.host.frames
      .at(-1)!
      .state.assignments.map((assignment) => assignment.playerId),
    ['a', 'b'],
  );
  r.at(opening.endAt + 200);
  assert.equal(r.authority.summary().progress.totals.late, undefined);
});

void test('presentation telemetry accepts only current registered markers once per venue', (t) => {
  const descriptor: GameDescriptor = {
    ...buttonProbe,
    id: 'marker-probe',
    create() {
      const game = buttonProbe.create();
      let emitted = false;
      return {
        ...game,
        tick(input) {
          const events = [...game.tick(input).events];
          if (!emitted) {
            emitted = true;
            events.push({
              id: 'prompt',
              kind: 'prompt',
              time: input.time,
              clock: 'authority',
              measure: true,
            });
          }
          return { events };
        },
      };
    },
  };
  (games as GameDescriptor[]).push(descriptor);
  t.after(() =>
    (games as GameDescriptor[]).splice(games.indexOf(descriptor), 1),
  );
  const r = room(t);
  const opening = r.begin(descriptor.id);
  r.at(opening.startAt + 1040);
  const prompt = r.events.find((event) => event.measure)!;
  assert.equal(prompt.clock, 'authority');
  r.at(prompt.time + 100);
  r.authority.control('host', {
    type: 'presented',
    roundId: opening.roundId,
    eventId: 'unknown',
    at: r.time(),
  });
  r.authority.control('host', {
    type: 'presented',
    roundId: opening.roundId,
    eventId: prompt.id,
    at: prompt.time + 5,
  });
  r.authority.control('remote', {
    type: 'presented',
    roundId: opening.roundId,
    eventId: prompt.id,
    at: prompt.time + 15,
  });
  r.authority.control('host', {
    type: 'presented',
    roundId: opening.roundId,
    eventId: prompt.id,
    at: prompt.time + 80,
  });
  // The public report carries measured spread, without any dependency on game fields.
  assert.equal(r.authority.summary().presentationSpreadMs, 10);
});
