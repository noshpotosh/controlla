import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Player } from '../src/client/api/index.ts';
import { RoundRunner } from '../src/client/engine/round.ts';
import { SessionProgress } from '../src/client/engine/progress.ts';
import {
  MAX_ROUND_SNAPSHOT_BYTES,
  snapshotPolicy,
} from '../src/client/engine/snapshots.ts';
import { neonHarvest } from '../src/client/minigames/neon-harvest/index.ts';
import { HARVEST } from '../src/client/minigames/neon-harvest/model.ts';

void test('Neon Harvest completes an eight-player round with maximum-length IDs inside the full snapshot budget', (t) => {
  const players: Player[] = Array.from({ length: 8 }, (_, seat) => ({
    id: `p${seat}`.padEnd(160, 'x'),
    name: `Player ${seat}`,
    venueId: 'test-venue',
    seat,
    color: '#ffffff',
    connected: true,
  }));
  const progress = new SessionProgress();
  const runner = new RoundRunner(neonHarvest, progress);
  assert.equal(runner.load(), undefined);
  runner.begin(players, 0);
  const policy = snapshotPolicy(neonHarvest);
  let maxBytes = 0,
    maxNodes = 0,
    maxEffects = 0,
    hits = 0;
  for (let time = runner.startAt; time <= runner.endAt + 200; time += 50) {
    const cursors = Object.fromEntries(
      players.map((player) => [
        player.id,
        {
          x: 0.5 + Math.sin(time / 800 + player.seat) * 0.35,
          y: 0.45 + Math.cos(time / 900 + player.seat) * 0.22,
        },
      ]),
    );
    const values = Object.fromEntries(
      players.map((player) => [
        player.id,
        {
          aim: {
            value: cursors[player.id],
            time: runner.startAt,
            observedAt: time,
          },
        },
      ]),
    );
    if (time % 1000 === 0 && time < runner.endAt)
      for (const player of players) {
        assert.equal(
          runner.input(
            {
              playerId: player.id,
              name: 'pulse',
              time,
              aim: { x: 0.5, y: 0.5 },
            },
            time,
          ),
          true,
        );
      }
    const emitted = runner.tick(time, 50, values, 180);
    const hitEvents = emitted.filter((event) => event.kind === 'hit');
    hits += hitEvents.length;
    assert.ok(hitEvents.length <= 8);
    assert.ok(hitEvents.every((event) => !Object.hasOwn(event, 'playerId')));
    const snapshot = runner.snapshot(cursors)!;
    assert.equal(runner.error, null, `time=${time}: ${runner.error}`);
    assert.ok(policy.valid(snapshot), `invalid snapshot at ${time}`);
    assert.ok(snapshot.state);
    maxBytes = Math.max(maxBytes, Buffer.byteLength(JSON.stringify(snapshot)));
    maxNodes = Math.max(maxNodes, snapshot.state.nodes.length);
    maxEffects = Math.max(maxEffects, snapshot.state.effects.length);
  }
  assert.equal(runner.phase, 'results');
  assert.equal(runner.snapshot()!.outcomes.length, 8);
  assert.equal(progress.view().rounds.length, 1);
  assert.equal(progress.view().rounds[0].status, 'completed');
  assert.ok(
    hits > 128,
    'the exercise fills and rotates the retained audio history',
  );
  assert.ok(maxBytes <= MAX_ROUND_SNAPSHOT_BYTES);
  assert.ok(maxNodes <= HARVEST.maxNodes);
  assert.ok(maxEffects <= HARVEST.maxEffects);
  t.diagnostic(
    `Peak envelope ${maxBytes} bytes; ${maxNodes} nodes; ${maxEffects} effects; ${hits} hit events.`,
  );
  runner.dispose();
});
