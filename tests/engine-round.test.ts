import assert from 'node:assert/strict';
import { test } from 'node:test';
import type {
  GameDescriptor,
  GameInput,
  GameContext,
  PresentationEvent,
} from '../src/client/api/index.ts';
import { RoundRunner } from '../src/client/engine/round.ts';
import { SessionProgress } from '../src/client/engine/progress.ts';
import {
  catalogSnapshotPolicy,
  MAX_ROUND_SNAPSHOT_BYTES,
  snapshotPolicy,
} from '../src/client/engine/snapshots.ts';
import {
  games,
  findGame,
  resolveMode,
} from '../src/client/minigames/catalog.ts';
import { buttonProbe } from './fixtures/games.ts';
import { neonHarvest } from '../src/client/minigames/neon-harvest/index.ts';
import { simulatedPlayers } from '../src/client/devtools/game-harness/harness.ts';

const players = structuredClone(simulatedPlayers.slice(0, 2));
function fixture(
  overrides: Partial<ReturnType<GameDescriptor['create']>> = {},
) {
  let disposed = 0;
  const contexts: GameContext[] = [];
  const ticks: GameInput[] = [];
  const descriptor: GameDescriptor<{ count: number }> = {
    ...buttonProbe,
    id: 'fixture',
    interpolate: undefined,
    durationMs: 1000,
    isState: (value): value is { count: number } =>
      !!value &&
      typeof value === 'object' &&
      'count' in value &&
      typeof value.count === 'number',
    createRenderer: () => ({ render() {}, dispose() {} }),
    create: () =>
      ({
        load() {},
        ready: () => true,
        start(context) {
          contexts.push(context);
        },
        tick(input) {
          ticks.push(input);
          return [];
        },
        snapshot: () => ({ count: 0 }),
        finalize: () =>
          players.map((player) => ({
            playerId: player.id,
            score: 0,
            placement: 1,
          })),
        disconnect() {},
        reconnect() {},
        dispose() {
          disposed++;
        },
        ...overrides,
      }) as ReturnType<GameDescriptor<{ count: number }>['create']>,
  };
  return { descriptor, contexts, ticks, disposed: () => disposed };
}

void test('production runner loads synchronous games immediately and owns immutable round metadata', () => {
  const f = fixture();
  const progress = new SessionProgress();
  const runner = new RoundRunner(f.descriptor, progress);
  assert.equal(runner.load(), undefined);
  assert.equal(runner.loaded, true);
  assert.equal(runner.roundId, null);
  assert.equal(progress.view().rounds.length, 0);
  runner.begin(players, 100);
  assert.equal(runner.startAt, 3100);
  assert.equal(runner.endAt, 4100);
  assert.equal(f.contexts[0].mode, 'standard');
  assert.ok(Object.isFrozen(f.contexts[0].players[0]));
  const snapshot = runner.snapshot({
    outsider: { x: 0, y: 0 },
    ada: { x: 0.2, y: 0.4 },
  })!;
  assert.deepEqual(Object.keys(snapshot.cursors), ['ada']);
  assert.ok(snapshotPolicy(f.descriptor).valid(snapshot));
  runner.abort();
  runner.dispose();
  assert.equal(f.disposed(), 1);
});

void test('load cancellation, load failure, and start failure release each game once', async () => {
  let release!: () => void;
  const waiting = fixture({
    load: () =>
      new Promise<void>((resolve) => {
        release = resolve;
      }),
  });
  const runner = new RoundRunner(waiting.descriptor, new SessionProgress());
  const pending = runner.load();
  assert.equal(runner.load(), pending);
  runner.abort();
  assert.equal(waiting.disposed(), 1);
  release();
  await pending;
  assert.equal(runner.loaded, false);
  runner.dispose();
  assert.equal(waiting.disposed(), 1);
  for (const stage of ['load', 'start'] as const) {
    const f = fixture({
      [stage]: () => {
        throw new Error(`${stage} failed`);
      },
    });
    const progress = new SessionProgress();
    const r = new RoundRunner(f.descriptor, progress);
    void r.load();
    if (stage === 'start') r.begin(players, 0);
    assert.equal(r.phase, 'error');
    assert.equal(f.disposed(), 1);
    if (stage === 'start') {
      assert.equal(r.snapshot()!.state, null);
      assert.ok(snapshotPolicy(f.descriptor).valid(r.snapshot()));
      assert.equal(progress.view().rounds[0].status, 'aborted');
    } else assert.equal(r.snapshot(), null);
    r.dispose();
    assert.equal(f.disposed(), 1);
  }
});

