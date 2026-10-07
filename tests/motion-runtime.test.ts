import { games } from '../src/client/minigames/catalog.ts';
import { buttonProbe } from './fixtures/games.ts';
import { controllerSpec } from '../src/client/engine/input.ts';
import type { GameInput, GameDescriptor } from '../src/client/api/index.ts';
import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { motionFixture } from './fixtures/motion-provider.ts';
import { Runtime } from '../src/client/runtime/runtime.ts';
import { SessionAuthority } from '../src/client/engine/session.ts';
import type { Message } from '../src/client/engine/messages.ts';
import { decodeInput, type InputFrame } from '../src/client/engine/protocol.ts';
import type { ControllerConfig } from '../src/client/controls/api.ts';
import {
  resolveConfig,
  defaultCapabilities,
} from '../src/client/controls/resolve.ts';
import { pointerSpec, steeringSpec } from './fixtures/games.ts';

function setup(t: TestContext) {
  t.after(() => runtime.close());
  for (const [key, value] of Object.entries({
    document: Object.assign(new EventTarget(), { hidden: false }),
    window: Object.assign(new EventTarget(), { devicePixelRatio: 1 }),
    navigator: { maxTouchPoints: 1 },
  })) {
    const prior = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { value, configurable: true });
    t.after(() => {
      if (prior) Object.defineProperty(globalThis, key, prior);
      else Reflect.deleteProperty(globalThis, key);
    });
  }
  const f = motionFixture();
  f.advance(1000); // Provider and runtime share the same local monotonic clock.
  let clock = 1000;
  t.mock.method(performance, 'now', () => clock);
  const runtime = new Runtime(
    { role: 'controller', endpoint: 'ws://unused' },
    f.motion,
  );
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
  const messages: Message[] = [],
    frames: InputFrame[] = [];
  t.mock.method(
    runtime.network,
    'send',
    (_id: string, channel: string, data: unknown) => {
      if (channel === 'ctrl') messages.push(data as Message);
      if (channel === 'input')
        frames.push(decodeInput(data as ArrayBuffer, clock));
    },
  );
  Reflect.get(runtime, 'resources').start();
  const invoke = (key: string, ...args: unknown[]) => {
    if (key === 'pageHide' || key === 'pageShow')
      return window.dispatchEvent(new Event(key.toLowerCase()));
    return Reflect.get(runtime, key).apply(runtime, args);
  };
  return {
    f,
    runtime,
    messages,
    frames,
    invoke,
    advance(ms: number) {
      clock += ms;
      f.advance(ms);
    },
    config(config: ControllerConfig) {
      invoke('controllerMessage', { type: 'config', config });
    },
  };
}
void test('motion availability drives real host generations and delayed ACKs cannot ready an obsolete config', async (t) => {
  const p = setup(t),
    configs: ControllerConfig[] = [];
  const host = new SessionAuthority('host', {
    toPlayer: (_id, message) => {
      if (message.type === 'config') configs.push(message.config);
    },
    toVenue() {},
    snapshot() {},
    event() {},
    warning() {},
  });
  t.after(() => host.dispose());
  host.setRoster({
    players: [
      {
        id: 'a',
        name: 'Ada',
        seat: 0,
        venueId: 'host',
        connected: true,
        color: 'blue',
      },
    ],
    venues: [{ id: 'host', name: 'Host', connected: true }],
  });
  let delivered = 0;
  const deliver = () => {
    for (const message of p.messages.slice(delivered))
      host.control('a', message);
    delivered = p.messages.length;
    return configs.at(-1)!;
  };
  p.config(configs.at(-1)!);
  deliver();
  await p.runtime.enableMotion();
  deliver();
  p.f.emit();
  const active = deliver();
  assert.equal(!!active.motion.pointer, true);
  p.config(active);
  deliver();
  p.advance(2000);
  const fallback = deliver();
  assert.equal(!!fallback.motion.pointer, false);
  assert.notEqual(fallback.generation, active.generation);
  host.control('a', { type: 'ready', generation: active.generation });
  assert.equal((Reflect.get(host, 'ready') as Set<string>).has('a'), false);
  p.config(fallback);
  deliver();
  assert.equal((Reflect.get(host, 'ready') as Set<string>).has('a'), true);
  p.f.emit();
  const recovered = deliver();
  assert.equal(!!recovered.motion.pointer, true);
  assert.notEqual(recovered.generation, fallback.generation);
  host.control('a', { type: 'ready', generation: fallback.generation });
  assert.equal((Reflect.get(host, 'ready') as Set<string>).has('a'), false);
  p.config(recovered);
  deliver();
  assert.equal((Reflect.get(host, 'ready') as Set<string>).has('a'), true);
  assert.equal(p.f.counts().requests, 1);
  const capabilities = p.messages.filter(
    (m) => m.type === 'capabilities',
  ).length;
  p.advance(10);
  p.f.emit();
  deliver();
  assert.equal(
    p.messages.filter((m) => m.type === 'capabilities').length,
    capabilities,
  );
  p.invoke('roster', {
    players: [
      {
        id: 'a',
        name: 'Ada',
        seat: 0,
        venueId: 'host',
        connected: true,
        color: 'blue',
      },
    ],
    venues: [{ id: 'host', name: 'Host', connected: true }],
  });
  assert.ok(
    p.messages.filter((m) => m.type === 'capabilities').length > capabilities,
    'reconnect/roster synchronization republishes current capabilities',
  );
});
void test('runtime neutralizes stale tilt and never repeats a stale shake', async (t) => {
  const p = setup(t);
  await p.runtime.enableMotion();
  p.f.emit({ accelerationIncludingGravity: { x: 6, y: 0, z: 9.81 } });
  const config = resolveConfig(steeringSpec, p.f.motion.capabilities, 1);
  config.motion.tilt = {};
  config.motion.shake = { thresholdG: 0.01 };
  config.widgets.push({
    id: 'shake',
    type: 'shake',
    action: 'shake',
    label: 'Shake',
  });
  p.config(config);
  const shakes = () =>
    p.messages.filter((m) => m.type === 'widget' && m.action === 'shake');
  p.invoke('tick');
  assert.equal(p.frames.at(-1)!.x, 1);
  assert.equal(shakes().length, 1);
  p.advance(600);
  p.invoke('tick');
  assert.equal(p.frames.at(-1)!.x, 0);
  assert.equal(p.frames.at(-1)!.confidence, 0);
  assert.equal(shakes().length, 1);
});
void test('page suspension defeats config and diagnostics starts; pageshow restores sampling without a pointer jump', async (t) => {
  const p = setup(t);
  await p.runtime.enableMotion();
  p.f.emit();
  p.config(resolveConfig(pointerSpec, p.f.motion.capabilities, 1));
  p.advance(20);
  p.f.emit({ rotationRate: { alpha: 20, beta: 0, gamma: 0 } });
  p.invoke('tick');
  p.advance(20);
  p.f.emit({ rotationRate: { alpha: 20, beta: 0, gamma: 0 } });
  p.invoke('tick');
  const before = p.frames.at(-1)!;
  assert.notEqual(before.y, 0.5, 'the cursor moved before suspension');
  p.invoke('pageHide');
  p.config(p.runtime.view.config!);
  p.f.motion.start();
  p.runtime.openSettings();
  assert.equal(p.f.counts().starts, 1);
  p.advance(3000);
  const count = p.frames.length;
  p.invoke('tick');
  assert.equal(p.frames.length, count);
  p.invoke('pageShow');
  assert.equal(p.f.counts().starts, 2);
  p.f.emit({ rotationRate: { alpha: 20, beta: 0, gamma: 0 } });
  p.invoke('tick');
  const after = p.frames.at(-1)!;
  assert.equal(after.x, before.x);
  assert.equal(after.y, before.y);
  assert.equal(p.f.counts().requests, 1);
  p.runtime.close();
  p.invoke('pageShow');
  p.f.motion.start();
  assert.equal(p.f.counts().starts, 2);
});

