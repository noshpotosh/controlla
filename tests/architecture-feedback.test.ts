import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import type {
  GameDescriptor,
  GameInput,
  PlayerFeedback,
} from '../src/client/api/index.ts';
import {
  validFeedback,
  validFeedbackMessage,
  type FeedbackMessage,
} from '../src/client/engine/feedback.ts';
import { RoundRunner } from '../src/client/engine/round.ts';
import { SessionProgress } from '../src/client/engine/progress.ts';
import { SessionAuthority } from '../src/client/engine/session.ts';
import { encodeInput } from '../src/client/engine/protocol.ts';
import {
  GameHarness,
  simulatedPlayers,
} from '../src/client/devtools/game-harness/harness.ts';
import { games } from '../src/client/minigames/catalog.ts';
import { buttonProbe } from './fixtures/games.ts';
import type { ControllerConfig } from '../src/client/controls/api.ts';
const players = structuredClone(simulatedPlayers.slice(0, 2));
function fixture() {
  let pending: readonly PlayerFeedback[] | undefined;
  const ticks: GameInput[] = [];
  const descriptor: GameDescriptor = {
    ...buttonProbe,
    id: 'feedback-turn-probe',
    timing: { kind: 'timed', durationMs: 2000 },
    presentation: { cursors: true, phoneFeedback: true },
    setup: ({ players }) =>
      players.map((p, i) => ({
        playerId: p.id,
        role: i ? 'follower' : 'leader',
        controls: buttonProbe.controls,
      })),
    create(options) {
      const game = buttonProbe.create(options);
      return {
        ...game,
        tick(input) {
          ticks.push(structuredClone(input));
          const result = {
            ...game.tick(input),
            ...(pending === undefined ? {} : { feedback: pending }),
          };
          pending = undefined;
          return result;
        },
      };
    },
  };
  return {
    descriptor,
    ticks,
    request: (feedback: readonly PlayerFeedback[]) => {
      pending = feedback;
    },
  };
}
function room(t: TestContext, f: ReturnType<typeof fixture>) {
  (games as GameDescriptor[]).push(f.descriptor);
  t.after(() =>
    (games as GameDescriptor[]).splice(games.indexOf(f.descriptor), 1),
  );
  let time = 0;
  const messages: { id: string; at: number; message: FeedbackMessage }[] = [];
  const configs: Record<string, ControllerConfig> = {};
  const phases: string[] = [];
  const authority = new SessionAuthority(
    'host',
    {
      toPlayer(id, msg) {
        if (msg.type === 'config') configs[id] = msg.config;
        if (msg.type === 'feedback')
          messages.push({
            id,
            message: structuredClone(msg) as FeedbackMessage,
            at: time,
          });
      },
      toVenue(_id, msg) {
        if (msg.type === 'phase') phases.push(msg.phase);
      },
      snapshot() {},
      event() {},
      warning() {},
    },
    { seed: () => 42, now: () => time },
  );
  t.after(() => authority.dispose());
  const roster = {
    players: structuredClone(players),
    venues: [{ id: 'host', name: 'Host', connected: true }],
  };
  authority.setRoster(roster);
  authority.start(f.descriptor.id, 'standard');
  const ready = (id: string, generation = configs[id].generation) =>
    authority.control(id, { type: 'ready', generation });
  ready('ada');
  ready('bea');
  authority.tick();
  const at = (next: number) => {
    time = next;
    authority.tick();
  };
  const press = (id: string, capture = time, counter = 1) =>
    authority.control(id, {
      type: 'press',
      press: {
        playerId: 'spoof',
        generation: configs[id].generation,
        button: 0,
        counter,
        time: capture,
        x: 0.5,
        y: 0.5,
      },
    });
  const widget = (id: string, capture = time) =>
    authority.control(id, {
      type: 'widget',
      generation: configs[id].generation,
      action: 'aim',
      seq: time,
      time: capture,
      value: { x: 0.3, y: 0.4 },
    });
  const frame = (capture = time, seq = time, edge = 1) =>
    authority.input(
      'ada',
      encodeInput({
        generation: configs.ada.generation,
        seq,
        time: capture,
        x: 0.3,
        y: 0.4,
        vx: 0,
        vy: 0,
        confidence: 1,
        buttons: 1,
        edges: [edge, 0, 0, 0],
        edgeTimes: [capture, 0, 0, 0],
      }),
    );
  return {
    authority,
    configs,
    messages,
    phases,
    roster,
    ready,
    at,
    press,
    widget,
    frame,
  };
}
void test('feedback bounds use Unicode code points and reject unknown or repeated participants', () => {
  const valid = {
    playerId: 'ada',
    status: '😀'.repeat(120),
    enabled: false,
    hapticMs: 100,
  };
  assert.equal(validFeedback([valid], players), true);
  for (const value of [
    null,
    {},
    [valid, valid],
    [{ ...valid, playerId: 'other' }],
    [{ ...valid, status: '😀'.repeat(121) }],
    [{ ...valid, status: null }],
    [{ ...valid, enabled: 0 }],
    ...[0, -1, 101, 0.5, Infinity, '10'].map((hapticMs) => [
      { ...valid, hapticMs },
    ]),
  ])
    assert.equal(validFeedback(value, players), false);
  const envelope = {
    type: 'feedback',
    roundId: 'round',
    generation: 1,
    revision: 1,
    status: '',
    enabled: true,
  };
  assert.equal(validFeedbackMessage(envelope), true);
  for (const patch of [
    { generation: -1 },
    { generation: 65536 },
    { revision: 0 },
    { revision: 1.5 },
    { roundId: '' },
    { enabled: null },
    { hapticMs: 101 },
  ])
    assert.equal(validFeedbackMessage({ ...envelope, ...patch }), false);
});
void test('turn feedback disables held/new input but preserves accepted actions; reenable rejects old captures', async () => {
  const f = fixture(),
    harness = new GameHarness(f.descriptor, { players, seed: 42 });
  await harness.load();
  harness.advance(3050);
  harness.setValue('ada', 'aim', { x: 0.1, y: 0.2 });
  harness.press('ada', 'fire');
  f.request([
    {
      playerId: 'ada',
      status: 'Wait for your turn',
      enabled: false,
      hapticMs: 10,
    },
  ]);
  harness.advance(50);
  harness.press('ada', 'fire');
  harness.setValue('ada', 'aim', { x: 0.4, y: 0.3 });
  harness.advance(250);
  assert.equal(f.ticks.flatMap((tick) => tick.actions).length, 1);
  assert.equal(f.ticks.at(-1)!.values.ada, undefined);
  f.request([{ playerId: 'ada', status: 'Your turn', enabled: true }]);
  harness.advance(20);
  harness.press('ada', 'fire');
  harness.advance(220);
  assert.equal(f.ticks.flatMap((tick) => tick.actions).length, 2);
  harness.dispose();
  const runner = new RoundRunner(f.descriptor, new SessionProgress());
  runner.prepare(players, 42);
  await runner.load();
  runner.begin(players, 0);
  f.request([{ playerId: 'ada', enabled: false }]);
  runner.tick(3100, 20, {}, 0);
  f.request([{ playerId: 'ada', enabled: true }]);
  runner.tick(3200, 20, {}, 0);
  assert.equal(
    runner.input(
      { playerId: 'ada', name: 'fire', time: 3150, aim: { x: 0, y: 0 } },
      3200,
    ),
    false,
  );
  assert.equal(
    runner.input(
      { playerId: 'ada', name: 'fire', time: 3200, aim: { x: 0, y: 0 } },
      3200,
    ),
    true,
  );
  runner.abort();
  assert.deepEqual(runner.takeFeedback(), []);
});
void test('invalid or undeclared game feedback fails without delivering state or awarding points', async () => {
  for (const declared of [true, false]) {
    const f = fixture();
    f.descriptor.presentation.phoneFeedback = declared;
    const progress = new SessionProgress(),
      runner = new RoundRunner(f.descriptor, progress);
    runner.prepare(players, 42);
    await runner.load();
    runner.begin(players, 0);
    f.request([
      { playerId: 'ada', status: declared ? 'x'.repeat(121) : 'undeclared' },
    ]);
    runner.tick(3100, 20, {}, 0);
    assert.equal(runner.phase, 'error');
    assert.deepEqual(runner.takeFeedback(), []);
    assert.equal(
      progress.view().rounds.filter((r) => r.status === 'completed').length,
      0,
    );
    runner.dispose();
  }
});
void test('authority coalesces status, drops excess pulses and blocks all disabled ingress', (t) => {
  const f = fixture(),
    r = room(t, f);
  f.request([
    { playerId: 'ada', status: 'Wait', enabled: false, hapticMs: 100 },
  ]);
  r.at(3100);
  const first = r.messages.filter((m) => m.id === 'ada').at(-1)!.message;
  assert.equal(first.hapticMs, 100);
  assert.equal(first.enabled, false);
  r.press('ada');
  r.widget('ada');
  r.frame();
  r.press('bea');
  f.request([{ playerId: 'ada', status: 'Latest', hapticMs: 50 }]);
  r.at(3120);
  assert.equal(
    r.messages.filter((m) => m.id === 'ada').at(-1)!.message.revision,
    first.revision,
  );
  r.at(3200);
  const latest = r.messages.filter((m) => m.id === 'ada').at(-1)!.message;
  assert.equal(latest.status, 'Latest');
  assert.equal(latest.enabled, false);
  assert.equal(latest.hapticMs, undefined);
  assert.equal(latest.revision, first.revision + 1);
  r.at(3320);
  assert.deepEqual(
    f.ticks.flatMap((tick) => tick.actions).map((a) => a.playerId),
    ['bea'],
  );
  assert.equal(f.ticks.at(-1)!.values.ada, undefined);
  f.request([{ playerId: 'ada', status: 'Your turn', enabled: true }]);
  r.at(3400);
  r.frame(3150, 3401);
  r.widget('ada', 3150);
  r.press('ada', 3150);
  r.at(3500);
  r.frame(3500, 3500);
  r.press('ada', 3500, 2);
  r.at(3720);
  assert.equal(
    f.ticks.flatMap((tick) => tick.actions).filter((a) => a.playerId === 'ada')
      .length,
    1,
  );
  assert.equal(
    r.messages.filter((m) => m.id === 'bea').length,
    1,
    'another player receives no targeted state',
  );
  for (const id of ['ada', 'bea']) {
    const updates = r.messages.filter((m) => m.id === id);
    assert.ok(
      updates.every(
        (m, i) =>
          i === 0 || m.message.revision > updates[i - 1].message.revision,
      ),
    );
  }
});
void test('reconnect waits for current ACK and restores state without replaying haptics', (t) => {
  const f = fixture(),
    r = room(t, f);
  f.request([
    { playerId: 'ada', status: 'Wait', enabled: false, hapticMs: 80 },
  ]);
  r.at(3100);
  const before = r.messages.filter((m) => m.id === 'ada').at(-1)!.message;
  const old = r.configs.ada.generation;
  r.roster.players[0].connected = false;
  r.authority.setRoster(r.roster);
  f.request([{ playerId: 'ada', status: 'Still waiting', hapticMs: 30 }]);
  r.at(3220);
  r.roster.players[0].connected = true;
  r.authority.setRoster(r.roster);
  r.ready('ada', old);
  r.at(3240);
  assert.equal(
    r.messages.filter((m) => m.id === 'ada').at(-1)!.message.revision,
    before.revision,
  );
  r.ready('ada');
  const restored = r.messages.filter((m) => m.id === 'ada').at(-1)!.message;
  assert.equal(restored.roundId, before.roundId);
  assert.equal(restored.generation, r.configs.ada.generation);
  assert.ok(restored.revision > before.revision);
  assert.equal(restored.status, 'Still waiting');
  assert.equal(restored.enabled, false);
  assert.equal(restored.hapticMs, undefined);
  r.authority.abort();
  const count = r.messages.length;
  r.ready('ada');
  r.at(3400);
  assert.equal(r.messages.length, count);
  r.authority.start(f.descriptor.id, 'standard');
  r.ready('ada');
  r.ready('bea');
  r.at(3420);
  const next = r.messages.filter((m) => m.id === 'ada').at(-1)!.message;
  assert.notEqual(next.roundId, before.roundId);
  assert.equal(next.revision, 1);
  assert.equal(next.enabled, true);
  assert.equal(next.status, '');
  assert.equal(next.hapticMs, undefined);
});