void test('non-JSON and oversized final states, invalid stats and terminal events never commit awards', () => {
  for (const fault of ['date', 'oversized', 'stats', 'event'] as const) {
    let final = false;
    const f = fixture({
      tick(input) {
        return fault === 'event' && input.phase === 'settling'
          ? [
              {
                id: 'invalid',
                time: input.time,
                kind: 'hit',
                clock: 'invalid',
              } as unknown as PresentationEvent,
            ]
          : [];
      },
      finalize() {
        final = true;
        return players.map((player, i) => ({
          playerId: player.id,
          score: i,
          placement: i + 1,
          ...(fault === 'stats' ? { stats: { invalid: Number.NaN } } : {}),
        }));
      },
      snapshot() {
        return final
          ? {
              count: 0,
              ...(fault === 'date' ? { value: new Date() } : {}),
              ...(fault === 'oversized'
                ? { value: 'x'.repeat(41 * 1024) }
                : {}),
            }
          : { count: 0 };
      },
    });
    const progress = new SessionProgress();
    const runner = new RoundRunner(f.descriptor, progress);
    void runner.load();
    runner.begin(players, 0);
    runner.tick(4200, 50, {}, 0);
    assert.equal(runner.phase, 'error', fault);
    assert.equal(runner.snapshot()!.state, null);
    assert.equal(progress.view().rounds[0].status, 'aborted');
    assert.deepEqual(progress.view().totals, { ada: 0, bea: 0 });
    assert.equal(f.disposed(), 1);
  }
});

void test('a final batch validates all events and emits one framework end cue', () => {
  const f = fixture();
  const progress = new SessionProgress();
  const runner = new RoundRunner(f.descriptor, progress);
  void runner.load();
  runner.begin(players, 0);
  assert.equal(
    runner.input(
      { playerId: 'ada', name: 'fire', time: 3999, aim: { x: 0.5, y: 0.5 } },
      4199,
    ),
    true,
  );
  assert.equal(
    runner.input(
      { playerId: 'bea', name: 'fire', time: 3998, aim: { x: 0.5, y: 0.5 } },
      4200,
    ),
    false,
  );
  const events = runner.tick(4250, 50, {}, 0);
  assert.deepEqual(
    events.map((e) => e.kind),
    ['end'],
  );
  assert.equal(f.ticks.at(-1)!.phase, 'settling');
  assert.equal(f.ticks.at(-1)!.actions.length, 1);
  assert.equal(runner.tick(4300, 50, {}, 0).length, 0);
  assert.equal(progress.view().rounds.length, 1);
  assert.equal(f.disposed(), 1);
});

void test('all shipped descriptors are catalog entries with validated modes', () => {
  assert.deepEqual(
    games.map((g) => g.id),
    ['neon-harvest', 'whack-a-mole', 'double-dash'],
  );
  assert.equal(findGame('missing'), undefined);
  for (const game of games) {
    assert.equal(resolveMode(game), game.defaultMode);
    assert.throws(() => resolveMode(game, 'missing'), /Unknown mode/);
  }
  assert.equal(games[0].defaultMode, 'standard');
});

void test('catalog snapshots acknowledge unsupported games/modes while rejecting corrupt envelopes', () => {
  const runner = new RoundRunner(neonHarvest, new SessionProgress());
  void runner.load();
  runner.begin(players, 0);
  const snapshot = runner.snapshot()!;
  const policy = catalogSnapshotPolicy(games);
  const unknown = { ...snapshot, gameId: 'future-game' };
  assert.ok(policy.valid(unknown));
  const unknownMode = { ...snapshot, mode: 'future-mode' };
  assert.ok(policy.valid(unknownMode));
  assert.deepEqual(
    policy.interpolate(
      unknown,
      { ...unknown, state: { arbitrary: true } },
      0.5,
    ),
    unknown,
  );
  assert.equal(policy.valid({ ...snapshot, schemaVersion: 2 }), false);
  assert.equal(policy.valid({ ...snapshot, state: null }), false);
  assert.equal(
    policy.valid({ ...snapshot, state: { bad: new Date() } }),
    false,
  );
  assert.equal(
    policy.valid({ ...snapshot, state: { bad: 'x'.repeat(41 * 1024) } }),
    false,
  );
  assert.equal(
    policy.valid({
      ...snapshot,
      events: [
        { id: 'event', kind: 'hit', time: Number.NaN, clock: 'presentation' },
      ],
    }),
    false,
  );
  runner.dispose();
});

