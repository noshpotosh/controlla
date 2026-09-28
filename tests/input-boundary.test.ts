import {
  pointerSpec,
  steeringSpec,
  buttonProbe,
  steeringProbe,
} from './fixtures/games.ts';
import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { Runtime } from '../src/client/runtime.ts';
import { Network } from '../src/client/network.ts';
import {
  APP_PROTOCOL_VERSION,
  PROTOCOL_MISMATCH,
} from '../src/shared/app-protocol.ts';
import { SessionAuthority } from '../src/client/engine/session.ts';
import { games, findGame } from '../src/client/minigames/catalog.ts';
import type { GameInput, GameDescriptor } from '../src/client/api/index.ts';
import {
  defaultCapabilities,
  resolveConfig,
} from '../src/client/controls/resolve.ts';
import {
  decodeInput,
  encodeInput,
  INPUT_BYTES,
} from '../src/client/engine/protocol.ts';
import {
  parseControlValue,
  valueFitsEnvelope,
} from '../src/client/controls/value.ts';
import type { ControllerConfig } from '../src/client/controls/api.ts';
import type { InputFrame } from '../src/client/engine/protocol.ts';
import type { Message } from '../src/client/engine/messages.ts';
import type { Press } from '../src/client/engine/reliable-input.ts';
import type { Identity, Player } from '../src/shared/room.ts';

function globals(t: TestContext, values: Record<string, unknown>) {
  for (const [key, value] of Object.entries(values)) {
    const old = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, {
      configurable: true,
      writable: true,
      value,
    });
    t.after(() => {
      if (old) Object.defineProperty(globalThis, key, old);
      else Reflect.deleteProperty(globalThis, key);
    });
  }
}

function phone(
  t: TestContext,
  config = resolveConfig(steeringSpec, defaultCapabilities(), 3),
) {
  let clock = 1000;
  t.mock.method(performance, 'now', () => clock);
  t.after(() => runtime.close());
  globals(t, {
    document: Object.assign(new EventTarget(), { hidden: false }),
    window: Object.assign(new EventTarget(), { devicePixelRatio: 1 }),
    navigator: { maxTouchPoints: 1 },
    innerWidth: 800,
    innerHeight: 600,
  });
  const runtime = new Runtime({
    role: 'controller',
    endpoint: 'ws://unused/signal',
  });
  runtime.view.identity = {
    id: 'a',
    role: 'controller',
    hostId: 'host',
    venueId: 'host',
    room: 'ABCD',
    token: 'test',
  };
  runtime.network.onWelcome(runtime.view.identity);
  runtime.view.status = 'Connected';
  Reflect.get(runtime, 'controllerMessage').call(runtime, {
    type: 'config',
    config: config,
  });
  const sent: Message[] = [];
  t.mock.method(
    runtime.network,
    'send',
    (_id: string, channel: string, data: unknown) => {
      if (channel === 'ctrl' && (data as Message).type !== 'clock')
        sent.push(data as Message);
    },
  );
  return {
    runtime,
    sent,
    at: (time: number) => {
      clock = time;
    },
  };
}

const players: Player[] = ['a', 'b'].map((id, seat) => ({
  id,
  seat,
  name: id,
  venueId: 'host',
  connected: true,
  color: 'blue',
}));

