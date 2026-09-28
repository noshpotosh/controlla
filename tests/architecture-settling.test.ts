import assert from 'node:assert/strict';
import test from 'node:test';
import { ARBITRATION_MS } from '../src/client/engine/arbitration.ts';
import { SessionAuthority } from '../src/client/engine/session.ts';
import { encodeInput } from '../src/client/engine/protocol.ts';
import type { ControllerConfig } from '../src/client/controls/api.ts';
import type { InputFrame } from '../src/client/engine/protocol.ts';
import type { Player } from '../src/shared/room.ts';
import type {
  GameContext,
  PresentationEvent,
  GameDescriptor,
  GameInput,
  Presentation,
} from '../src/client/api/index.ts';
import {
  GameHarness,
  simulatedPlayers,
} from '../src/client/devtools/game-harness/harness.ts';
import {
  buttonProbe,
  steeringProbe,
  type ProbeState as InputProbeState,
} from './fixtures/games.ts';
import { games } from '../src/client/minigames/catalog.ts';
import { createScreen } from '../src/client/game-screen/screen.ts';

void test('terminal actions are judged together by timestamp, with a strict arrival cutoff', async () => {
  const harness = new GameHarness(buttonProbe);
  await harness.load();
  harness.advance(harness.endAt - 100);
  const aim = { x: 0.5, y: 0.5 };
  harness.press('ada', 'fire', harness.endAt - 20, aim);
  harness.press('ada', 'fire', harness.endAt, aim); // Timestamp cutoff is exclusive.
  harness.advance(250);
  assert.equal(harness.phase, 'settling');
  assert.equal(harness.display('host')!.state!.scores.ada, 0);
  harness.press('bea', 'fire', harness.endAt - 99, aim); // Earlier action arrives later.
  harness.advance(49);
  harness.press('cy', 'fire', harness.endAt - 50, aim); // Deadline minus one is accepted.
  harness.advance(1, (h) => h.press('ada', 'fire', harness.endAt - 100, aim));
  assert.equal(harness.phase, 'results');
  assert.equal(
    harness.progressView().rounds[0].outcomes.find((o) => o.playerId === 'bea')!
      .score,
    1,
  );
  assert.equal(
    Object.keys(harness.display('host')!.progress.awards).length,
    0,
    'authority results stay behind the display horizon',
  );
  harness.advance(harness.presentationDelay);
  const result = harness.display('host')!;
  assert.equal(result.phase, 'results');
  assert.deepEqual(result.state!.scores, { ada: 1, bea: 1, cy: 1 });
  assert.deepEqual(
    result.state!.actions.map((a) => a.playerId),
    ['bea', 'cy', 'ada'],
  );
  assert.deepEqual(harness.display('remote'), result);
  const before = harness.progressView();
  harness.press('ada', 'fire', harness.endAt - 100, aim);
  harness.advance(1000);
  assert.deepEqual(harness.progressView(), before);
  harness.dispose();
});

interface ProbeState {
  score: number;
  elapsed: number;
}
function probe() {
  const state: ProbeState = { score: 0, elapsed: 0 };
  const ticks: GameInput[] = [];
  let context: GameContext;
  let finalized = 0;
  const descriptor: GameDescriptor<ProbeState> = {
    ...buttonProbe,
    id: 'clock-probe',
    interpolate: undefined,
    durationMs: 30_005,
    isState: (value: unknown): value is ProbeState =>
      !!value &&
      typeof value === 'object' &&
      'score' in value &&
      'elapsed' in value,
    createRenderer: () => ({ render() {}, dispose() {} }),
    create: () => ({
      load() {},
      ready: () => true,
      start(value) {
        context = value;
      },
      tick(input) {
        ticks.push(structuredClone(input));
        const aim = input.values.ada?.aim?.value as { x: number } | undefined;
        state.score += (aim?.x ?? 0) * input.dt;
        state.elapsed += input.dt;
        return [];
      },
      finalize() {
        finalized++;
        return context.players.map((player) => ({
          playerId: player.id,
          placement: 1,
          score: state.score,
        }));
      },
      snapshot: () => structuredClone(state),
      disconnect() {},
      reconnect() {},
      dispose() {},
    }),
  };
  return { descriptor, state, ticks, finalized: () => finalized };
}

