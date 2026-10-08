import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { Runtime } from '../src/client/runtime/runtime.ts';
import { createPresenter } from '../src/client/game-screen/presenter.ts';
import { findGame, games } from '../src/client/minigames/catalog.ts';
import type { ScreenFrame } from '../src/client/game-screen/port.ts';
import type {
  GameDescriptor,
  Progress,
  RoundSnapshot,
} from '../src/client/api/index.ts';
import type { Message } from '../src/client/engine/messages.ts';
import { historyMessages } from '../src/client/engine/history.ts';
import { SnapshotTimeline } from '../src/client/engine/replication.ts';
import { catalogSnapshotPolicy } from '../src/client/engine/snapshots.ts';

function install(t: TestContext, name: string, value: unknown) {
  const old = Object.getOwnPropertyDescriptor(globalThis, name);
  Object.defineProperty(globalThis, name, {
    configurable: true,
    writable: true,
    value,
  });
  t.after(() => {
    if (old) Object.defineProperty(globalThis, name, old);
    else Reflect.deleteProperty(globalThis, name);
  });
}

function display(t: TestContext) {
  let clock = 1000;
  t.mock.method(performance, 'now', () => clock);
  t.after(() => runtime.close());
  install(
    t,
    'document',
    Object.assign(new EventTarget(), {
      hidden: false,
      createElement: () => ({ click() {} }),
    }),
  );
  install(
    t,
    'window',
    Object.assign(new EventTarget(), { devicePixelRatio: 1 }),
  );
  install(t, 'navigator', { maxTouchPoints: 1 });
  install(t, 'innerWidth', 800);
  install(t, 'innerHeight', 600);
  const runtime = new Runtime({ role: 'display', endpoint: 'ws://unused' });
  runtime.view.identity = {
    id: 'remote',
    role: 'display',
    hostId: 'host',
    venueId: 'remote',
    room: 'ABCD',
    token: 'test',
  };
  runtime.network.onWelcome(runtime.view.identity);
  const sent: Message[] = [];
  t.mock.method(
    runtime.network,
    'send',
    (_id: string, _channel: string, data: unknown) =>
      sent.push(data as Message),
  );
  const receive = (channel: 'ctrl' | 'events' | 'snapshot', message: Message) =>
    runtime.network.onMessage('host', channel, message);
  return {
    runtime,
    sent,
    receive,
    at: (value: number) => {
      clock = value;
    },
  };
}

async function snapshot(): Promise<RoundSnapshot<object>> {
  const descriptor = findGame('neon-harvest')!;
  const game = descriptor.create({ mode: descriptor.defaultMode });
  await game.load();
  const players = [
    {
      id: 'a',
      venueId: 'remote',
      seat: 0,
      name: 'Ada',
      color: 'green',
      connected: true,
    },
  ];
  game.start({
    mode: descriptor.defaultMode,
    players,
    seed: 0,
    assignments: players.map((player) => ({
      playerId: player.id,
      role: 'default',
      controls: descriptor.controls,
    })),
    startAt: 0,
    endAt: 30000,
  });
  const state = game.snapshot();
  game.dispose();
  return {
    schemaVersion: 2,
    timing: descriptor.timing,
    seed: 0,
    assignments: players.map((player) => ({
      playerId: player.id,
      role: 'default',
      controls: descriptor.controls,
    })),
    roundId: 'round-a',
    gameId: descriptor.id,
    mode: descriptor.defaultMode,
    phase: 'running',
    startAt: 0,
    endAt: 30000,
    players,
    state,
    cursors: { a: { x: 0.2, y: 0.3 } },
    events: [
      {
        id: 'marker',
        time: 900,
        clock: 'presentation',
        kind: 'prompt',
        measure: true,
      },
    ],
    outcomes: [],
    progress: { revision: 0, totals: { a: 0 }, awards: {} },
    error: null,
  };
}

const wire = (state: RoundSnapshot<object>, id = 1) => ({
  type: 'snapshot',
  delay: 100,
  snapshot: { id, time: 800 + id, base: null, patch: state },
});

function context() {
  const labels: string[] = [];
  const ctx = new Proxy(
    {
      fillText: (text: string) => labels.push(text),
      createRadialGradient: () => ({ addColorStop() {} }),
    },
    {
      get(target, key) {
        return Reflect.get(target, key) ?? (() => {});
      },
    },
  ) as unknown as CanvasRenderingContext2D;
  return { ctx, labels };
}

