import assert from 'node:assert/strict';
import test from 'node:test';
import type {
  GameDescriptor,
  GameContext,
  Presentation,
  RoundSnapshot,
} from '../src/client/api/index.ts';
import { games } from '../src/client/minigames/catalog.ts';
import {
  GameHarness,
  simulatedPlayers,
  snapshotPolicy,
} from '../src/client/devtools/game-harness/harness.ts';
import {
  buttonProbe,
  steeringProbe,
  type ProbeState,
} from './fixtures/games.ts';
import { resolveController } from '../src/client/engine/input.ts';
import { capabilityProfile } from '../src/client/devtools/game-harness/input.ts';
import { createScreen } from '../src/client/game-screen/screen.ts';
import { SessionProgress } from '../src/client/engine/progress.ts';
import { driveSimulatedPlayers } from '../src/client/devtools/game-harness/simulation.ts';
import {
  SnapshotEncoder,
  SnapshotTimeline,
} from '../src/client/engine/replication.ts';

void test('registered games run headlessly and host/remote share the production snapshot timeline', async () => {
  for (const descriptor of games) {
    const harness = new GameHarness(descriptor);
    await harness.load();
    harness.advance(10000, driveSimulatedPlayers);
    assert.equal(harness.error, null);
    assert.equal(harness.phase, 'running');
    assert.deepEqual(harness.display('host'), harness.display('remote'));
    assert.equal(harness.display('host')!.gameId, descriptor.id);
    const display = harness.display('host')!;
    display.players[0].name = 'tampered';
    assert.equal(harness.display('host')!.players[0].name, 'Ada');
    harness.dispose();
  }
});

void test('game-owned state receives chronological actions while local cursors remain immediate', async () => {
  const harness = new GameHarness(buttonProbe);
  await harness.load();
  harness.advance(3200);
  const target = { x: 0.5, y: 0.5 };
  assert.equal('racers' in harness.display('host')!.state!, false);
  harness.setValue('ada', 'aim', target);
  assert.deepEqual(harness.localCursors('host').ada, {
    x: target.x,
    y: target.y,
  });
  assert.equal(harness.display('host')!.cursors.ada, undefined);
  harness.press('bea', 'fire', 3200, target);
  harness.press('ada', 'fire', 3100, target);
  harness.advance(180);
  // Mature action is in authority, but the common presentation timeline is earlier.
  assert.equal(harness.display('host')!.state!.scores.ada, 0);
  harness.advance(220);
  assert.equal(harness.display('host')!.state!.scores.ada, 1);
  assert.equal(harness.display('host')!.state!.scores.bea, 1);
  assert.deepEqual(
    harness.display('host')!.state!.actions.map((a) => a.playerId),
    ['ada', 'bea'],
  );
  assert.deepEqual(harness.display('host'), harness.display('remote'));
  harness.dispose();
});

void test('two different games award cumulative points once; repeated games have distinct rounds', async () => {
  const session = new SessionProgress();
  const rally = new GameHarness(steeringProbe, { progress: session });
  await rally.load();
  rally.advance(33500, (h) => {
    for (const player of h.players)
      h.setValue(player.id, 'steer', { x: 0, y: 0 });
    if (h.time >= 3200 && h.time % 400 === 0) h.press('ada', 'boost');
  });
  assert.equal(rally.error, null);
  assert.equal(rally.phase, 'results');
  assert.equal(session.view().totals.ada, 2);
  rally.dispose();
  const target = new GameHarness(buttonProbe, { progress: session });
  await target.load();
  target.advance(33500, (h) => {
    const seen = { x: 0.5, y: 0.5 };
    if (seen && h.time % 400 === 0) h.press('bea', 'fire', h.time, seen);
  });
  assert.equal(target.error, null);
  assert.equal(target.phase, 'results');
  const view = session.view();
  assert.equal(view.rounds.length, 2);
  assert.ok(
    view.rounds[1].outcomes.find((outcome) => outcome.playerId === 'bea')!
      .score > 0,
  );
  assert.equal(view.rounds[1].awards.bea, 2);
  assert.equal(view.totals.bea, view.rounds[0].awards.bea + 2);
  target.advance(1000);
  assert.deepEqual(session.view(), view);
  target.dispose();
  const rematch = new GameHarness(buttonProbe, { progress: session });
  await rematch.load();
  assert.notEqual(rematch.roundId, target.roundId);
  rematch.abort();
  rematch.advance(33500);
  assert.deepEqual(session.view().totals, view.totals);
  assert.equal(session.view().rounds.at(-1)!.status, 'aborted');
  rematch.dispose();
});

