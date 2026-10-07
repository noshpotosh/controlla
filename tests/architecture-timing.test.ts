import assert from 'node:assert/strict';
import { test } from 'node:test';
import type {
  GameDescriptor,
  GameInput,
  RoundTiming,
} from '../src/client/api/index.ts';
import type { ControllerConfig } from '../src/client/controls/api.ts';
import { RoundRunner } from '../src/client/engine/round.ts';
import { SessionProgress } from '../src/client/engine/progress.ts';
import { SessionAuthority } from '../src/client/engine/session.ts';
import {
  GameHarness,
  simulatedPlayers,
} from '../src/client/devtools/game-harness/harness.ts';
import { games } from '../src/client/minigames/catalog.ts';
import { buttonProbe } from './fixtures/games.ts';

function fixture(
  timing: RoundTiming = { kind: 'untimed', safetyDurationMs: 1000 },
  completeAt = 3100,
) {
  const ticks: GameInput[] = [];
  let finalizations = 0;
  const descriptor: GameDescriptor = {
    ...buttonProbe,
    id: 'timing-probe',
    timing,
    create() {
      const game = buttonProbe.create();
      return {
        ...game,
        tick(input) {
          ticks.push(structuredClone(input));
          return {
            ...game.tick(input),
            ...(input.time >= completeAt ? { complete: true as const } : {}),
          };
        },
        finalize() {
          finalizations++;
          return game.finalize();
        },
      };
    },
  };
  return { descriptor, ticks, finalized: () => finalizations };
}
const players = structuredClone(simulatedPlayers.slice(0, 2));
const action = (time: number) => ({
  playerId: 'ada',
  name: 'fire',
  time,
  aim: { x: 0.5, y: 0.5 },
});

void test('early completion latches the tick cutoff and drains only eligible late input exactly once', () => {
  const f = fixture();
  const progress = new SessionProgress();
  const runner = new RoundRunner(f.descriptor, progress);
  void runner.load();
  runner.begin(players, 0);
  runner.tick(3050, 50, {}, 0);
  assert.equal(runner.input(action(3080), 3080), true);
  assert.equal(runner.input(action(3120), 3080), true); // Future queued actions are removed when completion latches.
  runner.tick(
    3100,
    50,
    { ada: { aim: { time: 3080, value: { x: 1, y: 1 } } } },
    0,
  );
  assert.equal(runner.phase, 'settling');
  assert.equal(runner.endAt, 3100);
  assert.equal(runner.input(action(3100), 3150), false);
  assert.equal(runner.input(action(3070), 3199), true);
  assert.equal(runner.input(action(3090), 3300), false);
  runner.tick(3299, 50, {}, 0);
  assert.equal(f.finalized(), 0);
  runner.tick(3300, 1, {}, 0);
  assert.equal(runner.phase, 'results');
  assert.equal(runner.endAt, 3100); // Repeated settling completion cannot extend it.
  assert.deepEqual(
    f.ticks.at(-1)!.actions.map((a) => a.time),
    [3070, 3080],
  );
  assert.deepEqual(f.ticks.at(-1)!.values, {});
  assert.equal(f.ticks.at(-1)!.dt, 0);
  assert.equal(f.finalized(), 1);
  runner.tick(3500, 50, {}, 0);
  assert.equal(f.finalized(), 1);
  assert.equal(progress.view().rounds.length, 1);
  runner.dispose();
});

void test('untimed safety deadline and abort during early settling retain finite bounds without duplicate awards', () => {
  for (const abort of [false, true]) {
    const f = fixture(
      { kind: 'untimed', safetyDurationMs: 1000 },
      abort ? 3100 : Infinity,
    );
    const progress = new SessionProgress();
    const runner = new RoundRunner(f.descriptor, progress);
    void runner.load();
    runner.begin(players, 0);
    runner.tick(abort ? 3100 : 4000, 50, {}, 0);
    assert.equal(runner.phase, 'settling');
    assert.equal(runner.endAt, abort ? 3100 : 4000);
    assert.deepEqual(runner.snapshot()!.timing, f.descriptor.timing);
    if (abort) runner.abort();
    runner.tick(4200, 50, {}, 0);
    assert.equal(f.finalized(), abort ? 0 : 1);
    assert.equal(
      progress.view().rounds.filter((round) => round.status === 'completed')
        .length,
      abort ? 0 : 1,
    );
    runner.dispose();
  }
});