void test('screen port samples one immutable snapshot and retains valid state across malformed wires with one resync request', async (t) => {
  const { runtime, receive, sent } = display(t);
  receive('snapshot', wire(await snapshot()));
  const frame = runtime.screenPort.advanceFrame();
  assert.equal(frame.presentationTime, 900);
  assert.equal(frame.delay, 100);
  assert.ok(Object.isFrozen(frame));
  assert.ok(Object.isFrozen(frame.snapshot?.state));
  assert.throws(() => {
    (frame.snapshot!.state as Record<string, unknown>).wave = 99;
  });
  receive('snapshot', { type: 'snapshot', snapshot: null });
  receive('snapshot', {
    type: 'snapshot',
    snapshot: { id: 2, time: NaN, base: null, patch: {} },
  });
  assert.equal(sent.filter((message) => message.type === 'resync').length, 1);
  assert.equal(runtime.screenPort.advanceFrame().snapshot?.roundId, 'round-a');
  receive('snapshot', wire(await snapshot(), 3));
  receive('snapshot', { type: 'snapshot', snapshot: null });
  assert.equal(sent.filter((message) => message.type === 'resync').length, 2);
});

void test('unsupported games and schema versions show reload guidance; loading and pre-snapshot abort follow authority phase', async (t) => {
  const { runtime, receive } = display(t);
  receive('ctrl', {
    type: 'phase',
    phase: 'loading',
    roundId: null,
    gameId: 'missing-game',
    mode: 'default',
    error: null,
  });
  assert.equal(runtime.screenPort.advanceFrame().status, 'loading');
  receive('ctrl', { type: 'phase', phase: 'aborted', roundId: null });
  assert.equal(runtime.screenPort.advanceFrame().status, 'aborted');
  receive('ctrl', { type: 'phase', phase: 'running', roundId: 'round-a' });
  const future = await snapshot();
  future.gameId = 'future-game';
  receive('snapshot', wire(future));
  assert.equal(runtime.screenPort.advanceFrame().status, 'unsupported');
  receive('snapshot', {
    type: 'snapshot',
    snapshot: { id: 2, time: 900, base: null, patch: { schemaVersion: 99 } },
  });
  assert.match(runtime.screenPort.advanceFrame().message ?? '', /Reload/);
});

void test('renderers see frozen state and markers are returned only after a successful draw; failures dispose locally once', async () => {
  let disposed = 0,
    created = 0,
    shouldThrow = false;
  const state = await snapshot();
  const descriptor: GameDescriptor = {
    ...findGame(state.gameId)!,
    createRenderer() {
      created++;
      return {
        render(presentation) {
          assert.ok(Object.isFrozen(presentation.snapshot.state));
          assert.equal(presentation.delay, 100);
          if (shouldThrow) throw new Error('paint failed');
          return ['marker'];
        },
        dispose() {
          disposed++;
        },
      };
    },
  };
  const presenter = createPresenter([descriptor]);
  const frame: ScreenFrame = {
    snapshot: state,
    presentationTime: 900,
    delay: 100,
    localCursors: {},
    status: 'ready',
    message: null,
  };
  const { ctx, labels } = context();
  assert.deepEqual(presenter.render(ctx, frame, 1600, 900), ['marker']);
  shouldThrow = true;
  assert.deepEqual(presenter.render(ctx, frame, 1600, 900), []);
  assert.deepEqual(presenter.render(ctx, frame, 1600, 900), []);
  presenter.dispose();
  assert.equal(disposed, 1);
  assert.equal(created, 1);
  assert.ok(labels.some((text) => text.includes('paint failed')));
});

void test('runtime acknowledges only known measurement markers once per round', async (t) => {
  const { runtime, receive, sent } = display(t);
  receive('snapshot', wire(await snapshot()));
  runtime.screenPort.advanceFrame();
  runtime.screenPort.presented('other-round', ['marker']);
  runtime.screenPort.presented('round-a', ['unknown', 'marker']);
  runtime.screenPort.presented('round-a', ['marker']);
  assert.deepEqual(
    sent.filter((message) => message.type === 'presented'),
    [{ type: 'presented', roundId: 'round-a', eventId: 'marker', at: 1000 }],
  );
});

