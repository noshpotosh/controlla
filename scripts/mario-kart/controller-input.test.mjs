import { test } from 'node:test';
import assert from 'node:assert/strict';
import { controllerPacket, ControllerInputGate, nativeControllerArguments } from './controller-input.mjs';
const state = { connected: true, mask: 1, stickX: 0, stickY: 255, cStickX: 128, cStickY: 128, triggerLeft: 255, triggerRight: 0, analogA: 255, analogB: 0 };

test('each controller has independent ordering and handles sequence wrap', () => {
  const gate = new ControllerInputGate();
  const calls = [];
  const native = packet => { calls.push(packet); return 1; };
  assert.equal(gate.apply(controllerPacket(0, state, 50), native), true);
  assert.equal(gate.apply(controllerPacket(1, state, 1), native), true);
  assert.equal(gate.apply(controllerPacket(0, state, 49), native), false);
  assert.equal(gate.apply(controllerPacket(1, state, 1), native), false);
  gate.reset();
  assert.equal(gate.apply(controllerPacket(2, state, 0xffffffff), native), true);
  assert.equal(gate.apply(controllerPacket(2, state, 1), native), true);
  assert.equal(calls.length, 4);
});

test('disconnect clears held inputs and matches the native ABI', () => {
  const packet = controllerPacket(3, { ...state, connected: false }, 7);
  assert.deepEqual(nativeControllerArguments(packet), [3, 0, 0, 128, 128, 128, 128, 0, 0, 0, 0, 7]);
});

test('invalid packets and failed native writes do not advance sequence state', () => {
  assert.throws(() => controllerPacket(4, state, 1), /port/);
  assert.throws(() => controllerPacket(0, { ...state, stickX: NaN }, 1), /stickX/);
  assert.throws(() => controllerPacket(0, state, 0), /generation/);
  const gate = new ControllerInputGate();
  assert.throws(() => gate.apply(controllerPacket(0, state, 1), () => 0), /rejected/);
  assert.deepEqual(gate.generations, [0, 0, 0, 0]);
});
