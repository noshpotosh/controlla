import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { Runtime } from '../src/client/runtime.ts';
import {
  adaptRuntime,
  createSession,
} from '../src/client/shell/runtime-adapter.ts';
import {
  defaultCapabilities,
  resolveConfig,
} from '../src/client/controls/resolve.ts';
import { pointerSpec } from './fixtures/games.ts';
import type { Role } from '../src/shared/room.ts';
import type { RoundSnapshot } from '../src/client/api/index.ts';
import type { RawMotionSample } from '../src/client/controls/motion/trace.ts';

function fixture(t: TestContext, role: Role = 'host') {
  for (const [name, value] of Object.entries({
    document: Object.assign(new EventTarget(), { hidden: false }),
    window: Object.assign(new EventTarget(), { devicePixelRatio: 1 }),
    navigator: { maxTouchPoints: 1 },
    innerWidth: 800,
    innerHeight: 600,
  })) {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { configurable: true, value });
    t.after(() => {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    });
  }
  const runtime = new Runtime({ role, endpoint: 'ws://unused' });
  runtime.view.identity = {
    id: 'ada',
    role,
    room: 'ABCD',
    venueId: 'venue',
    hostId: 'host',
    token: 'secret',
  };
  runtime.view.roster = {
    players: [
      {
        id: 'ada',
        name: 'Ada',
        seat: 0,
        color: '#abc',
        venueId: 'venue',
        connected: true,
      },
    ],
    venues: [],
  };
  Reflect.get(runtime, 'controllerMessage').call(runtime, {
    type: 'config',
    config: resolveConfig(pointerSpec, defaultCapabilities(), 1),
  });
  // No live transport, audio, or timers are started by these adapter tests.
  t.mock.method(runtime, 'start', () => {});
  t.mock.method(runtime, 'unlock', async () => {});
  t.mock.method(runtime, 'close', () => {});
  return runtime;
}

void test('shell snapshots are stable, detached, frozen projections without credentials or runtime data', (t) => {
  const runtime = fixture(t);
  runtime.view.telemetry = {
    type: 'telemetry',
    secret: 'hidden',
    players: [
      {
        id: 'ada',
        name: 'Ada',
        hz: 60,
        substitutions: ['touch'],
        clock: { rtt: { p50: 1, p95: 2, p99: 3, jitter: 2 }, secret: 'hidden' },
      },
    ],
  };
  runtime.view.links = { host: { path: 'P2P', rtt: 10 } };
  const session = adaptRuntime(runtime),
    first = session.getSnapshot();
  t.after(session.close);
  assert.equal(first, session.getSnapshot());
  assert.equal('token' in first.identity!, false);
  for (const key of [
    'state',
    'progress',
    'history',
    'telemetry',
    'network',
    'buffer',
  ])
    assert.equal(key in first, false);
  assert.equal(JSON.stringify(first).includes('hidden'), false);
  assert.equal(Reflect.set(first.roster.players[0], 'name', 'Changed'), false);
  assert.equal(Reflect.set(first.config!.widgets[0], 'action', 'wrong'), false);
  assert.equal(Reflect.set(first.diagnostics.links.host, 'rtt', 0), false);
  assert.equal(runtime.view.roster.players[0].name, 'Ada');
  assert.ok(!Object.isFrozen(runtime.view.roster.players[0]));
  runtime.view.roster.players[0].name = 'Bea';
  assert.equal(first.roster.players[0].name, 'Ada');
  let notifications = 0;
  const off = session.subscribe(() => notifications++);
  runtime.warn('updated');
  assert.equal(notifications, 1);
  assert.notEqual(session.getSnapshot(), first);
  assert.equal(session.getSnapshot().roster.players[0].name, 'Bea');
  off();
  runtime.warn('again');
  assert.equal(notifications, 1);
});

void test('shell projection follows presented progress without sampling frames or acknowledging markers', (t) => {
  const runtime = fixture(t);
  const advance = t.mock.method(runtime.screenPort, 'advanceFrame', () => {
    throw new Error('extra sampling');
  });
  const markers = t.mock.method(runtime.screenPort, 'presented', () => {});
  runtime.view.phase = 'running';
  runtime.view.progress = { revision: 7, totals: { ada: 5 }, rounds: [] };
  runtime.view.state = {
    progress: { revision: 6, totals: { ada: 3 }, awards: {} },
  } as unknown as RoundSnapshot;
  const session = adaptRuntime(runtime);
  t.after(session.close);
  const screen = session.screen,
    room = session.room,
    motion = session.motion;
  assert.deepEqual(session.getSnapshot().standings, { ada: 3 });
  runtime.view.state = {
    progress: { revision: 7, totals: { ada: 5 }, awards: {} },
  } as unknown as RoundSnapshot;
  assert.deepEqual(session.getSnapshot().standings, { ada: 3 });
  runtime.warn('next normal notification');
  assert.deepEqual(session.getSnapshot().standings, { ada: 5 });
  assert.equal(session.screen, screen);
  assert.equal(session.room, room);
  assert.equal(session.motion, motion);
  assert.equal(advance.mock.callCount(), 0);
  assert.equal(markers.mock.callCount(), 0);
});