void test('controller resolution exercises motion/fallback, invalid binding, and unavailable required input', () => {
  assert.equal(
    resolveController(buttonProbe, capabilityProfile(true)).widgets[0].type,
    'pointer',
  );
  assert.equal(
    resolveController(buttonProbe, capabilityProfile(false)).widgets[0].type,
    'stick',
  );
  assert.throws(
    () =>
      resolveController({
        ...buttonProbe,
        controls: {
          ...buttonProbe.controls,
          controller: { layout: 'aim-and-fire', bind: { fire: 'missing' } },
        },
      }),
    /No control named/,
  );
  assert.throws(
    () =>
      resolveController({
        ...buttonProbe,
        controls: {
          inputs: {
            aim: { prefer: 'pointer', fallback: null, required: true },
          },
        },
      }),
    /Motion access is off/,
  );
});

void test('load failure, readiness failure, and load cancellation never award points', async () => {
  for (const mode of ['reject', 'not-ready'] as const) {
    const descriptor: GameDescriptor<ProbeState> = {
      ...buttonProbe,
      create() {
        const game = buttonProbe.create();
        return {
          ...game,
          load: async () => {
            if (mode === 'reject') throw new Error('asset missing');
          },
          ready: () => false,
          start: game.start.bind(game),
          tick: game.tick.bind(game),
          finalize: game.finalize.bind(game),
          snapshot: game.snapshot.bind(game),
          disconnect: game.disconnect.bind(game),
          reconnect: game.reconnect.bind(game),
          dispose: game.dispose.bind(game),
        };
      },
    };
    const harness = new GameHarness(descriptor);
    await harness.load();
    assert.equal(harness.phase, 'error');
    assert.match(harness.error!, mode === 'reject' ? /asset missing/ : /ready/);
    assert.equal(harness.progressView().rounds.length, 0);
    harness.dispose();
  }
  let release!: () => void,
    started = false;
  const waiting: GameDescriptor<ProbeState> = {
    ...buttonProbe,
    create() {
      const game = buttonProbe.create();
      return {
        load: () =>
          new Promise<void>((resolve) => {
            release = resolve;
          }),
        ready: () => true,
        start: () => {
          started = true;
        },
        tick: game.tick.bind(game),
        finalize: game.finalize.bind(game),
        snapshot: game.snapshot.bind(game),
        disconnect: game.disconnect.bind(game),
        reconnect: game.reconnect.bind(game),
        dispose: game.dispose.bind(game),
      };
    },
  };
  const harness = new GameHarness(waiting),
    loading = harness.load();
  harness.dispose();
  release();
  await loading;
  assert.equal(started, false);
  assert.equal(harness.progressView().rounds.length, 0);
});

void test('disconnect freezes input, reconnect resumes, and final outcomes retain the initial roster', async () => {
  const harness = new GameHarness(buttonProbe);
  await harness.load();
  harness.advance(3200);
  const aim = { x: 0.5, y: 0.5 };
  harness.disconnect('ada');
  harness.press('ada', 'fire', harness.time, aim);
  harness.advance(400);
  assert.equal(harness.display('host')!.state!.scores.ada, 0);
  harness.reconnect('ada');
  harness.press('ada', 'fire', harness.time, aim);
  harness.advance(400);
  assert.equal(harness.display('host')!.state!.scores.ada, 1);
  harness.disconnect('cy');
  harness.advance(30000);
  assert.deepEqual(
    harness
      .progressView()
      .rounds[0].outcomes.map((outcome) => outcome.playerId),
    simulatedPlayers.map((player) => player.id),
  );
  harness.dispose();
});

void test('snapshot policy never interpolates outcomes, events or discrete game state from the future', async () => {
  const harness = new GameHarness(buttonProbe);
  await harness.load();
  harness.advance(3200);
  const before = harness.display('host')!;
  const after = structuredClone(before);
  after.state!.flag = true;
  after.state!.scores.ada = 1;
  after.progress.totals.ada = 2;
  after.events = [
    { id: 'future', kind: 'hit', time: 200, clock: 'presentation' },
  ];
  const encoder = new SnapshotEncoder<RoundSnapshot<ProbeState>>();
  const timeline = new SnapshotTimeline(snapshotPolicy(buttonProbe));
  const a = { id: 1, time: 100, state: before },
    b = { id: 2, time: 200, state: after };
  encoder.add(a);
  timeline.receive(encoder.forPeer('display', a));
  encoder.ack('display', a.id);
  encoder.add(b);
  const delta = encoder.forPeer('display', b);
  assert.equal(delta.base, 1);
  assert.equal(
    new SnapshotTimeline(snapshotPolicy(buttonProbe)).receive(delta),
    false,
  );
  assert.equal(timeline.receive(delta), true);
  assert.deepEqual(timeline.sample(150), before);
  assert.deepEqual(timeline.sample(200), after);
  assert.equal(timeline.sample(50), null);
  harness.dispose();
});