void test('feedback storms remain at ten updates and pulses per player per second', (t) => {
  const f = fixture(),
    r = room(t, f);
  for (let at = 3100; at < 4100; at += 20) {
    f.request([{ playerId: 'ada', status: String(at), hapticMs: 10 }]);
    r.at(at);
  }
  const updates = r.messages.filter((m) => m.id === 'ada' && m.at >= 3100);
  assert.equal(updates.length, 10);
  assert.equal(
    updates.filter((m) => m.message.hapticMs !== undefined).length,
    10,
  );
  assert.ok(updates.slice(1).every((m, i) => m.at - updates[i].at >= 100));
  r.at(4100);
  const last = r.messages.filter((m) => m.id === 'ada').at(-1)!.message;
  assert.equal(last.status, '4080');
  assert.equal(
    last.hapticMs,
    undefined,
    'a pulse dropped by the limit is never replayed',
  );
});

void test('invalid injected authority clocks fail before any configuration or feedback delivery', () => {
  let sends = 0;
  const ports = {
    toPlayer() {
      sends++;
    },
    toVenue() {},
    snapshot() {},
    event() {},
    warning() {},
  };
  for (const value of [NaN, Infinity, -1])
    assert.throws(
      () => new SessionAuthority('host', ports, { now: () => value }),
      /authority clock/,
    );
  assert.equal(sends, 0);
});
