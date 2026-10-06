import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installProfileResetRequest } from './profile-worker.mjs';

test('profile reset disables then enables the native sampler and reports missing ABI', async () => {
  const source = 'return async function(type, api) { switch(type) {\n    case "rendererDiagnostics": return { untouched: true };\n} }';
  const dispatch = new Function(installProfileResetRequest(source))();
  const calls = [];
  assert.deepEqual(await dispatch('controllaResetCpuProfile', { setPpcProfileEnabled: value => calls.push(value) }), { enabled: true });
  assert.deepEqual(calls, [0, 1]);
  assert.equal((await dispatch('controllaResetCpuProfile', {})).enabled, false);
  assert.deepEqual(await dispatch('rendererDiagnostics', {}), { untouched: true });
});

test('unexpected worker dispatch fails closed instead of applying a partial rewrite', () => {
  assert.throws(() => installProfileResetRequest('different worker'), /pinned worker dispatch/);
  assert.throws(() => installProfileResetRequest('    case "rendererDiagnostics":\n    case "rendererDiagnostics":'), /pinned worker dispatch/);
});

test('native progress samples live counters and retries a torn tick read', async () => {
  const source = 'return async function(type, api) { switch(type) {\n    case "rendererDiagnostics": return {};\n} }';
  const dispatch = new Function(installProfileResetRequest(source))();
  const highs = [1, 2, 2, 2];
  const result = await dispatch('controllaNativeProgress', {
    getCoreTicksHigh: () => highs.shift(), getCoreTicksLow: () => 5, getFrame: () => 17,
  });
  assert.equal(result.available, true);
  assert.equal(result.ticks, 2 * 0x100000000 + 5);
  assert.equal(result.frame, 17);
  assert.ok(Number.isFinite(result.capturedAtMs));
  assert.deepEqual(await dispatch('controllaNativeProgress', {}), { available: false });
  let high = 0;
  const torn = await dispatch('controllaNativeProgress', {
    getCoreTicksHigh: () => high++, getCoreTicksLow: () => 0, getFrame: () => 0,
  });
  assert.equal(torn.available, false);
});

test('transport start and pause reach native transition and reject failed state changes', async () => {
  const source = 'return async function dispatch(type, api) { switch(type) {\n    case "rendererDiagnostics": return {};\n} }';
  const calls = [];
  const coreBoot = { accepted: true };
  let observed = 'Paused';
  const dispatch = new Function('coreBoot', 'framePayload', 'handleMessage', installProfileResetRequest(source))(
    coreBoot, () => ({ booting: true }), async (type, payload) => {
      calls.push({ type, payload }); return { coreStateName: observed };
    });
  await dispatch('pause', {});
  observed = 'Running';
  await dispatch('start', {});
  assert.deepEqual(calls, [
    { type: 'validationSetCorePaused', payload: { paused: true } },
    { type: 'validationSetCorePaused', payload: { paused: false } },
  ]);
  await assert.rejects(dispatch('pause', {}), /Native pause failed/);
  coreBoot.accepted = false;
  assert.deepEqual(await dispatch('start', {}), { booting: true });
});