void test('live cues honor explicit clocks, known sounds and round scope without replaying snapshot history', async (t) => {
  const { runtime, receive, at } = display(t);
  const frequencies: number[] = [];
  class Audio {
    state = 'running';
    currentTime = 0;
    destination = {};
    resume() {
      return Promise.resolve();
    }
    close() {
      return Promise.resolve();
    }
    createOscillator() {
      const frequency = { value: 0 };
      return {
        frequency,
        connect() {},
        start() {
          frequencies.push(frequency.value);
        },
        stop() {},
      };
    }
    createGain() {
      return {
        gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} },
        connect() {},
      };
    }
  }
  install(t, 'AudioContext', Audio);
  await runtime.unlock();
  receive('ctrl', { type: 'phase', phase: 'running', roundId: 'round-a' });
  receive('snapshot', wire(await snapshot()));
  runtime.screenPort.advanceFrame();
  assert.deepEqual(
    frequencies,
    [],
    'hydrated snapshot events never replay audio',
  );
  const event = {
    roundId: 'round-a',
    id: 'authority-hit',
    kind: 'hit',
    time: 980,
    clock: 'authority',
  };
  receive('events', { type: 'event', event });
  receive('events', { type: 'event', event });
  receive('events', {
    type: 'event',
    event: {
      ...event,
      id: 'presentation-prompt',
      kind: 'prompt',
      clock: 'presentation',
    },
  });
  receive('events', {
    type: 'event',
    event: { ...event, id: 'unknown', kind: 'future-sound' },
  });
  runtime.screenPort.advanceFrame();
  assert.deepEqual(frequencies, [680]);
  at(1100);
  runtime.screenPort.advanceFrame();
  assert.deepEqual(frequencies, [680, 420]);
  receive('events', {
    type: 'event',
    event: {
      ...event,
      id: 'queued-end',
      kind: 'end',
      time: 1500,
      clock: 'presentation',
    },
  });
  receive('ctrl', { type: 'phase', phase: 'loading', roundId: null });
  receive('events', {
    type: 'event',
    event: { ...event, id: 'late-old-round', time: 1100 },
  });
  runtime.screenPort.advanceFrame();
  assert.deepEqual(frequencies, [680, 420]);
  const next = await snapshot();
  next.roundId = 'round-b';
  receive('ctrl', { type: 'phase', phase: 'running', roundId: next.roundId });
  receive('snapshot', wire(next, 2));
  at(1700);
  runtime.screenPort.advanceFrame();
  assert.deepEqual(
    frequencies,
    [680, 420],
    'a replaced round cancels its queued end cue',
  );
});

void test('host loss retains hydrated progress and legacy result statistics for reports while clearing cues', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { runtime, receive } = display(t);
  const state = await snapshot();
  const progress: Progress = {
    revision: 2,
    totals: { a: 0 },
    rounds: [
      {
        roundId: 'finished',
        gameId: 'neon-harvest',
        mode: 'standard',
        players: state.players,
        status: 'completed',
        outcomes: [
          {
            playerId: 'a',
            placement: 1,
            score: 900,
            stats: { reactionMs: 100 },
          },
        ],
        awards: { a: 0 },
      },
    ],
  };
  for (const batch of historyMessages(progress)) receive('ctrl', batch);
  assert.equal(runtime.view.progress.revision, 2);
  assert.deepEqual(runtime.view.history[0].results[0].stats, {
    reactionMs: 100,
  });
  runtime.network.onEnded('The host screen disconnected.');
  assert.equal(runtime.screenPort.advanceFrame().status, 'ended');
  assert.equal(runtime.view.progress.rounds.length, 1);
  let report: Blob | null = null;
  t.mock.method(URL, 'createObjectURL', (blob: Blob) => {
    report = blob;
    return 'blob:report';
  });
  runtime.exportSummary();
  const exported = JSON.parse(await (report as unknown as Blob).text());
  assert.equal(exported.progress.revision, 2);
  assert.deepEqual(exported.completed[0].results[0].stats, { reactionMs: 100 });
});

void test('snapshot timeline refuses malformed and conflicting duplicate envelopes without replacing display history', async () => {
  const buffer = new SnapshotTimeline(catalogSnapshotPolicy(games));
  const state = await snapshot();
  const initial = { id: 1, time: 800, base: null, patch: state };
  assert.equal(buffer.receive(initial), true);
  assert.equal(buffer.receive({ ...initial, time: Infinity }), false);
  assert.equal(
    buffer.receive({ ...initial, patch: { ...state, roundId: 'replacement' } }),
    false,
  );
  assert.equal(buffer.sample(900)?.roundId, 'round-a');
});