function authority(t: TestContext, gameId = buttonProbe.id) {
  let clock = 0;
  t.mock.method(performance, 'now', () => clock);
  const configs: Record<string, ControllerConfig> = {};
  let descriptor = findGame(gameId);
  if (!descriptor) {
    descriptor = gameId === steeringProbe.id ? steeringProbe : buttonProbe;
    (games as GameDescriptor[]).push(descriptor);
    const inserted = descriptor;
    t.after(() =>
      (games as GameDescriptor[]).splice(games.indexOf(inserted), 1),
    );
  }
  const create = descriptor.create.bind(descriptor);
  const frames = t.mock.fn((_input: GameInput) => {});
  t.mock.method(descriptor, 'create', (options?: { mode: string }) => {
    const game = create(options);
    const tick = game.tick.bind(game);
    game.tick = (input) => {
      frames(input);
      return tick(input);
    };
    return game;
  });
  const session = new SessionAuthority('host', {
    toPlayer: (id, msg) => {
      if (msg.type === 'config') configs[id] = msg.config;
    },
    toVenue() {},
    snapshot() {},
    event() {},
    warning() {},
  });
  const roster = {
    players: structuredClone(players),
    venues: [{ id: 'host', name: 'Host', connected: true }],
  };
  session.setRoster(roster);
  session.start(gameId, descriptor.defaultMode);
  for (const p of players)
    session.control(p.id, {
      type: 'ready',
      generation: configs[p.id].generation,
    });
  session.tick();
  clock = 4000;
  session.tick();
  let sequence = 0;
  const frame = (change: Partial<InputFrame> = {}): InputFrame => ({
    seq: ++sequence,
    time: clock,
    generation: configs.a.generation,
    x: 0.5,
    y: 0.5,
    vx: 0,
    vy: 0,
    buttons: 0,
    edges: [0, 0, 0, 0],
    edgeTimes: [0, 0, 0, 0],
    confidence: 1,
    ...change,
  });
  return {
    session,
    configs,
    frames,
    roster,
    frame,
    at: (time: number) => {
      clock = time;
    },
  };
}

void test('output validators preserve supported values and reject malformed or noncloneable payloads', () => {
  assert.deepEqual(parseControlValue('pointer', { x: -0.4, y: 1.3 }), {
    x: -0.4,
    y: 1.3,
  });
  assert.deepEqual(
    parseControlValue('stick', { x: 0.2, y: -1, ignored: true }),
    { x: 0.2, y: -1 },
  );
  assert.equal(parseControlValue('dpad', { x: 0.2, y: 0 }), undefined);
  assert.equal(parseControlValue('stick', { x: Infinity, y: 0 }), undefined);
  assert.equal(parseControlValue('button', 1), undefined);
  assert.equal(
    parseControlValue('hold-meter', { charge: 2, released: true }),
    undefined,
  );
  assert.equal(
    parseControlValue('swipe-pad', {
      dir: 'up',
      x: 0,
      y: -1,
      distance: 1,
      velocity: NaN,
    }),
    undefined,
  );
  assert.equal(parseControlValue('text', 'x'.repeat(121)), undefined);
  assert.equal(parseControlValue('slider', -1), undefined);
  assert.equal(parseControlValue('dial', 100 * Math.PI), 100 * Math.PI);
  assert.deepEqual(
    parseControlValue('draw-canvas', {
      x: 0.2,
      y: 0.3,
      pressure: 0.5,
      phase: 'move',
    }),
    { x: 0.2, y: 0.3, pressure: 0.5, phase: 'move' },
  );
  assert.equal(
    parseControlValue('draw-canvas', {
      x: 0.2,
      y: 0.3,
      pressure: -1,
      phase: 'move',
    }),
    undefined,
  );
  const cyclic: Record<string, unknown> = {};
  cyclic.self = cyclic;
  assert.equal(valueFitsEnvelope(cyclic), false);
  assert.equal(valueFitsEnvelope({ x: 0, fn() {} }), false);
  assert.equal(valueFitsEnvelope('x'.repeat(4096)), false);
  assert.equal(
    parseControlValue('stick', {
      get x() {
        throw new Error('untrusted');
      },
      y: 0,
    }),
    undefined,
  );
});

void test('runtime captures sample time, sequence and detached values before a trailing throttle flush', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { runtime, sent, at } = phone(t);
  const value = { x: 0.25, y: 0.5 };
  runtime.action('steer', { x: 0, y: 0 });
  at(1005);
  runtime.action('steer', value);
  value.x = 99;
  at(1030);
  t.mock.timers.tick(30);
  const samples = sent.filter((msg) => msg.type === 'widget');
  assert.equal(samples.length, 2);
  assert.equal(samples[1].time, 1005);
  assert.equal(samples[1].generation, 3);
  assert.equal(samples[1].seq, 1);
  assert.deepEqual(samples[1].value, { x: 0.25, y: 0.5 });
  assert.equal(INPUT_BYTES, 47);
});

