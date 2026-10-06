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