void test('two value-bearing actions retain separate semantic values before their tick', async () => {
  const { descriptor, ticks } = probe();
  const harness = new GameHarness({
    ...descriptor,
    controls: steeringProbe.controls,
  });
  await harness.load();
  harness.advance(3200);
  const first = { dir: 'right', x: 1, y: 0, distance: 0.5, velocity: 2 };
  harness.setValue('ada', 'boost', first);
  harness.press('ada', 'boost');
  first.distance = 999;
  const second = { dir: 'left', x: -1, y: 0, distance: 0.8, velocity: 3 };
  harness.setValue('ada', 'boost', second);
  harness.press('ada', 'boost');
  harness.setValue('ada', 'boost', { ...second, distance: 0.1 });
  second.distance = 888;
  harness.advance(220);
  assert.deepEqual(
    ticks.flatMap((tick) => tick.actions).map((action) => action.value),
    [
      { dir: 'right', x: 1, y: 0, distance: 0.5, velocity: 2 },
      { dir: 'left', x: -1, y: 0, distance: 0.8, velocity: 3 },
    ],
  );
  harness.dispose();
});

void test('cutoff clips the final continuous slice and freezes values throughout settling', async () => {
  const { descriptor, state, ticks, finalized } = probe();
  const harness = new GameHarness(descriptor);
  await harness.load();
  harness.advance(33_000, (h) => h.setValue('ada', 'aim', { x: 1, y: 0 }));
  harness.advance(20, (h) => h.setValue('ada', 'aim', { x: 1000, y: 0 }));
  assert.equal(harness.phase, 'settling');
  assert.deepEqual(state, {
    score: descriptor.durationMs,
    elapsed: descriptor.durationMs,
  });
  assert.equal(ticks.at(-1)!.dt, 5);
  const calls = ticks.length;
  harness.advance(184);
  assert.equal(ticks.length, calls);
  assert.equal(finalized(), 0);
  harness.advance(21, (h) => h.press('ada', 'fire', h.endAt - 1)); // Overshoot never extends admission.
  assert.equal(harness.phase, 'results');
  assert.equal(ticks.length, calls + 1);
  assert.equal(ticks.at(-1)!.phase, 'settling');
  assert.equal(ticks.at(-1)!.dt, 0);
  assert.deepEqual(ticks.at(-1)!.values, {});
  assert.deepEqual(ticks.at(-1)!.actions, []);
  assert.deepEqual(state, {
    score: descriptor.durationMs,
    elapsed: descriptor.durationMs,
  });
  assert.equal(finalized(), 1);
  harness.dispose();
});

void test('countdown receipt cannot use a future timestamp to pre-fire at start', async () => {
  const harness = new GameHarness(buttonProbe);
  await harness.load();
  harness.advance(harness.startAt - 1);
  const aim = { x: 0.5, y: 0.5 };
  harness.press('ada', 'fire', harness.startAt, aim);
  harness.advance(1, (h) => h.press('bea', 'fire', h.startAt, aim));
  harness.advance(400);
  assert.deepEqual(harness.display('host')!.state!.scores, {
    ada: 0,
    bea: 1,
    cy: 0,
  });
  assert.equal(harness.display('host')!.state!.scores.bea, 1);
  harness.dispose();
});

void test('disconnect clears held cutoff values; abort during settling never finalizes', async () => {
  const { descriptor, state, finalized } = probe();
  const harness = new GameHarness(descriptor);
  await harness.load();
  harness.advance(33_000, (h) => h.setValue('ada', 'aim', { x: 1, y: 0 }));
  const score = state.score;
  harness.disconnect('ada');
  harness.advance(20);
  assert.equal(state.score, score);
  assert.equal(harness.phase, 'settling');
  harness.abort();
  harness.advance(1000);
  assert.equal(finalized(), 0);
  assert.equal(harness.progressView().rounds[0].status, 'aborted');
  assert.deepEqual(harness.progressView().totals, { ada: 0, bea: 0, cy: 0 });
  harness.dispose();
});

void test('disconnect after cutoff cannot erase the final active interval before its crossing tick', async () => {
  const { descriptor, state } = probe();
  const harness = new GameHarness(descriptor);
  await harness.load();
  harness.advance(33_000, (h) => h.setValue('ada', 'aim', { x: 1, y: 0 }));
  harness.advance(20, (h) => h.disconnect('ada'));
  assert.deepEqual(state, {
    score: descriptor.durationMs,
    elapsed: descriptor.durationMs,
  });
  harness.dispose();
});