void test('reconfiguration clears pending values and old view callbacks cannot affect a new epoch', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { runtime, sent, at } = phone(t);
  const config = runtime.view.config!;
  const old = runtime.portFor(config.widgets[0], config.generation);
  old.value({ x: 0.5, y: 0 });
  at(1005);
  old.value({ x: 0.9, y: 0 });
  runtime.network.onMessage('host', 'ctrl', {
    type: 'config',
    config: { ...config, generation: 4 },
  });
  sent.length = 0;
  old.value({ x: 0, y: 0 });
  old.press(true);
  at(1040);
  t.mock.timers.tick(40);
  assert.equal(sent.length, 0);
  runtime.portFor(config.widgets[0], 4).value({ x: -0.5, y: 0 });
  assert.equal(sent[0].generation, 4);
  assert.equal(sent[0].seq, 0);
});

void test('two value-bearing presses retain separate atomic payloads after later values and releases', (t) => {
  const { runtime, sent, at } = phone(t);
  const swipe = { dir: 'left', x: -0.7, y: 0, distance: 0.7, velocity: 2 };
  runtime.action('boost', swipe);
  runtime.press('boost', true);
  runtime.press('boost', false);
  swipe.x = 99;
  at(1010);
  runtime.action('boost', {
    dir: 'right',
    x: 0.3,
    y: 0,
    distance: 0.3,
    velocity: 1,
  });
  runtime.press('boost', true);
  runtime.press('boost', false);
  const presses = sent.filter((msg) => msg.type === 'press');
  assert.equal(presses.length, 2);
  assert.equal(presses[0].press.value.x, -0.7);
  assert.equal(presses[1].press.value.x, 0.3);
  assert.notEqual(presses[0].press.counter, presses[1].press.counter);
});

void test('suspension retires retained view ports without restarting same-generation sequences', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const { runtime, sent, at } = phone(t);
  t.mock.method(runtime.network, 'connect', () => {});
  runtime.start();
  const config = runtime.view.config!;
  const old = runtime.portFor(config.widgets[0], config.generation);
  old.value({ x: 0.2, y: 0.1 });
  const firstEpoch = runtime.view.inputEpoch;
  Object.defineProperty(document, 'hidden', {
    configurable: true,
    value: true,
  });
  document.dispatchEvent(new Event('visibilitychange'));
  Object.defineProperty(document, 'hidden', {
    configurable: true,
    value: false,
  });
  document.dispatchEvent(new Event('visibilitychange'));
  sent.length = 0;
  assert.ok(runtime.view.inputEpoch > firstEpoch);
  old.value({ x: 0.9, y: 0.9 });
  assert.equal(sent.length, 0);
  const frames: InputFrame[] = [];
  t.mock.method(
    runtime.network,
    'send',
    (_peer: string, channel: string, data: unknown) => {
      if (channel === 'ctrl' && (data as Message).type !== 'clock')
        sent.push(data as Message);
      if (channel === 'input')
        frames.push(decodeInput(data as ArrayBuffer, 1000));
    },
  );
  (runtime as unknown as { tick(): void }).tick();
  assert.equal(frames.length, 1);
  assert.equal(
    frames[0].x,
    0,
    'a retired stick cannot remain held after resume',
  );
  assert.equal(frames[0].y, 0);
  at(1100);
  runtime
    .portFor(config.widgets[0], config.generation)
    .value({ x: 0.3, y: 0.4 });
  assert.equal(sent[0].seq, 1);
  runtime.view.status = 'Reconnecting…';
  runtime.action('steer', { x: 1, y: 1 });
  assert.equal(sent.length, 1);
});

