import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import type { GameDescriptor, Player } from '../src/client/api/index.ts';
import { games } from '../src/client/minigames/catalog.ts';
import {
  GameHarness,
  snapshotPolicy,
} from '../src/client/devtools/game-harness/harness.ts';
import { capabilityProfile } from '../src/client/devtools/game-harness/input.ts';
import { kindOf, usesPressSlot } from '../src/client/controls/registry.ts';
import { MAX_ROUND_SNAPSHOT_BYTES } from '../src/client/engine/snapshots.ts';

/** Shared contract checks contain no game IDs, state fields, score rules or statistics. */
async function exercise(
  descriptor: GameDescriptor,
  mode: string,
  count: number,
) {
  const players: Player[] = Array.from({ length: count }, (_, seat) => ({
    id: `player-${seat}`.padEnd(160, 'x'),
    venueId: seat % 2 ? 'remote' : 'host',
    seat,
    name: `選手🕹️ ${seat}`,
    color: '#ffffff',
    connected: true,
  }));
  const harness = new GameHarness(descriptor, {
    players,
    mode,
    seed: 0x51a7,
    sessionId: 'catalog-conformance',
    capabilities: Object.fromEntries(
      players.map((p, i) => [p.id, capabilityProfile(i % 2 === 0)]),
    ),
  });
  let maxStateBytes = 0,
    maxEnvelopeBytes = 0,
    inspected = 0;
  const digest = createHash('sha256'),
    policy = snapshotPolicy(descriptor);
  try {
    await harness.load();
    assert.equal(harness.phase, 'countdown');
    const assignments = harness.authoritativeSnapshot()!.assignments;
    assert.equal(assignments.length, count);
    const buckets = new Map<string, number>();
    const observe = () => {
      const current = harness.authoritativeSnapshot()!;
      assert.ok(current, 'loaded game supplies authority state');
      assert.equal(harness.error, null);
      const stateBytes = Buffer.byteLength(JSON.stringify(current.state));
      const envelopeBytes = Buffer.byteLength(JSON.stringify(current));
      maxStateBytes = Math.max(maxStateBytes, stateBytes);
      maxEnvelopeBytes = Math.max(maxEnvelopeBytes, envelopeBytes);
      assert.ok(stateBytes <= 40 * 1024);
      assert.ok(envelopeBytes <= MAX_ROUND_SNAPSHOT_BYTES);
      if (harness.time % 1000 === 0 || current.phase === 'results') {
        assert.ok(policy.valid(current));
        digest.update(JSON.stringify(current));
        inspected++;
      }
    };
    const drive = () => {
      if (harness.time === harness.startAt + 1200)
        harness.disconnect(players[0].id);
      if (harness.time === harness.startAt + 1600)
        harness.reconnect(players[0].id);
      for (const p of harness.players) {
        for (const widget of harness.configs[p.id].widgets) {
          if (kindOf(widget.type) === 'vector') {
            const x = Math.sin(harness.time / 900 + p.seat) * 0.3;
            const y = Math.cos(harness.time / 1100 + p.seat) * 0.3;
            harness.setValue(
              p.id,
              widget.action,
              widget.space === 'normalized'
                ? { x: 0.5 + x, y: 0.5 + y }
                : { x, y },
            );
          }
          const elapsed = harness.time - harness.startAt - p.seat * 40;
          const bucket = Math.floor(elapsed / 800),
            key = `${p.id}:${widget.action}`;
          if (
            usesPressSlot(widget.type) &&
            elapsed >= 0 &&
            bucket > (buckets.get(key) ?? -1)
          ) {
            harness.press(p.id, widget.action);
            buckets.set(key, bucket);
          }
        }
      }
      observe();
    };
    harness.finish(drive);
    observe();
    assert.equal(harness.phase, 'results');
    const result = harness.authoritativeSnapshot()!;
    assert.deepEqual(result.assignments, assignments);
    assert.equal(result.outcomes.length, count);
    assert.deepEqual(
      new Set(result.outcomes.map((o) => o.playerId)),
      new Set(players.map((p) => p.id)),
    );
    const progress = harness.progressView();
    assert.equal(progress.rounds.length, 1);
    assert.equal(progress.rounds[0].status, 'completed');
    assert.equal(progress.rounds[0].mode, mode);
    harness.advance(1000);
    assert.deepEqual(
      harness.progressView(),
      progress,
      'completion awards exactly once',
    );
    assert.deepEqual(harness.display('host'), harness.display('remote'));
    const detached = harness.authoritativeSnapshot()!;
    detached.players[0].name = 'changed';
    assert.equal(
      harness.authoritativeSnapshot()!.players[0].name,
      players[0].name,
    );
    assert.ok(inspected > 2);
    return {
      digest: digest.digest('hex'),
      progress,
      maxStateBytes,
      maxEnvelopeBytes,
    };
  } finally {
    harness.dispose();
  }
}

for (const descriptor of games)
  for (const mode of descriptor.modes)
    for (
      let count = descriptor.players.min;
      count <= descriptor.players.max;
      count++
    )
      void test(`catalog conformance: ${descriptor.id}/${mode.id}, ${count} players`, async (t) => {
        const first = await exercise(descriptor, mode.id, count);
        assert.deepEqual(
          await exercise(descriptor, mode.id, count),
          first,
          'identical fixtures reproduce authority, events and outcomes',
        );
        if (count === 8)
          t.diagnostic(
            `Representative peak: state ${first.maxStateBytes} bytes; envelope ${first.maxEnvelopeBytes} bytes.`,
          );
      });