void test('phone ports retain configuration generation and local epoch, and stop after close', (t) => {
  const runtime = fixture(t, 'controller');
  runtime.view.status = 'Connected';
  const sends = t.mock.method(runtime.network, 'send', () => {});
  const vibrations = t.mock.fn();
  Object.defineProperty(navigator, 'vibrate', {
    configurable: true,
    value: vibrations,
  });
  const values = () =>
    sends.mock.calls
      .map((c) => c.arguments[2] as { type?: string; generation?: number })
      .filter((m) => m.type === 'widget');
  const session = adaptRuntime(runtime),
    widget = runtime.view.config!.widgets[0];
  const old = session.phone.portFor(widget, 1);
  old.value({ x: 0.2, y: 0.3 });
  assert.equal(values().length, 1);
  Reflect.get(runtime, 'controllerMessage').call(runtime, {
    type: 'config',
    config: resolveConfig(pointerSpec, defaultCapabilities(), 2),
  });
  old.value({ x: 0.9, y: 0.9 });
  old.haptic();
  assert.equal(values().length, 1);
  const current = session.phone.portFor(runtime.view.config!.widgets[0], 2);
  current.value({ x: 0.4, y: 0.6 });
  assert.equal(values().at(-1)!.generation, 2);
  Reflect.get(runtime, 'pageHide').call(runtime);
  Reflect.get(runtime, 'pageShow').call(runtime);
  current.value({ x: 0, y: 0 });
  assert.equal(values().length, 2);
  const resumed = session.phone.portFor(runtime.view.config!.widgets[0], 2);
  session.close();
  resumed.value({ x: 1, y: 1 });
  resumed.haptic();
  assert.equal(values().length, 2);
  assert.equal(vibrations.mock.callCount(), 0);
});

void test('close retires subscriptions, motion observers and retained commands exactly once', async (t) => {
  const runtime = fixture(t);
  let sample: ((value: RawMotionSample) => void) | undefined,
    stops = 0;
  t.mock.method(
    runtime.motion,
    'onSample',
    (listener: (sample: RawMotionSample) => void) => {
      sample = listener;
      return () => {
        stops++;
      };
    },
  );
  const start = t.mock.method(runtime, 'startGame', () => {}),
    enable = t.mock.method(runtime, 'enableMotion', async () => {});
  const session = adaptRuntime(runtime);
  let notifications = 0,
    samples = 0;
  session.subscribe(() => notifications++);
  const off = session.motion.subscribe(() => samples++);
  sample!({ t: 1 } as RawMotionSample);
  assert.equal(samples, 1);
  session.host!.startGame('neon-harvest', 'standard');
  assert.equal(start.mock.callCount(), 1);
  session.close();
  session.close();
  off();
  session.host!.startGame('neon-harvest', 'standard');
  await session.phone.enableMotion();
  runtime.warn('retired');
  sample!({ t: 2 } as RawMotionSample);
  assert.equal(notifications, 0);
  assert.equal(samples, 1);
  assert.equal(stops, 1);
  assert.equal(start.mock.callCount(), 1);
  assert.equal(enable.mock.callCount(), 0);
  assert.equal(
    (
      runtime.close as unknown as { mock: { callCount(): number } }
    ).mock.callCount(),
    1,
  );
});

void test('only host sessions receive host commands', (t) => {
  for (const role of ['host', 'display', 'controller'] as const) {
    const runtime = fixture(t, role),
      session = adaptRuntime(runtime);
    assert.equal(session.host !== null, role === 'host');
    session.close();
  }
});

void test('joining validates before creation, starts once, and cleans up failed starts', (t) => {
  const runtime = fixture(t);
  const request = {
    role: 'host' as const,
    room: '',
    venue: '',
    name: '',
    endpoint: 'ws://unused',
    resume: false,
  };
  let creates = 0;
  const create = () => {
    creates++;
    return runtime;
  };
  assert.throws(
    () => createSession({ ...request, role: 'controller' }, create),
    /room code/,
  );
  assert.throws(
    () => createSession({ ...request, endpoint: 'https://unused' }, create),
    /ws/,
  );
  assert.equal(creates, 0);
  const session = createSession(request, create);
  assert.equal(
    (
      runtime.start as unknown as { mock: { callCount(): number } }
    ).mock.callCount(),
    1,
  );
  session.close();
  session.close();
  const failing = fixture(t);
  t.mock.method(failing, 'start', () => {
    throw new Error('start failed');
  });
  assert.throws(() => createSession(request, () => failing), /start failed/);
  assert.equal(
    (
      failing.close as unknown as { mock: { callCount(): number } }
    ).mock.callCount(),
    1,
  );
});