void test('hold releases carry their own charge and cancellation creates no activation', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const spec = {
    ...pointerSpec,
    controller: undefined,
    inputs: { charge: { required: true, prefer: 'hold-meter' as const } },
  };
  const { runtime, sent, at } = phone(
    t,
    resolveConfig(spec, defaultCapabilities(), 8),
  );
  runtime.action('charge', { charge: 0.4, released: false });
  runtime.press('charge', true);
  assert.equal(sent.filter((msg) => msg.type === 'press').length, 0);
  at(1005);
  runtime.action('charge', { charge: 0.6, released: true });
  runtime.press('charge', true);
  runtime.press('charge', false);
  at(1010);
  runtime.action('charge', { charge: 0, released: false });
  assert.deepEqual(sent.find((msg) => msg.type === 'press')?.press.value, {
    charge: 0.6,
    released: true,
  });
  assert.equal(sent.filter((msg) => msg.type === 'press').length, 1);
});

void test('authority rejects stale, malformed and out-of-order values while retaining independent fresh vectors', (t) => {
  const fixture: GameDescriptor = {
    ...buttonProbe,
    id: 'two-vectors',
    controls: {
      inputs: {
        move: { required: true, prefer: 'stick' },
        look: { required: true, prefer: 'stick' },
      },
    },
  };
  (games as GameDescriptor[]).push(fixture);
  t.after(() => (games as GameDescriptor[]).splice(games.indexOf(fixture), 1));
  const { session, configs, frames, frame, at } = authority(t, fixture.id);
  const sample = {
    type: 'widget',
    generation: configs.a.generation,
    action: 'move',
    seq: 2,
    time: 4000,
    value: { x: 0.2, y: 0.4 },
  };
  session.control('a', sample);
  session.control('a', {
    ...sample,
    action: 'look',
    seq: 0,
    value: { x: -0.8, y: 0.7 },
  });
  for (const change of [
    { seq: 1 },
    { seq: 2 },
    { seq: 3, generation: configs.a.generation - 1 },
    { seq: 3, time: 1999 },
    { seq: 3, time: 4101 },
    { seq: -1 },
    { seq: 3, value: { x: Infinity, y: 0 } },
    { seq: 3, action: 'missing' },
  ])
    session.control('a', { ...sample, value: { x: 1, y: 1 }, ...change });
  const cycle: Record<string, unknown> = {};
  cycle.self = cycle;
  assert.doesNotThrow(() =>
    session.control('a', { ...sample, seq: 3, value: cycle }),
  );
  sample.value.x = 99;
  at(4040);
  session.input('a', encodeInput(frame()));
  session.tick();
  assert.deepEqual(frames.mock.calls.at(-1)?.arguments[0].values.a, {
    move: { value: { x: 0.2, y: 0.4 }, time: 4000, observedAt: 4040 },
    look: { value: { x: -0.8, y: 0.7 }, time: 4000, observedAt: 4040 },
  });
});

void test('value-bearing controls wait for their reliable payload when binary recovery wins the race', (t) => {
  const { session, configs, frames, frame, at } = authority(
    t,
    steeringProbe.id,
  );
  const press: Omit<Press, 'playerId'> = {
    generation: configs.a.generation,
    button: 0,
    counter: 1,
    time: 4000,
    x: 0.5,
    y: 0.5,
    value: { dir: 'left', x: -0.7, y: 0, distance: 0.7, velocity: 2 },
  };
  session.input(
    'a',
    encodeInput(frame({ edges: [1, 0, 0, 0], edgeTimes: [4000, 0, 0, 0] })),
  );
  at(4250);
  session.tick();
  assert.equal(frames.mock.calls.at(-1)?.arguments[0].actions.length, 0);
  session.control('a', { type: 'press', press });
  session.control('a', { type: 'press', press });
  press.value = { dir: 'right', x: 1, y: 0, distance: 1, velocity: 4 };
  at(4270);
  session.tick();
  assert.deepEqual(frames.mock.calls.at(-1)?.arguments[0].actions[0]?.value, {
    dir: 'left',
    x: -0.7,
    y: 0,
    distance: 0.7,
    velocity: 2,
  });
  assert.equal(frames.mock.calls.at(-1)?.arguments[0].actions.length, 1);
  at(4300);
  session.input(
    'a',
    encodeInput(frame({ edges: [1, 0, 0, 0], edgeTimes: [4000, 0, 0, 0] })),
  );
  session.tick();
  assert.equal(frames.mock.calls.at(-1)?.arguments[0].actions.length, 0);
});