void test('terminal queue survives settling disconnect and reconnect; pre-cutoff disconnect still purges', async () => {
  for (const when of ['before', 'after', 'after-and-return'] as const) {
    const harness = new GameHarness(buttonProbe);
    await harness.load();
    harness.advance(harness.endAt - 100);
    const aim = { x: 0.5, y: 0.5 };
    harness.press('ada', 'fire', harness.time, aim);
    harness.advance(when === 'before' ? 50 : 101);
    harness.disconnect('ada');
    assert.equal(harness.players[0].connected, false);
    if (when === 'after-and-return') harness.reconnect('ada');
    harness.advance(500);
    const result = harness
      .progressView()
      .rounds[0].outcomes.find((outcome) => outcome.playerId === 'ada')!;
    assert.equal(result.score, when === 'before' ? 0 : 1, when);
    assert.equal(harness.progressView().rounds.length, 1);
    harness.dispose();
  }
});

void test('settling does not advance continuous game state', async () => {
  const harness = new GameHarness(buttonProbe);
  await harness.load();
  harness.advance(harness.endAt + 160);
  const frozen = harness.display('host')!.state!;
  harness.advance(240, (h) => h.setValue('ada', 'aim', { x: 0.9, y: 0.9 }));
  assert.deepEqual(harness.display('host')!.state!.cursors, frozen.cursors);
  assert.equal(harness.display('host')!.state!.elapsed, frozen.elapsed);
  harness.dispose();
});

void test('finalization errors and invalid snapshots abort before any progress is awarded', async () => {
  for (const failure of [
    'throws',
    'outcomes',
    'snapshot',
    'uncloneable',
  ] as const) {
    let calls = 0;
    const descriptor: GameDescriptor<InputProbeState> = {
      ...buttonProbe,
      create() {
        const game = buttonProbe.create();
        let invalidState = false;
        return {
          load: game.load.bind(game),
          ready: game.ready.bind(game),
          start: game.start.bind(game),
          tick: game.tick.bind(game),
          finalize() {
            calls++;
            if (failure === 'throws') throw new Error('finalization failed');
            if (failure === 'outcomes') return [];
            if (failure === 'snapshot') invalidState = true;
            const outcomes = game.finalize();
            if (failure === 'uncloneable')
              Object.assign(outcomes[0], { unexpected: () => 1 });
            return outcomes;
          },
          snapshot() {
            const value = game.snapshot();
            if (invalidState) value.elapsed = Number.NaN;
            return value;
          },
          disconnect: game.disconnect.bind(game),
          reconnect: game.reconnect.bind(game),
          dispose: game.dispose.bind(game),
        };
      },
    };
    const harness = new GameHarness(descriptor);
    await harness.load();
    harness.advance(harness.endAt + ARBITRATION_MS);
    assert.equal(harness.phase, 'error', failure);
    assert.equal(calls, 1);
    assert.equal(harness.progressView().rounds[0].status, 'aborted');
    assert.deepEqual(harness.progressView().totals, { ada: 0, bea: 0, cy: 0 });
    harness.dispose();
  }
});

const input = (time: number, x: number): InputFrame => ({
  seq: 0,
  time,
  generation: 1,
  x,
  y: 0,
  vx: 0,
  vy: 0,
  buttons: 0,
  edges: [0, 0, 0, 0],
  edgeTimes: [0, 0, 0, 0],
  confidence: 1,
});
const players: Player[] = structuredClone(simulatedPlayers.slice(0, 2));

