import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { motionFixture } from './fixtures/motion-provider.ts';
import { Runtime } from '../src/client/runtime.ts';
import { SessionAuthority } from '../src/client/engine/session.ts';
import type { Message } from '../src/client/engine/messages.ts';
import { decodeInput, type InputFrame } from '../src/client/engine/protocol.ts';
import type { ControllerConfig } from '../src/client/controls/api.ts';
import { resolveConfig } from '../src/client/controls/resolve.ts';
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
  const invoke = (key: string, ...args: unknown[]) =>
    Reflect.get(runtime, key).apply(runtime, args);
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
  assert.equal(active.sensors.pointer.enabled, true);
  p.config(active);
  deliver();
  p.advance(2000);
  const fallback = deliver();
  assert.equal(fallback.sensors.pointer.enabled, false);
  assert.notEqual(fallback.generation, active.generation);
  host.control('a', { type: 'ready', generation: active.generation });
  assert.equal((Reflect.get(host, 'ready') as Set<string>).has('a'), false);
  p.config(fallback);
  deliver();
  assert.equal((Reflect.get(host, 'ready') as Set<string>).has('a'), true);
  p.f.emit();
  const recovered = deliver();
  assert.equal(recovered.sensors.pointer.enabled, true);
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
  config.sensors.tilt.enabled = true;
  config.sensors.shake.enabled = true;
  config.sensors.shake.thresholdG = 0.01;
  config.widgets.push({
    id: 'shake',
    type: 'shake',
    action: 'shake',
    label: 'Shake',
  });
  p.config(config);
  const actions = t.mock.method(p.runtime, 'action', () => {});
  p.invoke('tick');
  assert.equal(p.frames.at(-1)!.x, 1);
  assert.equal(actions.mock.callCount(), 1);
  p.advance(600);
  p.invoke('tick');
  assert.equal(p.frames.at(-1)!.x, 0);
  assert.equal(p.frames.at(-1)!.confidence, 0);
  assert.equal(actions.mock.callCount(), 1);
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
  p.runtime.beginAdjustAim();
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
