import assert from 'node:assert/strict';
import test from 'node:test';
import { room } from '../../../../tests/fixtures/catalog-room.ts';
import { harvestPosition, type NeonHarvestState } from './game.ts';

void test('Neon Harvest awards once across rematches, holds disconnected outcomes and aborts without awards', (t) => {
  const r = room(t);
  for (let round = 0; round < 2; round++) {
    const opening = r.begin('neon-harvest');
    r.at(opening.startAt + 40);
    r.at(opening.startAt + 500);
    const node = (
      r.host.frames.at(-1)!.state.state as NeonHarvestState
    ).nodes.find((n) => n.kind !== 'mine')!;
    const point = harvestPosition(node, r.time());
    r.fire('a', point.x, point.y);
    r.fire('a', point.x, point.y);
    r.at(r.time() + 220);
    const collected = (r.host.frames.at(-1)!.state.state as NeonHarvestState)
      .players.a.collected;
    assert.ok(collected > 0);
    const score = (r.host.frames.at(-1)!.state.state as NeonHarvestState).scores
      .a;
    r.players[0].connected = false;
    r.authority.setRoster(r.roster);
    r.at(opening.endAt + 200);
    r.at(opening.endAt + 400);
    assert.equal(r.host.frames.at(-1)!.state.progress.totals.a, round + 1);
    assert.equal(
      r.host.frames.at(-1)!.state.outcomes.find((o) => o.playerId === 'a')!
        .score,
      score,
    );
    r.players[0].connected = true;
    r.authority.setRoster(r.roster);
  }
  const closed = r.authority.summary().progress;
  const opening = r.begin('neon-harvest');
  r.at(opening.endAt + 100);
  r.authority.abort();
  r.at(opening.endAt + 400);
  assert.equal(r.host.frames.at(-1)!.state.phase, 'aborted');
  assert.deepEqual(r.authority.summary().progress.totals, closed.totals);
  assert.equal(r.authority.summary().progress.rounds.at(-1)!.status, 'aborted');
  assert.equal(
    new Set(
      r.authority.summary().progress.rounds.map((record) => record.roundId),
    ).size,
    3,
  );
});

void test('Neon Harvest permits a solo live round with outcomes and no opponent award', (t) => {
  const r = room(t);
  r.players.splice(1);
  r.authority.setRoster(r.roster);
  const opening = r.begin('neon-harvest');
  r.at(opening.startAt + 40);
  r.at(opening.endAt + 200);
  r.at(opening.endAt + 400);
  const result = r.host.frames.at(-1)!.state;
  assert.equal(result.phase, 'results');
  assert.equal(result.outcomes.length, 1);
  assert.equal(result.outcomes[0].playerId, 'a');
  assert.deepEqual(result.progress.awards, { a: 0 });
  assert.equal(result.progress.totals.a, 0);
});
