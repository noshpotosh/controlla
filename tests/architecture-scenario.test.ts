import assert from 'node:assert/strict';
import test from 'node:test';
import { GameHarness } from '../src/client/devtools/game-harness/harness.ts';
import {
  runScenario,
  type ScenarioStep,
} from '../src/client/devtools/game-harness/scenario.ts';
import { buttonProbe } from './fixtures/games.ts';
const descriptor = {
  ...buttonProbe,
  timing: { kind: 'timed' as const, durationMs: 1000 },
};
const action = (time: number) => ({
  playerId: 'ada',
  name: 'fire',
  time,
  aim: { x: 0.5, y: 0.5 },
});

void test('timestamped scenarios reproduce receipt order, late pre-cutoff input and separate display samples', async () => {
  const schedule: ScenarioStep[] = [
    {
      at: 3100,
      kind: 'value',
      playerId: 'ada',
      name: 'aim',
      value: { x: 0.2, y: 0.3 },
      capturedAt: 3050,
    },
    { at: 3120, kind: 'action', action: action(3100) },
    { at: 3500, kind: 'disconnect', playerId: 'ada' },
    { at: 3600, kind: 'reconnect', playerId: 'ada' },
    { at: 4110, kind: 'action', action: action(3999) },
    { at: 4110, kind: 'action', action: action(4000) },
  ];
  const replay = async () => {
    const harness = new GameHarness(descriptor, {
      sessionId: 'scheduled',
      seed: 7,
    });
    try {
      const result = await runScenario(harness, schedule, 4400);
      assert.equal(harness.phase, 'results');
      assert.equal(harness.authoritativeSnapshot()!.state!.scores.ada, 2);
      const resultAtReceipt = result.samples.find((s) => s.time === 4110)!;
      assert.equal(resultAtReceipt.authority!.phase, 'settling');
      assert.notEqual(resultAtReceipt.host!.phase, 'results');
      assert.deepEqual(
        result.samples.at(-1)!.host,
        result.samples.at(-1)!.remote,
      );
      return result;
    } finally {
      harness.dispose();
    }
  };
  assert.deepEqual(await replay(), await replay());
});

void test('simultaneous schedule steps preserve fixture order and fixed assignments through reconnect', async () => {
  const harness = new GameHarness(descriptor, { sessionId: 'order' });
  try {
    await runScenario(
      harness,
      [
        { at: 3100, kind: 'disconnect', playerId: 'ada' },
        { at: 3100, kind: 'action', action: action(3100) },
        { at: 3100, kind: 'reconnect', playerId: 'ada' },
        { at: 3100, kind: 'action', action: action(3100) },
      ],
      3400,
    );
    assert.equal(harness.authoritativeSnapshot()!.state!.scores.ada, 1);
    assert.equal(
      harness.authoritativeSnapshot()!.assignments[0].role,
      'default',
    );
    harness.finish();
    assert.equal(harness.phase, 'results');
    const progress = harness.progressView();
    harness.finish();
    assert.deepEqual(harness.progressView(), progress);
  } finally {
    harness.dispose();
  }
});

void test('scheduled abort during settling never awards; invalid and stopped timelines fail without looping', async () => {
  const harness = new GameHarness(descriptor, { sessionId: 'abort' });
  try {
    await runScenario(harness, [{ at: 4100, kind: 'abort' }], 4300);
    assert.equal(harness.phase, 'aborted');
    assert.equal(harness.progressView().rounds[0].status, 'aborted');
    assert.deepEqual(harness.progressView().rounds[0].awards, {});
    const before = harness.time;
    for (const at of [NaN, Infinity, -1, 5000])
      await assert.rejects(
        runScenario(harness, [{ at, kind: 'abort' }], 4400),
        /timeline/,
      );
    assert.equal(harness.time, before);
    harness.dispose();
    await assert.rejects(
      runScenario(harness, [], 4400),
      /clock did not advance/,
    );
  } finally {
    harness.dispose();
  }
});

void test('finish respects game-owned early completion and untimed safety policy', async () => {
  for (const early of [true, false]) {
    const harness = new GameHarness(
      {
        ...descriptor,
        timing: { kind: 'untimed', safetyDurationMs: 1000 },
        create(options) {
          const game = descriptor.create(options);
          return {
            ...game,
            tick(input) {
              return {
                ...game.tick(input),
                ...(early ? { complete: true as const } : {}),
              };
            },
          };
        },
      },
      { sessionId: 'finish' },
    );
    try {
      await harness.load();
      harness.finish();
      assert.equal(harness.phase, 'results');
      assert.equal(harness.authoritativeSnapshot()!.endAt, early ? 3000 : 4000);
      assert.equal(harness.time, early ? 3200 : 4200);
      assert.equal(harness.progressView().rounds.length, 1);
    } finally {
      harness.dispose();
    }
  }
});

void test('scenario fixtures detach before asynchronous loading and preserve value capture time', async () => {
  let release!: () => void;
  const captured: number[] = [];
  const harness = new GameHarness(
    {
      ...descriptor,
      create(options) {
        const game = descriptor.create(options);
        return {
          ...game,
          load: () =>
            new Promise<void>((resolve) => {
              release = resolve;
            }),
          tick(input) {
            const sample = input.values.ada?.aim;
            if (sample) captured.push(sample.time);
            return game.tick(input);
          },
        };
      },
    },
    { sessionId: 'detached-schedule' },
  );
  try {
    const schedule: ScenarioStep[] = [
      {
        at: 3100,
        kind: 'value',
        playerId: 'ada',
        name: 'aim',
        value: { x: 0.3, y: 0.4 },
        capturedAt: 3050,
      },
    ];
    const pending = runScenario(harness, schedule, 3200);
    schedule[0].at = 9999;
    release();
    await pending;
    assert.ok(captured.length > 0);
    assert.ok(captured.every((time) => time === 3050));
  } finally {
    harness.dispose();
  }
});