void test('a delayed terminal tick still integrates the remaining pre-cutoff slice once', () => {
  const f = fixture();
  const runner = new RoundRunner(f.descriptor, new SessionProgress());
  void runner.load();
  runner.begin(players, 0);
  runner.tick(
    3990,
    20,
    { ada: { aim: { time: 3990, value: { x: 0.5, y: 0.5 } } } },
    0,
  );
  runner.tick(
    4250,
    50,
    { ada: { aim: { time: 4250, value: { x: 999, y: 999 } } } },
    0,
  );
  const closing = f.ticks.filter((tick) => tick.phase === 'running').at(-1)!;
  assert.equal(closing.time, 4000);
  assert.equal(closing.dt, 10);
  assert.deepEqual(closing.values.ada.aim.value, { x: 0.5, y: 0.5 });
  assert.equal(f.ticks.at(-1)!.phase, 'settling');
  assert.equal(f.ticks.at(-1)!.dt, 0);
});

void test('throwing or invalid game interpolation holds the prior valid display state', () => {
  for (const interpolate of [
    () => {
      throw new Error('bad interpolation');
    },
    () => ({
      scores: {},
      cursors: {},
      actions: [],
      flag: false,
      elapsed: Number.NaN,
    }),
  ]) {
    const descriptor = { ...buttonProbe, interpolate };
    const runner = new RoundRunner(descriptor, new SessionProgress());
    void runner.load();
    runner.begin(players, 0);
    const before = runner.snapshot()!,
      after = structuredClone(before);
    after.state!.flag = true;
    assert.deepEqual(
      snapshotPolicy(descriptor).interpolate(before, after, 0.5),
      before,
    );
    runner.dispose();
  }
});

void test('finalization reserves cursor bytes before awarding and keeps completed snapshots stable', () => {
  const eligible = Array.from({ length: 8 }, (_, i) => ({
    id: `p${i}-"🎯`,
    name: `Player ${i}`,
    venueId: 'host',
    seat: i,
    color: '#ffffff',
    connected: true,
  }));
  const outcomes = eligible.map((player, index) => ({
    playerId: player.id,
    placement: index + 1,
    score: 8 - index,
  }));
  const events: PresentationEvent[] = Array.from(
    { length: 20 },
    (_, index) => ({
      id: `event-${index}-` + 'a'.repeat(145),
      kind: 'k'.repeat(150),
      time: 4200,
      clock: 'presentation',
    }),
  );
  const awards = Object.fromEntries(
    outcomes.map((outcome) => [outcome.playerId, 8 - outcome.placement]),
  );
  const bytes = (value: unknown) =>
    new TextEncoder().encode(JSON.stringify(value)).byteLength;
  for (const spare of [128, 2400]) {
    let padding = '',
      finalized = false;
    const descriptor: GameDescriptor<{ padding: string }> = {
      ...buttonProbe,
      id: 'cursor-budget',
      durationMs: 1000,
      interpolate: undefined,
      isState: (value): value is { padding: string } =>
        !!value &&
        typeof value === 'object' &&
        'padding' in value &&
        typeof value.padding === 'string',
      createRenderer: () => ({ render() {}, dispose() {} }),
      create: () => ({
        load() {},
        ready: () => true,
        start() {},
        tick(input) {
          return input.phase === 'settling' ? events : [];
        },
        finalize() {
          finalized = true;
          return outcomes;
        },
        snapshot: () => ({ padding: finalized ? padding : '' }),
        disconnect() {},
        reconnect() {},
        dispose() {},
      }),
    };
    const progress = new SessionProgress();
    const runner = new RoundRunner(descriptor, progress);
    void runner.load();
    runner.begin(eligible, 0);
    const candidate = {
      ...runner.snapshot()!,
      phase: 'results',
      outcomes,
      events: [
        ...events,
        {
          id: `${runner.roundId}:end`,
          kind: 'end',
          clock: 'presentation',
          time: 4200,
        },
      ],
      progress: { revision: progress.revision + 1, totals: awards, awards },
    };
    padding = 'x'.repeat(MAX_ROUND_SNAPSHOT_BYTES - spare - bytes(candidate));
    assert.ok(bytes({ padding }) <= 40 * 1024);
    runner.tick(4200, 50, {}, 0);
    if (spare === 128) {
      assert.equal(
        runner.phase,
        'error',
        'cursorless fit alone cannot authorize an award',
      );
      assert.equal(progress.view().rounds[0].status, 'aborted');
      assert.ok(
        Object.values(progress.view().totals).every((total) => total === 0),
      );
    } else {
      assert.equal(runner.phase, 'results');
      const completed = progress.view();
      for (const point of [
        { x: 0.12345678901234568, y: 0.9876543210987654 },
        { x: -Number.MAX_VALUE, y: Number.MIN_VALUE },
        { x: -0.0000012345678901234567, y: 1.2345678901234567e200 },
      ]) {
        const cursors = Object.fromEntries(
          eligible.map((player) => [player.id, point]),
        );
        const snapshot = runner.snapshot(cursors)!;
        assert.equal(snapshot.phase, 'results');
        assert.equal(runner.phase, 'results');
        assert.deepEqual(
          snapshot.cursors,
          cursors,
          'valid offscreen coordinates stay unchanged',
        );
        assert.ok(snapshotPolicy(descriptor).valid(snapshot));
        assert.deepEqual(progress.view(), completed);
        snapshot.progress.totals[eligible[0].id] = 999;
        assert.deepEqual(runner.snapshot()!.progress.totals, awards);
      }
    }
    runner.dispose();
  }
});

