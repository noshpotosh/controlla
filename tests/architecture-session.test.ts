import test from 'node:test';
import assert from 'node:assert/strict';
import type { Outcome } from '../src/client/api/index.ts';
import { SessionProgress } from '../src/experiments/architecture/session.ts';

const pair = (): Outcome[] => [
  { playerId: 'a', placement: 1, score: 5 },
  { playerId: 'b', placement: 2, score: 1 },
];

void test('session points count opponents placed below each player, including ties and gaps', () => {
  const progress = new SessionProgress();
  const round = progress.open('collection-fixture', ['a', 'b', 'c', 'd']);
  assert.equal(
    round.complete([
      { playerId: 'a', placement: 1, score: -100 },
      { playerId: 'b', placement: 1, score: 0 },
      { playerId: 'c', placement: 4, score: 1000 },
      { playerId: 'd', placement: 4, score: 999 },
    ]),
    'accepted',
  );
  assert.deepEqual(progress.view().totals, { a: 2, b: 2, c: 0, d: 0 });
  assert.deepEqual(progress.view().rounds[0].awards, {
    a: 2,
    b: 2,
    c: 0,
    d: 0,
  });
});

void test('a completion is accepted once and order-independent exact retries are idempotent', () => {
  const progress = new SessionProgress();
  const round = progress.open('race-fixture', ['a', 'b']);
  assert.equal(round.complete(pair()), 'accepted');
  assert.equal(round.complete(pair().reverse()), 'duplicate');
  const changedScore = pair();
  changedScore[0].score++;
  assert.equal(round.complete(changedScore), 'closed');
  assert.equal(
    round.complete(pair().map((o) => ({ ...o, placement: 1 }))),
    'closed',
  );
  assert.equal(round.complete([]), 'closed');
  assert.equal(round.abort(), false);
  assert.deepEqual(progress.view().totals, { a: 1, b: 0 });
  assert.equal(progress.view().rounds.length, 1);
});

void test('an aborted round closes immediately and never awards late outcomes', () => {
  const progress = new SessionProgress();
  const round = progress.open('race-fixture', ['a', 'b']);
  assert.equal(round.abort(), true);
  assert.equal(round.abort(), false);
  assert.equal(round.complete(pair()), 'closed');
  assert.deepEqual(progress.view(), {
    revision: 2,
    totals: { a: 0, b: 0 },
    rounds: [
      {
        roundId: round.roundId,
        gameId: 'race-fixture',
        mode: '',
        players: [
          {
            id: 'a',
            venueId: '',
            seat: 0,
            name: 'a',
            color: '#ffffff',
            connected: true,
          },
          {
            id: 'b',
            venueId: '',
            seat: 1,
            name: 'b',
            color: '#ffffff',
            connected: true,
          },
        ],
        status: 'aborted',
        outcomes: [],
        awards: {},
      },
    ],
  });
});

void test('unique round capabilities accumulate points across games and repeated games', () => {
  const progress = new SessionProgress();
  const rounds = ['race-fixture', 'collection-fixture', 'race-fixture'].map(
    (game) => progress.open(game, ['a', 'b']),
  );
  assert.equal(new Set(rounds.map((round) => round.roundId)).size, 3);
  assert.notEqual(
    new SessionProgress().open('race-fixture', ['a', 'b']).roundId,
    rounds[0].roundId,
  );
  for (const round of rounds) assert.equal(round.complete(pair()), 'accepted');
  assert.deepEqual(progress.view().totals, { a: 3, b: 0 });
  assert.deepEqual(
    progress.view().rounds.map((r) => r.gameId),
    ['race-fixture', 'collection-fixture', 'race-fixture'],
  );
});

void test('round eligibility is copied at start and retains disconnected players', () => {
  const progress = new SessionProgress();
  const roster = ['a', 'b'];
  const round = progress.open('collection-fixture', roster);
  roster.splice(1, 1, 'new-player');
  assert.equal(round.complete([pair()[0]]), 'invalid');
  assert.equal(
    round.complete([
      pair()[0],
      { playerId: 'new-player', placement: 2, score: 0 },
    ]),
    'invalid',
  );
  assert.equal(round.complete(pair()), 'accepted');
  assert.deepEqual(progress.view().totals, { a: 1, b: 0 });
});