void test('directional jolt resolves without a touch substitute and traverses live phone emission and authority ingress', async (t) => {
  const p = setup(t);
  const observed: GameInput[] = [];
  const descriptor: GameDescriptor = {
    ...buttonProbe,
    id: 'registered-jolt-probe',
    name: 'Registered impulse probe',
    controls: {
      inputs: { strike: { required: true, prefer: 'jolt', fallback: null } },
    },
    create(options) {
      const game = buttonProbe.create(options);
      const tick = game.tick.bind(game);
      game.tick = (input) => {
        observed.push(structuredClone(input));
        return tick(input);
      };
      return game;
    },
  };
  assert.throws(
    () => resolveConfig(controllerSpec(descriptor), defaultCapabilities(), 1),
    /Motion access is off/,
  );
  (games as GameDescriptor[]).push(descriptor);
  t.after(() =>
    (games as GameDescriptor[]).splice(games.indexOf(descriptor), 1),
  );
  await p.runtime.enableMotion();
  p.f.emit({ acceleration: { x: 0, y: 0, z: 0 } });
  const configs: ControllerConfig[] = [];
  const host = new SessionAuthority('host', {
    toPlayer: (_id, message) => {
      if (message.type === 'config') configs.push(message.config);
    },
    toVenue() {},
    snapshot() {},
    event() {},
    warning() {},
  });
  t.after(() => host.dispose());
  host.setRoster({
    players: [
      {
        id: 'a',
        name: 'Ada',
        seat: 0,
        venueId: 'host',
        connected: true,
        color: 'blue',
      },
    ],
    venues: [{ id: 'host', name: 'Host', connected: true }],
  });
  for (const message of p.messages) host.control('a', message);
  host.control('a', {
    type: 'capabilities',
    capabilities: p.f.motion.capabilities,
  });
  host.start(descriptor.id, descriptor.defaultMode);
  const config = configs.at(-1)!;
  assert.equal(config.schemaVersion, 2);
  assert.deepEqual(
    config.widgets.map((widget) => widget.type),
    ['jolt'],
  );
  assert.ok(config.motion.jolt);
  let delivered = p.messages.length;
  p.config(config);
  const deliver = () => {
    for (const message of p.messages.slice(delivered))
      host.control('a', message);
    delivered = p.messages.length;
  };
  deliver();
  p.advance(20);
  host.tick();
  p.advance(3000);
  host.tick();
  p.f.emit({ acceleration: { x: 0, y: 0, z: 0 } });
  p.invoke('tick');
  p.advance(60);
  p.f.emit({ acceleration: { x: 0, y: 0, z: 0 } });
  p.invoke('tick');
  p.advance(20);
  p.f.emit({
    acceleration: { x: 30, y: 0, z: 0 },
    accelerationIncludingGravity: { x: 30, y: 0, z: 9.81 },
  });
  p.invoke('tick');
  deliver();
  const press = p.messages.find((message) => message.type === 'press');
  assert.ok(press && press.type === 'press');
  assert.deepEqual(press.press.value, {
    kind: 'translation',
    direction: 'right',
    strength: 1,
  });
  const widget = p.messages.find(
    (message) => message.type === 'widget' && message.action === 'strike',
  );
  assert.ok(widget && widget.type === 'widget');
  assert.equal(widget.time, press.press.time);
  host.tick();
  p.advance(220);
  host.tick();
  const actions = observed.flatMap((input) => input.actions);
  assert.equal(actions.length, 1);
  assert.equal(actions[0].name, 'strike');
  assert.deepEqual(actions[0].value, press.press.value);
  host.control('a', press); // Reliable duplicate cannot activate again.
  host.tick();
  assert.equal(observed.flatMap((input) => input.actions).length, 1);
});