void test('reliable completion does not advance sampled results or awards and new rounds hide the old display', async (t) => {
  const { runtime, receive, at } = display(t);
  const running = await snapshot();
  receive('ctrl', {
    type: 'phase',
    phase: 'running',
    roundId: running.roundId,
  });
  receive('snapshot', wire(running));
  const results = {
    ...structuredClone(running),
    phase: 'results' as const,
    outcomes: [{ playerId: 'a', placement: 1, score: 3 }],
    progress: { revision: 3, totals: { a: 4 }, awards: { a: 1 } },
  };
  receive('ctrl', {
    type: 'phase',
    phase: 'results',
    roundId: running.roundId,
  });
  receive('snapshot', {
    type: 'snapshot',
    delay: 100,
    snapshot: { id: 2, time: 1000, base: null, patch: results },
  });
  assert.equal(runtime.screenPort.advanceFrame().snapshot?.phase, 'running');
  assert.equal(runtime.view.state?.progress.totals.a, 0);
  const presenter = createPresenter(games);
  const { ctx, labels } = context();
  presenter.render(ctx, runtime.screenPort.advanceFrame(), 1600, 900);
  assert.equal(
    labels.some((text) => text.includes('session points')),
    false,
  );
  at(1100);
  presenter.render(ctx, runtime.screenPort.advanceFrame(), 1600, 900);
  assert.ok(
    labels.some((text) => text.includes('+1 session points · 4 total')),
  );
  presenter.dispose();
  assert.equal(runtime.screenPort.advanceFrame().snapshot?.phase, 'results');
  assert.equal(runtime.view.state?.progress.totals.a, 4);
  receive('ctrl', { type: 'phase', phase: 'loading', roundId: null });
  assert.equal(runtime.screenPort.advanceFrame().snapshot, null);
  receive('ctrl', { type: 'phase', phase: 'aborted', roundId: null });
  assert.equal(runtime.screenPort.advanceFrame().status, 'aborted');
  assert.equal(runtime.screenPort.advanceFrame().snapshot, null);
  receive('ctrl', { type: 'phase', phase: 'countdown', roundId: 'round-b' });
  assert.equal(runtime.screenPort.advanceFrame().snapshot, null);
  runtime.screenPort.presented(running.roundId, ['marker']);
});

void test('an accepted reconnect can replace a resync request lost on the previous connection', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { runtime, receive, sent } = display(t);
  const missingBase = {
    type: 'snapshot',
    snapshot: { id: 2, time: 900, base: 1, patch: {} },
  };
  receive('snapshot', missingBase);
  receive('snapshot', missingBase);
  assert.equal(sent.filter((message) => message.type === 'resync').length, 1);
  install(t, 'localStorage', { setItem() {} });
  // The old request was lost as signaling closed; the authority still sends deltas.
  runtime.network.onStatus('Reconnecting…');
  runtime.network.onWelcome({ ...runtime.view.identity! });
  receive('snapshot', missingBase);
  receive('snapshot', missingBase);
  assert.equal(
    sent.filter((message) => message.type === 'resync').length,
    2,
    'one new request is admitted on the accepted connection',
  );
  receive('snapshot', wire(await snapshot(), 3));
  assert.equal(runtime.screenPort.advanceFrame().snapshot?.roundId, 'round-a');
});

void test('retained runtime callbacks cannot revive playback after close or host loss', async (t) => {
  const { runtime, receive, sent } = display(t);
  const state = await snapshot();
  receive('snapshot', wire(state));
  runtime.screenPort.advanceFrame();
  runtime.network.onEnded('Host ended');
  runtime.close();
  const before = structuredClone(sent);
  const metrics = runtime.snapshotMetrics();
  receive('snapshot', wire(state, 2));
  receive('snapshot', { type: 'snapshot', snapshot: null });
  receive('ctrl', { type: 'phase', phase: 'running', roundId: 'late' });
  receive('events', {
    type: 'event',
    event: {
      id: 'late',
      roundId: state.roundId,
      kind: 'hit',
      clock: 'authority',
      time: 1000,
    },
  });
  runtime.screenPort.presented(state.roundId, ['marker']);
  assert.equal(runtime.screenPort.advanceFrame().status, 'ended');
  assert.deepEqual(sent, before);
  assert.deepEqual(runtime.snapshotMetrics(), metrics);
});

void test('the lobby shows each phone cursor with its name before a round, and only then', () => {
  const presenter = createPresenter(games);
  const { ctx, labels } = context();
  const frame = (status: ScreenFrame['status']) => ({
    snapshot: null,
    presentationTime: 1000,
    delay: 0,
    localCursors: { ada: { x: 0.3, y: 0.4 }, ghost: { x: 0.5, y: 0.5 } },
    localPlayers: { ada: { name: 'Ada', color: '#ff6b6b' } },
    status,
    message: null,
  });
  presenter.render(ctx, frame('waiting'), 1600, 900);
  assert.ok(labels.includes('Connect your phones. Pick a game below.'));
  assert.ok(labels.includes('Ada'), 'a known cursor is named');
  assert.equal(
    labels.length,
    3,
    'message, hint and one cursor; unknown ids skipped',
  );
  labels.length = 0;
  presenter.render(ctx, frame('loading'), 1600, 900);
  assert.deepEqual(labels, ['Preparing round…']);
  presenter.dispose();
});
