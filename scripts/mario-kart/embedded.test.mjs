import assert from 'node:assert/strict';
import test from 'node:test';
import { installEmbeddedGame } from './embedded.mjs';
import { controllerPacket, ControllerInputGate, nativeControllerArguments } from './controller-input.mjs';

test('embedded room input reaches four native port packets and clears stale holds', async t => {
  let now = 1000, receive, poll, generation = 0;
  const parentWindow = {}, calls = [], gate = new ControllerInputGate();
  const element = () => ({ classList: { add() {} }, setAttribute() {}, append() {} });
  const globals = {
    document: { body: element(), querySelectorAll: () => [], querySelector: element, createElement: element },
    window: { addEventListener(_name, callback) { receive = callback; } },
    parent: parentWindow, location: { origin: 'http://localhost:3000' },
    crossOriginIsolated: true,
    fetch: async () => ({ ok: true, blob: async () => new Blob() }),
    setInterval(callback) { poll = callback; },
  };
  for (const [key, value] of Object.entries(globals)) {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
    t.after(() => descriptor ? Object.defineProperty(globalThis, key, descriptor) : Reflect.deleteProperty(globalThis, key));
  }
  t.mock.method(performance, 'now', () => now);
  const adapter = {
    loaded: true,
    async setControllerInputState(port, state) {
      const packet = controllerPacket(port, state, ++generation);
      gate.apply(packet, validated => { calls.push(nativeControllerArguments(validated)); return 1; });
    },
  };
  await installEmbeddedGame({ getAdapter: () => adapter, mount: async () => {}, start() {}, sound: async () => {} });
  const state = { connected: true, mask: 65, stickX: 192, stickY: 128,
    cStickX: 128, cStickY: 128, triggerLeft: 0, triggerRight: 255, analogA: 255, analogB: 0 };
  const send = (source, origin, controllers) => receive({ source, origin, data: { type: 'controlla:kart-input', controllers } });
  send(parentWindow, location.origin, [state]);
  poll();
  assert.deepEqual(calls[0].slice(0, 11), [0, 1, 65, 192, 128, 128, 128, 0, 255, 255, 0]);
  assert.deepEqual(calls.slice(1).map(args => args.slice(0, 4)), [[1, 0, 0, 128], [2, 0, 0, 128], [3, 0, 0, 128]]);
  now += 400;
  send({}, location.origin, [state]);
  send(parentWindow, 'https://unrelated.example', [state]);
  send(parentWindow, location.origin, [{ ...state, stickX: 999 }]);
  now += 101;
  poll();
  assert.equal(calls.length, 8);
  assert.deepEqual(calls[4].slice(0, 11), [0, 0, 0, 128, 128, 128, 128, 0, 0, 0, 0]);
  poll();
  assert.equal(calls.length, 8);
  send(parentWindow, location.origin, [state, state, state, state]);
  poll();
  assert.deepEqual(calls.slice(8).map(args => args.slice(0, 3)), [[0, 1, 65], [1, 1, 65], [2, 1, 65], [3, 1, 65]]);
});