void test('renderer receives a frozen display copy and no completion or progress authority', async () => {
  let received: Presentation<ProbeState> | undefined;
  const descriptor = {
    ...buttonProbe,
    createRenderer() {
      return {
        render(presentation: Presentation<ProbeState>) {
          received = presentation;
        },
        dispose() {},
      };
    },
  };
  const harness = new GameHarness(descriptor);
  await harness.load();
  harness.advance(3200);
  const context = new Proxy(
    {},
    { get: () => () => {}, set: () => true },
  ) as CanvasRenderingContext2D;
  const screen = createScreen(descriptor);
  screen.render(context, harness.display('host'), 3040, 1600, 900);
  assert.ok(received);
  assert.equal('complete' in received, false);
  assert.equal('complete' in received.snapshot.progress, false);
  assert.throws(() => {
    (received!.snapshot.progress.totals as Record<string, number>).ada = 999;
  }, TypeError);
  assert.throws(() => {
    (received!.snapshot.state!.scores as Record<string, number>).ada = 999;
  }, TypeError);
  assert.equal(harness.progressView().totals.ada, 0);
  assert.equal(harness.display('host')!.state!.scores.ada, 0);
  screen.dispose();
  harness.dispose();
});

void test('only the framework finalizes a round, with an immutable data-only game context', async () => {
  let context: GameContext | undefined;
  let finalizations = 0;
  const descriptor: GameDescriptor<ProbeState> = {
    ...buttonProbe,
    create() {
      const game = buttonProbe.create();
      return {
        load: game.load.bind(game),
        ready: game.ready.bind(game),
        start(value) {
          context = value;
          game.start(value);
        },
        tick: game.tick.bind(game),
        finalize() {
          finalizations++;
          return game.finalize();
        },
        snapshot: game.snapshot.bind(game),
        disconnect: game.disconnect.bind(game),
        reconnect: game.reconnect.bind(game),
        dispose: game.dispose.bind(game),
      };
    },
  };
  const harness = new GameHarness(descriptor);
  await harness.load();
  assert.ok(context);
  assert.deepEqual(Object.keys(context).sort(), [
    'endAt',
    'mode',
    'players',
    'startAt',
  ]);
  assert.ok(Object.isFrozen(context));
  assert.ok(Object.isFrozen(context.players[0]));
  harness.advance(harness.endAt);
  assert.equal(harness.phase, 'settling');
  assert.equal(finalizations, 0);
  assert.equal(harness.progressView().rounds.length, 0);
  harness.advance(200);
  assert.equal(harness.phase, 'results');
  assert.equal(finalizations, 1);
  harness.advance(1000);
  assert.equal(finalizations, 1);
  assert.equal(harness.progressView().rounds.length, 1);
  harness.dispose();
});

void test('countdown actions cannot become a first-frame game action', async () => {
  const first = new GameHarness(steeringProbe),
    second = new GameHarness(steeringProbe);
  await first.load();
  await second.load();
  first.press('ada', 'boost', 0);
  first.advance(3200);
  second.advance(3200);
  assert.deepEqual(
    first.display('host')!.state!.scores,
    second.display('host')!.state!.scores,
  );
  first.dispose();
  second.dispose();
});

void test('abort during loading prevents start; concurrent loads share one attempt', async () => {
  let release!: () => void,
    loads = 0,
    starts = 0;
  const descriptor: GameDescriptor<ProbeState> = {
    ...buttonProbe,
    create() {
      const game = buttonProbe.create();
      return {
        load: () => {
          loads++;
          return new Promise<void>((resolve) => {
            release = resolve;
          });
        },
        ready: () => true,
        start: () => {
          starts++;
        },
        tick: game.tick.bind(game),
        finalize: game.finalize.bind(game),
        snapshot: game.snapshot.bind(game),
        disconnect: game.disconnect.bind(game),
        reconnect: game.reconnect.bind(game),
        dispose: game.dispose.bind(game),
      };
    },
  };
  const harness = new GameHarness(descriptor),
    loading = harness.load();
  assert.equal(harness.load(), loading);
  harness.abort();
  release();
  await loading;
  assert.equal(loads, 1);
  assert.equal(starts, 0);
  assert.equal(harness.progressView().rounds.length, 0);
  harness.dispose();
});

void test('final arbitration-window actions drain before round completion', async () => {
  const harness = new GameHarness(buttonProbe);
  await harness.load();
  harness.advance(32900);
  const aim = { x: 0.5, y: 0.5 };
  harness.press('ada', 'fire', 32900, aim);
  harness.advance(500);
  assert.equal(harness.phase, 'results');
  assert.equal(harness.display('host')!.state!.scores.ada, 1);
  assert.equal(harness.progressView().rounds[0].outcomes[0].score, 1);
  harness.dispose();
});