void test('live authority retains terminal presses until one final batch and blocks the next round', (t) => {
  (games as GameDescriptor[]).push(steeringProbe);
  t.after(() =>
    (games as GameDescriptor[]).splice(games.indexOf(steeringProbe), 1),
  );
  let clock = 0;
  t.mock.method(performance, 'now', () => clock);
  const configs: Record<string, ControllerConfig> = {};
  const events: PresentationEvent[] = [];
  const authority = new SessionAuthority('host', {
    toPlayer(id, message) {
      if (message.type === 'config') configs[id] = message.config;
    },
    toVenue() {},
    snapshot() {},
    event(_id, event) {
      events.push(event);
    },
    warning() {},
  });
  authority.setRoster({
    players,
    venues: [{ id: 'host', name: 'Host', connected: true }],
  });
  authority.start(steeringProbe.id, 'standard');
  for (const player of players)
    authority.control(player.id, {
      type: 'ready',
      generation: configs[player.id].generation,
    });
  authority.tick();
  const send = (id: string, time: number, counter = 1) =>
    authority.control(id, {
      type: 'press',
      press: {
        playerId: id,
        generation: configs[id].generation,
        button: 0,
        counter,
        time,
        x: 0,
        y: 0,
        value: { dir: 'right', x: 1, y: 0, distance: 0.5, velocity: 2 },
      },
    });
  clock = 2999;
  send('ada', 3000, 4); // Future timestamp cannot bypass countdown receipt gating.
  clock = 32900;
  authority.tick();
  send('ada', 32900);
  clock = 33000;
  authority.tick();
  assert.throws(() => authority.start(steeringProbe.id, 'standard'), /Finish/);
  assert.equal(authority.summary().completed.length, 0);
  clock = 33001;
  authority.setRoster({
    players: players.map((player) => ({
      ...player,
      connected: player.id !== 'ada',
    })),
    venues: [{ id: 'host', name: 'Host', connected: true }],
  });
  clock = 33050;
  authority.setRoster({
    players: structuredClone(players),
    venues: [{ id: 'host', name: 'Host', connected: true }],
  });
  clock = 33150;
  send('bea', 32899);
  authority.tick();
  assert.equal(events.filter((event) => event.kind === 'hit').length, 0);
  clock = 33200;
  send('ada', 32950, 2); // Exact receipt deadline is excluded.
  clock = 33210;
  send('ada', 32999, 3); // A delayed final tick cannot extend admission.
  clock = 33220;
  authority.tick();
  assert.deepEqual(
    events
      .filter((event) => event.kind === 'hit')
      .map((event) => event.playerId),
    ['bea', 'ada'],
  );
  assert.equal(authority.summary().completed.length, 1);
  clock = 33400;
  authority.tick();
  assert.equal(authority.summary().completed.length, 1);
  assert.equal(events.filter((event) => event.kind === 'end').length, 1);
});

void test('removing a roster member before cutoff clears queued actions and continuous input', (t) => {
  (games as GameDescriptor[]).push(buttonProbe);
  t.after(() =>
    (games as GameDescriptor[]).splice(games.indexOf(buttonProbe), 1),
  );
  let clock = 0;
  t.mock.method(performance, 'now', () => clock);
  const configs: Record<string, ControllerConfig> = {};
  const events: PresentationEvent[] = [];
  const authority = new SessionAuthority('host', {
    toPlayer(id, message) {
      if (message.type === 'config') configs[id] = message.config;
    },
    toVenue() {},
    snapshot() {},
    event(_id, event) {
      events.push(event);
    },
    warning() {},
  });
  const venues = [{ id: 'host', name: 'Host', connected: true }];
  authority.setRoster({ players, venues });
  authority.start(buttonProbe.id, 'standard');
  for (const player of players)
    authority.control(player.id, {
      type: 'ready',
      generation: configs[player.id].generation,
    });
  authority.tick();
  const generation = configs.ada.generation;
  clock = 5000;
  authority.input('ada', encodeInput({ ...input(clock, 0.8), generation }));
  authority.control('ada', {
    type: 'press',
    press: { generation, time: clock, button: 0, counter: 1, x: 0.8, y: 0.2 },
  });
  authority.setRoster({
    players: players.filter((player) => player.id !== 'ada'),
    venues,
  });
  clock = 5220;
  authority.tick();
  const state = [...authority.encoder.history.values()].at(-1)!.state!;
  assert.equal(state.cursors.ada, undefined);
  assert.equal((state.state as InputProbeState).flag, false);
  assert.equal(events.filter((event) => event.kind === 'hit').length, 0);
  authority.setRoster({ players, venues });
  assert.notEqual(
    configs.ada.generation,
    generation,
    'an absent identity returning gets a fresh input generation',
  );
});

void test('settling presentation freezes renderer time and cannot reveal future progress', async () => {
  let received: Presentation<InputProbeState> | undefined;
  const descriptor = {
    ...buttonProbe,
    createRenderer: () => ({
      render(value: Presentation<InputProbeState>) {
        received = value;
      },
      dispose() {},
    }),
  };
  const harness = new GameHarness(descriptor);
  await harness.load();
  harness.advance(harness.endAt + harness.presentationDelay);
  const snapshot = harness.display('host')!;
  assert.equal(snapshot.phase, 'settling');
  const screen = createScreen(descriptor);
  const context = new Proxy(
    {},
    { get: () => () => {}, set: () => true },
  ) as CanvasRenderingContext2D;
  screen.render(context, snapshot, harness.endAt + 100, 1600, 900);
  assert.equal(received!.time, harness.endAt);
  assert.equal(Object.keys(received!.snapshot.progress.awards).length, 0);
  assert.deepEqual(harness.display('host'), harness.display('remote'));
  screen.dispose();
  harness.dispose();
});