void test('invalid outcomes award nothing and leave the round available for valid completion', () => {
  const progress = new SessionProgress();
  const round = progress.open('collection-fixture', ['a', 'b']);
  const invalid: unknown[] = [
    [],
    [pair()[0]],
    [...pair(), { playerId: 'c', placement: 1, score: 0 }],
    [pair()[0], pair()[0]],
    [pair()[0], { playerId: 'unknown', placement: 2, score: 0 }],
    [pair()[0], { playerId: 'b', placement: 0, score: 0 }],
    [pair()[0], { playerId: 'b', placement: 3, score: 0 }],
    [pair()[0], { playerId: 'b', placement: 1.5, score: 0 }],
    [pair()[0], { playerId: 'b', placement: NaN, score: 0 }],
    [pair()[0], { playerId: 'b', placement: 2, score: NaN }],
    [pair()[0], { playerId: 'b', placement: 2, score: Infinity }],
    [pair()[0], { playerId: 'b', placement: 2, score: '1' }],
    [pair()[0], null],
    null,
    {},
  ];
  for (const outcomes of invalid) {
    assert.equal(round.complete(outcomes as Outcome[]), 'invalid');
    assert.deepEqual(progress.view(), {
      revision: 1,
      totals: { a: 0, b: 0 },
      rounds: [],
    });
  }
  assert.equal(round.complete(pair()), 'accepted');
});

void test('accepted outcomes and every progress read are detached from the authoritative state', () => {
  const progress = new SessionProgress();
  const round = progress.open('collection-fixture', ['a', 'b']);
  const outcomes = pair();
  assert.equal(round.complete(outcomes), 'accepted');
  outcomes[0].score = 1000;
  outcomes[1].placement = 1;
  const read = progress.view();
  read.totals.a = 1000;
  read.rounds[0].outcomes[0].playerId = 'intruder';
  read.rounds[0].awards.a = 1000;
  read.rounds[0].status = 'aborted';
  read.rounds.length = 0;
  assert.deepEqual(progress.view().totals, { a: 1, b: 0 });
  assert.deepEqual(progress.view().rounds[0].outcomes, pair());
  assert.deepEqual(progress.view().rounds[0].awards, { a: 1, b: 0 });
  assert.equal(progress.view().rounds[0].status, 'completed');
  assert.equal(round.complete(pair()), 'duplicate');
});

void test('history is capped at 50 records while totals and old retry decisions survive', () => {
  const progress = new SessionProgress();
  const first = progress.open('race-fixture', ['a', 'b']);
  assert.equal(first.complete(pair()), 'accepted');
  for (let i = 0; i < 54; i++) {
    assert.equal(
      progress.open('collection-fixture', ['a', 'b']).complete(pair()),
      'accepted',
    );
  }
  assert.equal(progress.view().rounds.length, 50);
  assert.ok(
    progress.view().rounds.every((round) => round.roundId !== first.roundId),
  );
  assert.deepEqual(progress.view().totals, { a: 55, b: 0 });
  assert.equal(first.complete(pair()), 'duplicate');
  assert.deepEqual(progress.view().totals, { a: 55, b: 0 });
  for (let i = 0; i < 51; i++) {
    assert.equal(progress.open('collection-fixture', ['a', 'b']).abort(), true);
  }
  assert.equal(progress.view().rounds.length, 50);
  assert.ok(
    progress.view().rounds.every((round) => round.status === 'aborted'),
  );
  assert.deepEqual(progress.view().totals, { a: 55, b: 0 });
});

