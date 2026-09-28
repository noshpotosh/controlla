import test from 'node:test';
import assert from 'node:assert/strict';
import type { Outcome, Player, Progress } from '../src/client/api/index.ts';
import {
  SessionProgress,
  completedResults,
} from '../src/client/engine/progress.ts';
import {
  historyMessages,
  MAX_MESSAGE_BYTES,
  messageFits,
  ProgressAssembler,
} from '../src/client/engine/history.ts';

const players: Player[] = Array.from({ length: 8 }, (_, seat) => ({
  id: String(seat).padStart(24, '0'),
  venueId: 'v'.repeat(24),
  seat,
  name: `選手🕹️${seat} 名字`,
  color: '#b6ff65',
  connected: true,
}));
function result(): Outcome[] {
  return players.map((p, i) => ({
    playerId: p.id,
    placement: Math.floor(i / 2) * 2 + 1,
    score: 4321,
    stats: {
      reactionMs: 123.45678901234,
      reactions: 8,
      phaseLagMs: -30,
      rmsAimError: 0.12345678901234,
      ['測定🕹️'.repeat(5)]: 0.25,
    },
  }));
}
function ledger(rounds = 50) {
  const progress = new SessionProgress();
  for (let i = 0; i < rounds; i++) {
    const round = progress.open(
      'report-fixture',
      players.map((p) => p.id),
      { mode: 'reaction', players },
    );
    assert.equal(round.complete(result()), 'accepted');
  }
  return progress;
}
function receiveAll(assembler: ProgressAssembler, progress: Progress) {
  let completed: Progress | null = null;
  for (const message of historyMessages(progress))
    completed = assembler.receive(message) ?? completed;
  return completed;
}

void test('50 eight-player Unicode reports hydrate atomically through byte-bounded relay messages', () => {
  const progress = ledger().view();
  assert.ok(
    new TextEncoder().encode(JSON.stringify(progress)).byteLength > 65536,
  );
  const messages = historyMessages(progress);
  assert.ok(messages.length > 1);
  const assembler = new ProgressAssembler();
  for (const message of messages) {
    const relayed = {
      type: 'relay',
      from: 'f'.repeat(64),
      to: 't'.repeat(64),
      channel: 'ctrl',
      binary: false,
      data: { type: 'toController', target: 'p'.repeat(64), message },
    };
    assert.ok(
      new TextEncoder().encode(JSON.stringify(relayed)).byteLength <=
        MAX_MESSAGE_BYTES,
    );
    assert.ok(messageFits(relayed.data, relayed.from, relayed.to));
  }
  let received: Progress | null = null;
  for (const [i, message] of [...messages].reverse().entries()) {
    const next = assembler.receive(message);
    assert.equal(next !== null, i === messages.length - 1);
    if (next) received = next;
    assert.equal(assembler.receive(message), null);
    if (i < messages.length - 1) assert.equal(assembler.view(), null);
  }
  assert.deepEqual(received, progress);
  received!.totals[players[0].id] = 999;
  assert.deepEqual(assembler.view(), progress);
});

void test('incomplete reconnect and stale batches retain the last complete ledger', () => {
  const progress = ledger(1);
  const assembler = new ProgressAssembler();
  const first = progress.view();
  assert.deepEqual(receiveAll(assembler, first), first);
  for (let i = 0; i < 49; i++)
    progress
      .open(
        'report-fixture',
        players.map((p) => p.id),
        { mode: 'tracking', players },
      )
      .complete(result());
  const latest = progress.view();
  const messages = historyMessages(latest);
  assembler.receive(messages[1]);
  assert.deepEqual(assembler.view(), first);
  for (const message of historyMessages(first))
    assert.equal(assembler.receive(message), null);
  assert.deepEqual(assembler.view(), first);
  assert.deepEqual(receiveAll(assembler, latest), latest);
  assert.deepEqual(receiveAll(new ProgressAssembler(), latest), latest);
});

void test('malformed batches, inconsistent fragments, invalid outcomes, and oversized counts cannot replace reports', () => {
  const assembler = new ProgressAssembler();
  const initial = ledger(1).view();
  receiveAll(assembler, initial);
  const valid = historyMessages(ledger(50).view());
  for (const malformed of [
    null,
    {},
    [],
    { ...valid[0], count: 1e9 },
    { ...valid[0], index: -1 },
    { ...valid[0], revision: Infinity },
    { ...valid[0], payload: 'x'.repeat(9000) },
    { ...valid[0], payload: '{}' },
    { ...valid[0], count: 1, index: 0, payload: '{' },
  ])
    assert.equal(assembler.receive(malformed), null);
  assembler.receive(valid[0]);
  assert.equal(assembler.receive({ ...valid[0], payload: 'conflict' }), null);
  assert.deepEqual(assembler.view(), initial);
  const invalid = structuredClone(initial);
  invalid.revision++;
  invalid.rounds[0].outcomes[0].stats = { bad: Infinity };
  assert.throws(() => historyMessages(invalid));
  const payload = JSON.stringify(invalid);
  assert.equal(
    assembler.receive({
      type: 'progressBatch',
      revision: invalid.revision,
      count: 1,
      index: 0,
      payload,
    }),
    null,
  );
  assert.deepEqual(assembler.view(), initial);
  assert.ok(messageFits({ type: 'x' }));
  assert.equal(messageFits({ type: 'x', text: '界'.repeat(20000) }), false);
});

void test('history eviction preserves totals and legacy exports preserve stats and placement awards', () => {
  const progress = ledger(55).view();
  assert.equal(progress.rounds.length, 50);
  assert.equal(progress.totals[players[0].id], 55 * 6);
  const report = completedResults(progress);
  assert.equal(report.length, 50);
  assert.equal(report[0].mode, 'reaction');
  assert.deepEqual(report[0].results[0], {
    playerId: players[0].id,
    rank: 1,
    score: 4321,
    stats: result()[0].stats,
  });
  assert.equal(report[0].awards[players[0].id], 6);
  report[0].results[0].stats.reactions = 500;
  report[0].players[0].name = 'Mutated';
  assert.equal(progress.rounds[0].outcomes[0].stats?.reactions, 8);
  assert.equal(progress.rounds[0].players[0].name, players[0].name);
  assert.deepEqual(receiveAll(new ProgressAssembler(), progress), progress);
});

void test('an empty revision zero ledger hydrates once and prototype-shaped IDs stay data', () => {
  const progress = new SessionProgress();
  const assembler = new ProgressAssembler();
  assert.deepEqual(receiveAll(assembler, progress.view()), progress.view());
  progress.open('collection-fixture', ['__proto__', 'constructor']).complete([
    {
      playerId: '__proto__',
      placement: 1,
      score: 1,
      stats: JSON.parse('{"__proto__":2}'),
    },
    { playerId: 'constructor', placement: 2, score: 0 },
  ]);
  assert.deepEqual(receiveAll(assembler, progress.view()), progress.view());
});