void test('press-only recovery remains exactly once and invalid slots or value-bearing payloads fail closed', (t) => {
  const { session, configs, frames, frame, at } = authority(t);
  const press = {
    generation: configs.a.generation,
    button: 0,
    counter: 1,
    time: 4000,
    x: 0.5,
    y: 0.5,
  };
  session.control('a', { type: 'press', press: { ...press, button: 2 } });
  session.control('a', { type: 'press', press: { ...press, value: 1 } });
  session.input(
    'a',
    encodeInput(frame({ edges: [1, 0, 0, 0], edgeTimes: [4000, 0, 0, 0] })),
  );
  session.control('a', { type: 'press', press });
  at(4250);
  session.tick();
  assert.equal(frames.mock.calls.at(-1)?.arguments[0].actions.length, 1);
});

void test('journal-first activation keeps its payload when a newer widget value and duplicate binary edge arrive', (t) => {
  const { session, configs, frames, frame, at } = authority(
    t,
    steeringProbe.id,
  );
  const value = { dir: 'up', x: 0, y: -0.5, distance: 0.5, velocity: 1 };
  const press = {
    generation: configs.a.generation,
    button: 0,
    counter: 1,
    time: 4000,
    x: 0.5,
    y: 0.5,
    value,
  };
  session.control('a', { type: 'press', press });
  session.control('a', {
    type: 'widget',
    action: 'boost',
    generation: configs.a.generation,
    seq: 1,
    time: 4000,
    value: { dir: 'down', x: 0, y: 1, distance: 1, velocity: 3 },
  });
  value.y = 99;
  session.input(
    'a',
    encodeInput(frame({ edges: [1, 0, 0, 0], edgeTimes: [4000, 0, 0, 0] })),
  );
  at(4250);
  session.tick();
  const accepted = frames.mock.calls.at(-1)?.arguments[0].actions;
  assert.equal(accepted?.length, 1);
  assert.deepEqual(accepted?.[0].value, {
    dir: 'up',
    x: 0,
    y: -0.5,
    distance: 0.5,
    velocity: 1,
  });
});

void test('binary recovery deduplicates reliable timestamps at binary microsecond precision', (t) => {
  const { session, configs, frames, frame, at } = authority(t);
  const time = 4000.4996;
  at(4001);
  session.control('a', {
    type: 'press',
    press: {
      generation: configs.a.generation,
      button: 0,
      counter: 1,
      time,
      x: 0.5,
      y: 0.5,
    },
  });
  session.input(
    'a',
    encodeInput(frame({ edges: [1, 0, 0, 0], edgeTimes: [time, 0, 0, 0] })),
  );
  at(4250);
  session.tick();
  assert.equal(frames.mock.calls.at(-1)?.arguments[0].actions.length, 1);
});