void test('unusual player IDs remain data rather than object-prototype properties', () => {
  const progress = new SessionProgress();
  const round = progress.open('collection-fixture', [
    '__proto__',
    'constructor',
  ]);
  assert.equal(
    round.complete([
      { playerId: '__proto__', placement: 1, score: 1 },
      { playerId: 'constructor', placement: 2, score: 0 },
    ]),
    'accepted',
  );
  assert.equal(Object.hasOwn(progress.view().totals, '__proto__'), true);
  assert.equal(progress.view().totals['__proto__'], 1);
  assert.equal(progress.view().totals['constructor'], 0);
});

void test('invalid game IDs and rosters cannot create a round', () => {
  const progress = new SessionProgress();
  assert.throws(() => progress.open('', ['a']));
  assert.throws(() => progress.open('collection-fixture', []));
  assert.throws(() => progress.open('collection-fixture', ['a', 'a']));
  assert.throws(() => progress.open('collection-fixture', ['a', '']));
  assert.deepEqual(progress.view(), { revision: 0, totals: {}, rounds: [] });
});

void test('outcome statistics are bounded, finite, cloned, and part of retry identity', () => {
  const progress = new SessionProgress();
  const round = progress.open('report-fixture', ['a', 'b']);
  for (const stats of [
    { reactionMs: NaN },
    { reactionMs: Infinity },
    { reactionMs: '12' },
    Object.fromEntries(Array.from({ length: 17 }, (_, i) => [`stat${i}`, 1])),
    { ['s'.repeat(65)]: 1 },
    Object.fromEntries(
      Array.from({ length: 16 }, (_, i) => ['界'.repeat(60) + i, 1]),
    ),
  ]) {
    const outcomes = pair();
    outcomes[0].stats = stats as Record<string, number>;
    assert.equal(round.complete(outcomes), 'invalid');
    assert.equal(progress.revision, 1);
  }
  const outcomes = pair();
  outcomes[0].stats = {
    reactionMs: 123.456,
    phaseLagMs: -30,
    reactions: 4,
    rmsAimError: 0.12,
  };
  assert.equal(round.complete(outcomes), 'accepted');
  const retried = pair();
  retried[0].stats = {
    rmsAimError: 0.12,
    reactions: 4,
    phaseLagMs: -30,
    reactionMs: 123.456,
  };
  assert.equal(round.complete(retried.reverse()), 'duplicate');
  outcomes[0].stats.reactions = 99;
  assert.equal(round.complete(outcomes), 'closed');
  const view = progress.view();
  assert.equal(view.rounds[0].outcomes[0].stats?.reactions, 4);
  view.rounds[0].outcomes[0].stats!.reactions = 200;
  assert.equal(progress.view().rounds[0].outcomes[0].stats?.reactions, 4);
});

void test('compact progress bounds visible identities while historical totals and fixed metadata survive', () => {
  const progress = new SessionProgress();
  const players = ['a', 'b'].map((id, seat) => ({
    id,
    seat,
    venueId: 'venue',
    name: id,
    color: '#fff',
    connected: true,
  }));
  const first = progress.open('report-fixture', ['a', 'b'], {
    mode: 'fairness',
    players,
  });
  players[0].name = 'Changed';
  players.splice(1, 1);
  assert.equal(first.complete(pair()), 'accepted');
  assert.equal(progress.view().rounds[0].players[0].name, 'a');
  assert.equal(progress.view().rounds[0].players.length, 2);
  assert.equal(progress.view().rounds[0].mode, 'fairness');
  const compact = progress.compact(['a'], first.roundId);
  assert.deepEqual(compact, {
    revision: 2,
    totals: { a: 1 },
    awards: { a: 1, b: 0 },
  });
  compact.totals.a = 500;
  compact.awards.a = 500;
  for (let i = 0; i < 50; i++)
    progress.open('collection-fixture', ['c', 'd']).abort();
  assert.equal(progress.view().totals.a, 1);
  assert.equal(progress.view().rounds.length, 50);
  assert.deepEqual(progress.compact(['a', 'c']).totals, { a: 1, c: 0 });
  assert.deepEqual(progress.compact(['a'], first.roundId).awards, {});
  assert.equal(first.complete(pair()), 'duplicate');
});