void test('wire envelopes enforce bounded result statistics, integer progress and valid seats', () => {
  const runner = new RoundRunner(neonHarvest, new SessionProgress());
  void runner.load();
  runner.begin(players, 0);
  runner.tick(runner.endAt + 200, 50, {}, 0);
  const snapshot = runner.snapshot()!;
  const policy = catalogSnapshotPolicy(games);
  assert.ok(policy.valid(snapshot));
  for (const stats of [
    Object.fromEntries(Array.from({ length: 17 }, (_, i) => [`stat${i}`, i])),
    { ['x'.repeat(65)]: 1 },
    { '': 1 },
    Object.fromEntries(
      Array.from({ length: 16 }, (_, i) => [
        String(i).padEnd(64, 'x'),
        Number.MAX_VALUE,
      ]),
    ),
  ]) {
    const invalid = structuredClone(snapshot);
    invalid.outcomes[0].stats = stats;
    assert.equal(policy.valid(invalid), false);
  }
  for (const field of ['totals', 'awards'] as const)
    for (const value of [-1, 0.5, Number.MAX_SAFE_INTEGER + 1]) {
      const invalid = structuredClone(snapshot);
      invalid.progress[field][players[0].id] = value;
      assert.equal(policy.valid(invalid), false, `${field}: ${value}`);
    }
  for (const seat of [-1, 8, 1.5]) {
    const invalid = structuredClone(snapshot);
    invalid.players[0].seat = seat;
    assert.equal(policy.valid(invalid), false);
  }
  runner.dispose();
});

void test('a game can shorten the arbitration window, bounded by the shared one', () => {
  const fire = (runner: RoundRunner, time: number) =>
    runner.input(
      { playerId: 'ada', name: 'fire', time, aim: { x: 0.5, y: 0.5 } },
      time + 10,
    );
  const delivered = (arbitrationMs?: number) => {
    const f = fixture();
    const runner = new RoundRunner(
      { ...f.descriptor, arbitrationMs },
      new SessionProgress(),
    );
    void runner.load();
    runner.begin(players, 0);
    runner.tick(3050, 16, {}, 0);
    assert.equal(fire(runner, 3100), true);
    for (let time = 3116; time <= 3400; time += 4) {
      runner.tick(time, 4, {}, 0);
      if (f.ticks.at(-1)!.actions.length) return time - 3100;
    }
    return Infinity;
  };
  assert.equal(delivered(), 200, 'default window');
  assert.equal(delivered(40), 40);
  assert.equal(delivered(0), 16, 'the first tick after arrival');
  assert.equal(delivered(5000), 200, 'never longer than the shared window');
  assert.equal(delivered(Number.NaN), 200);
});
