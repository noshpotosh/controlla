import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { Runtime } from '../src/client/runtime.ts';
import { adaptRuntime } from '../src/client/shell/runtime-adapter.ts';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function install(t: TestContext, name: string, value: unknown) {
  const before = Object.getOwnPropertyDescriptor(globalThis, name);
  Object.defineProperty(globalThis, name, { configurable: true, value });
  t.after(() => {
    if (before) Object.defineProperty(globalThis, name, before);
    else Reflect.deleteProperty(globalThis, name);
  });
}
function runtime(t: TestContext, navigator: object = { maxTouchPoints: 1 }) {
  install(t, 'document', Object.assign(new EventTarget(), { hidden: false }));
  install(
    t,
    'window',
    Object.assign(new EventTarget(), { devicePixelRatio: 1 }),
  );
  install(t, 'navigator', navigator);
  install(t, 'innerWidth', 800);
  install(t, 'innerHeight', 600);
  install(t, 'devicePixelRatio', 1);
  return new Runtime({ role: 'controller', endpoint: 'ws://unused' });
}
void test('motion permission granted after close cannot reactivate sensors or send capabilities', async (t) => {
  const permission = deferred<'granted'>();
  install(t, 'DeviceMotionEvent', {
    requestPermission: () => permission.promise,
  });
  const r = runtime(t),
    session = adaptRuntime(r);
  const add = t.mock.method(window, 'addEventListener'),
    remove = t.mock.method(window, 'removeEventListener');
  const send = t.mock.method(r.network, 'send', () => {});
  const pending = session.phone.enableMotion();
  session.close();
  permission.resolve('granted');
  await pending;
  assert.equal(
    add.mock.calls.filter((c) => String(c.arguments[0]) === 'devicemotion')
      .length,
    1,
  );
  assert.equal(
    remove.mock.calls.filter((c) => String(c.arguments[0]) === 'devicemotion')
      .length,
    1,
  );
  assert.equal(r.view.motionEnabled, false);
  assert.equal(send.mock.callCount(), 0);
});
void test('wake lock resolving after close is released and concurrent requests coalesce', async (t) => {
  const wake = deferred<WakeLockSentinel>();
  let requests = 0,
    releases = 0;
  const r = runtime(t, {
    maxTouchPoints: 1,
    wakeLock: {
      request: () => {
        requests++;
        return wake.promise;
      },
    },
  });
  install(
    t,
    'AudioContext',
    class {
      state = 'running';
      resume() {
        return Promise.resolve();
      }
      close() {
        this.state = 'closed';
        return Promise.resolve();
      }
    },
  );
  const session = adaptRuntime(r),
    a = session.room.unlock(),
    b = session.room.unlock();
  await Promise.resolve();
  assert.equal(requests, 1);
  session.close();
  wake.resolve(
    Object.assign(new EventTarget(), {
      release: async () => {
        releases++;
      },
    }) as unknown as WakeLockSentinel,
  );
  await Promise.all([a, b]);
  assert.equal(releases, 1);
  assert.equal(r.view.wakeLock, false);
});
void test('audio resume resolving after close does not request a wake lock', async (t) => {
  const audio = deferred<void>();
  let wakes = 0,
    closes = 0;
  const r = runtime(t, {
    maxTouchPoints: 1,
    wakeLock: {
      request: () => {
        wakes++;
        return Promise.reject(new Error('late request'));
      },
    },
  });
  install(
    t,
    'AudioContext',
    class {
      state = 'running';
      resume() {
        return audio.promise;
      }
      close() {
        closes++;
        this.state = 'closed';
        return Promise.resolve();
      }
    },
  );
  const session = adaptRuntime(r),
    pending = session.room.unlock();
  session.close();
  audio.resolve();
  await pending;
  assert.equal(closes, 1);
  assert.equal(wakes, 0);
});