void test('a replacement configuration must be acknowledged before current-generation input is admitted', (t) => {
  const { session, configs, frames, frame, at } = authority(t);
  const oldGeneration = configs.a.generation;
  session.control('a', { type: 'hello', bootId: 'replacement-phone' });
  assert.notEqual(configs.a.generation, oldGeneration);
  const sample = {
    type: 'widget',
    generation: configs.a.generation,
    action: 'aim',
    seq: 0,
    time: 4000,
    value: { x: 0.2, y: 0.4 },
  };
  session.control('a', sample);
  session.control('a', {
    type: 'press',
    press: {
      generation: configs.a.generation,
      button: 0,
      counter: 1,
      time: 4000,
      x: 0.5,
      y: 0.5,
    },
  });
  session.input('a', encodeInput(frame()));
  at(4250);
  session.tick();
  assert.deepEqual(frames.mock.calls.at(-1)?.arguments[0].values.a, {});
  assert.equal(frames.mock.calls.at(-1)?.arguments[0].actions.length, 0);
  session.control('a', { type: 'ready', generation: configs.a.generation });
  session.control('a', { ...sample, time: 4250 });
  session.control('a', {
    type: 'press',
    press: {
      generation: configs.a.generation,
      button: 0,
      counter: 2,
      time: 4250,
      x: 0.5,
      y: 0.5,
    },
  });
  at(4470);
  session.tick();
  assert.deepEqual(frames.mock.calls.at(-1)?.arguments[0].values.a.aim.value, {
    x: 0.6,
    y: 0.7,
  });
  assert.equal(frames.mock.calls.at(-1)?.arguments[0].actions.length, 1);
});

void test('press receipt boundaries reject pre-start and deadline arrivals independently of the next authority tick', (t) => {
  const { session, configs, frames, at } = authority(t);
  const press = {
    generation: configs.a.generation,
    button: 0,
    counter: 1,
    time: 3000,
    x: 0.5,
    y: 0.5,
  };
  at(2999);
  session.control('a', { type: 'press', press });
  at(3000);
  session.control('a', { type: 'press', press: { ...press, counter: 2 } });
  at(4250);
  session.tick();
  assert.deepEqual(
    frames.mock.calls.at(-1)?.arguments[0].actions.map((p) => p.time),
    [3000],
  );
  at(33199);
  session.control('a', {
    type: 'press',
    press: { ...press, time: 32999, counter: 3 },
  });
  at(33200);
  session.control('a', {
    type: 'press',
    press: { ...press, time: 32998, counter: 4 },
  });
  at(33300);
  session.tick();
  assert.deepEqual(
    frames.mock.calls.at(-1)?.arguments[0].actions.map((p) => p.time),
    [32999],
  );
});

void test('disconnect clears values and reconnect changes epoch before accepting new input', (t) => {
  const { session, configs, frames, frame, at, roster } = authority(t);
  const generation = configs.a.generation;
  const value = {
    type: 'widget',
    action: 'aim',
    generation,
    seq: 0,
    time: 4000,
    value: { x: 0.1, y: 0.2 },
  };
  session.control('a', value);
  roster.players[0].connected = false;
  session.setRoster(roster);
  session.control('a', { ...value, seq: 1 });
  session.control('a', {
    type: 'press',
    press: { generation, button: 0, counter: 1, time: 4000, x: 0.5, y: 0.5 },
  });
  roster.players[0].connected = true;
  session.setRoster(roster);
  assert.notEqual(configs.a.generation, generation);
  session.control('a', { type: 'ready', generation: configs.a.generation });
  session.control('a', value);
  at(4250);
  session.input('a', encodeInput(frame()));
  session.tick();
  assert.deepEqual(
    frames.mock.calls.at(-1)?.arguments[0].values.a,
    {
      aim: { value: { x: 0.5, y: 0.5 }, time: 4250 },
    },
    'only the fresh binary sample survives reconnect',
  );
  assert.deepEqual(frames.mock.calls.at(-1)?.arguments[0].actions, []);
});

class FakeSocket {
  static OPEN = 1;
  static instances: FakeSocket[] = [];
  readyState = 1;
  bufferedAmount = 0;
  sent: Message[] = [];
  closed = false;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(_url: string) {
    FakeSocket.instances.push(this);
  }
  send(json: string) {
    this.sent.push(JSON.parse(json));
  }
  close() {
    this.closed = true;
    this.onclose?.();
  }
  message(msg: Message) {
    this.onmessage?.({ data: JSON.stringify(msg) });
  }
}
const identity: Identity = {
  id: 'host',
  role: 'host',
  hostId: 'host',
  venueId: 'host',
  room: 'ABCD',
  token: 'test',
};