void test('invalid timing policies and invalid completion output fail before awards', () => {
  for (const timing of [
    { kind: 'timed', durationMs: 0 },
    { kind: 'untimed', safetyDurationMs: Infinity },
    { kind: 'untimed', safetyDurationMs: 0.5 },
    { kind: 'untimed', safetyDurationMs: 86400001 },
  ])
    assert.throws(
      () =>
        new RoundRunner(
          fixture(timing as RoundTiming).descriptor,
          new SessionProgress(),
        ),
      /timing/,
    );
  const f = fixture();
  const create = f.descriptor.create.bind(f.descriptor);
  f.descriptor.create = () => ({
    ...create(),
    tick: () => ({ events: [], complete: true, invalid: new Date() }) as never,
  });
  const progress = new SessionProgress();
  const runner = new RoundRunner(f.descriptor, progress);
  void runner.load();
  runner.begin(players, 0);
  runner.tick(3100, 50, {}, 0);
  assert.equal(runner.phase, 'error');
  assert.equal(f.finalized(), 0);
  assert.equal(
    progress.view().rounds.filter((round) => round.status === 'completed')
      .length,
    0,
  );
  assert.ok(
    Object.values(progress.view().totals).every((total) => total === 0),
  );
});

void test('the public harness uses early completion and untimed safety through the production runner', async () => {
  for (const early of [true, false]) {
    const f = fixture(
      { kind: 'untimed', safetyDurationMs: 1000 },
      early ? 3100 : Infinity,
    );
    const harness = new GameHarness(f.descriptor, { players });
    await harness.load();
    harness.advance(3080);
    harness.press('ada', 'fire', 3080);
    harness.advance(early ? 20 : 920);
    assert.equal(harness.phase, 'settling');
    assert.equal(harness.endAt, early ? 3100 : 4000);
    harness.advance(99);
    harness.press('ada', 'fire', harness.endAt - 10);
    harness.press('ada', 'fire', harness.endAt);
    harness.advance(101);
    assert.equal(harness.phase, 'results');
    assert.equal(f.finalized(), 1);
    harness.dispose();
  }
});

void test('live authority admits delayed pre-cutoff presses and rejects post-cutoff gameplay for untimed early completion', (t) => {
  const f = fixture();
  (games as GameDescriptor[]).push(f.descriptor);
  t.after(() =>
    (games as GameDescriptor[]).splice(games.indexOf(f.descriptor), 1),
  );
  let clock = 0;
  t.mock.method(performance, 'now', () => clock);
  const configs: Record<string, ControllerConfig> = {};
  const authority = new SessionAuthority('host', {
    toPlayer(id, msg) {
      if (msg.type === 'config') configs[id] = msg.config;
    },
    toVenue() {},
    snapshot() {},
    event() {},
    warning() {},
  });
  t.after(() => authority.dispose());
  authority.setRoster({
    players,
    venues: [{ id: 'host', name: 'Host', connected: true }],
  });
  authority.start(f.descriptor.id, 'standard');
  for (const player of players)
    authority.control(player.id, {
      type: 'ready',
      generation: configs[player.id].generation,
    });
  authority.tick();
  const press = (time: number, counter: number) =>
    authority.control('ada', {
      type: 'press',
      press: {
        playerId: 'ada',
        generation: configs.ada.generation,
        button: 0,
        counter,
        time,
        x: 0.5,
        y: 0.5,
      },
    });
  clock = 3080;
  authority.tick();
  press(3080, 1);
  clock = 3100;
  authority.tick();
  clock = 3199;
  press(3090, 2);
  press(3100, 3);
  clock = 3300;
  press(3099, 4);
  authority.tick();
  assert.equal(f.finalized(), 1);
  assert.deepEqual(
    f.ticks.at(-1)!.actions.map((a) => a.time),
    [3080, 3090],
  );
  assert.equal(authority.summary().completed.length, 1);
});