void test('every role announces its version and rejects mismatched welcomes before callbacks or retries', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  globals(t, { WebSocket: FakeSocket });
  for (const role of ['host', 'display', 'controller'] as const) {
    const network = new Network('ws://unused', { role });
    let welcomed = 0,
      rostered = 0;
    network.onWelcome = () => welcomed++;
    network.onRoster = () => rostered++;
    network.connect();
    const socket = FakeSocket.instances.at(-1)!;
    socket.onopen?.();
    assert.equal(socket.sent[0].protocolVersion, APP_PROTOCOL_VERSION);
    socket.message({ type: 'roster', players: [], venues: [] });
    socket.message({ type: 'welcome', identity, iceServers: [] });
    socket.message({ type: 'roster', players: [], venues: [] });
    assert.equal(welcomed, 0);
    assert.equal(rostered, 0);
    assert.equal(network.identity, null);
    assert.equal(socket.closed, true);
    const count = FakeSocket.instances.length;
    network.connect();
    t.mock.timers.tick(10000);
    assert.equal(FakeSocket.instances.length, count);
  }
});

void test('matching welcome admits traffic and resumed mismatches or superseded sockets cannot bypass it', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  globals(t, { WebSocket: FakeSocket });
  const network = new Network('ws://unused', { role: 'controller' });
  let rostered = 0;
  network.onRoster = () => rostered++;
  network.connect();
  const first = FakeSocket.instances.at(-1)!;
  first.message({
    type: 'welcome',
    protocolVersion: APP_PROTOCOL_VERSION,
    identity: { ...identity, role: 'controller' },
    iceServers: [],
  });
  first.message({ type: 'roster', players: [], venues: [] });
  assert.equal(rostered, 1);
  first.close();
  t.mock.timers.tick(500);
  const second = FakeSocket.instances.at(-1)!;
  assert.notEqual(second, first);
  first.message({
    type: 'welcome',
    protocolVersion: APP_PROTOCOL_VERSION,
    identity,
    iceServers: [],
  });
  second.message({ type: 'roster', players: [], venues: [] });
  assert.equal(rostered, 1);
  second.message({
    type: 'error',
    code: PROTOCOL_MISMATCH,
    message: 'old app',
  });
  assert.equal(network.identity, null);
  const count = FakeSocket.instances.length;
  t.mock.timers.tick(10000);
  assert.equal(FakeSocket.instances.length, count);
});

void test('Neon aim pad preserves square corners, sample times and held aim through binary heartbeat', (t) => {
  const { session, configs, frames, frame, at } = authority(t, 'neon-harvest');
  t.after(() => session.dispose());
  assert.equal(
    configs.a.widgets.find((w) => w.action === 'aim')!.type,
    'aim-pad',
  );
  let seq = 0;
  for (const point of [
    { x: -1, y: -1 },
    { x: 1, y: -1 },
    { x: -1, y: 1 },
    { x: 1, y: 1 },
  ]) {
    const time = 4100 + seq * 40;
    at(time);
    session.control('a', {
      type: 'widget',
      generation: configs.a.generation,
      action: 'aim',
      seq: seq++,
      time,
      value: point,
    });
    session.input(
      'a',
      encodeInput(frame({ x: (point.x + 1) / 2, y: (point.y + 1) / 2 })),
    );
    session.tick();
    assert.deepEqual(frames.mock.calls.at(-1)!.arguments[0].values.a.aim, {
      time,
      observedAt: time,
      value: { x: (point.x + 1) / 2, y: (point.y + 1) / 2 },
    });
  }
  for (const time of [4500, 4900, 5300]) {
    at(time);
    session.input('a', encodeInput(frame({ x: 1, y: 1 })));
    session.tick();
    assert.deepEqual(frames.mock.calls.at(-1)!.arguments[0].values.a.aim, {
      time: 4220,
      observedAt: time,
      value: { x: 1, y: 1 },
    });
  }
  at(5820);
  session.tick();
  assert.equal(frames.mock.calls.at(-1)!.arguments[0].values.a.aim, undefined);
});
