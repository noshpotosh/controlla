import assert from 'node:assert/strict';
import test from 'node:test';
import { installRendererDiagnostics } from './renderer-diagnostics.mjs';

function environment(t, search) {
  const elements = [], intervals = [], cleanups = [];
  const replace = (name, value) => {
    const old = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { configurable: true, value });
    t.after(() => old ? Object.defineProperty(globalThis, name, old) : Reflect.deleteProperty(globalThis, name));
  };
  replace('location', { search });
  replace('document', {
    createElement(tag) { const element = { tag, append() {} }; elements.push(element); return element; },
    body: { append() {} }, querySelector() { return { append() {} }; },
  });
  replace('window', { addEventListener(event, callback) { assert.equal(event, 'pagehide'); cleanups.push(callback); } });
  replace('setInterval', callback => { intervals.push(callback); return intervals.length; });
  const cleared = [];
  replace('clearInterval', id => cleared.push(id));
  return { elements, intervals, cleanups, cleared };
}
test('renderer diagnostics are opt-in and never request a worker report by default', t => {
  const env = environment(t, '');
  installRendererDiagnostics({ getAdapter() { throw new Error('Should not read worker'); } });
  assert.equal(env.elements.length, 0);
  assert.equal(env.intervals.length, 0);
});
test('diagnostics preserve worker GPU errors, serialize the current frame and retire polling', async t => {
  const env = environment(t, '?rendererdiagnostics=1');
  const renderer = { commandReplay: { draw: 12, shaderFail: 1 }, errors: [{ kind: 'shader-compilation', message: 'bad binding' }] };
  installRendererDiagnostics({ getAdapter: () => ({ loaded: true, async request(type) { assert.equal(type, 'rendererDiagnostics'); return renderer; } }),
    getFrame: () => ({ frame: 99 }) });
  await env.intervals[0]();
  assert.equal(env.elements[0].hidden, true);
  const report = JSON.parse(env.elements[0].textContent);
  assert.deepEqual(report.renderer, renderer);
  assert.equal(report.frame.frame, 99);
  env.cleanups[0](); assert.deepEqual(env.cleared, [1]);
});
test('input probes hold for game frames and release when the target is reached', t => {
  const env = environment(t, '?rendererdiagnostics=1&probeinputs=1');
  let frame = 100;
  const inputs = [];
  installRendererDiagnostics({ getAdapter: () => ({ loaded: true }), getFrame: () => ({ frame }),
    setProbeInput: state => inputs.push(state) });
  const start = env.elements.find(element => element.textContent === 'Start (30 frames)');
  start.onclick(); assert.equal(inputs.at(-1).mask, 16);
  frame = 129; env.intervals[1](); assert.equal(inputs.at(-1).mask, 16);
  frame = 130; env.intervals[1](); assert.equal(inputs.at(-1), null);
  env.cleanups.forEach(callback => callback()); assert.deepEqual(env.cleared, [1, 2]);
});
test('driving probes hold acceleration and use the analog steering axis', t => {
  const env = environment(t, '?rendererdiagnostics=1&probeinputs=1');
  let frame = 100;
  const inputs = [];
  installRendererDiagnostics({ getAdapter: () => ({ loaded: true }), getFrame: () => ({ frame }),
    setProbeInput: state => inputs.push(state) });
  env.elements.find(element => element.textContent === 'Accelerate (300 frames)').onclick();
  assert.equal(inputs.at(-1).mask, 1);
  assert.equal(inputs.at(-1).analogA, 255);
  frame = 399; env.intervals[1](); assert.equal(inputs.at(-1).mask, 1);
  frame = 400; env.intervals[1](); assert.equal(inputs.at(-1), null);
  for (const [name, axis] of [['Steer left + gas', 64], ['Steer right + gas', 192]]) {
    env.elements.find(element => element.textContent === `${name} (90 frames)`).onclick();
    assert.equal(inputs.at(-1).stickX, axis);
    assert.equal(inputs.at(-1).mask, 1);
    assert.equal(inputs.at(-1).analogA, 255);
    frame += 90; env.intervals[1](); assert.equal(inputs.at(-1), null);
  }
});

test('combined drift probes preserve gas pressure and release every held control', t => {
  const env = environment(t, '?rendererdiagnostics=1&probeinputs=1');
  let frame = 100;
  const inputs = [];
  installRendererDiagnostics({ getAdapter: () => ({ loaded: true }), getFrame: () => ({ frame }),
    setProbeInput: state => inputs.push(state) });
  env.elements.find(element => element.textContent === 'Drift right + gas (90 frames)').onclick();
  assert.equal(inputs.at(-1).mask, 65);
  assert.equal(inputs.at(-1).analogA, 255);
  assert.equal(inputs.at(-1).triggerRight, 255);
  assert.equal(inputs.at(-1).stickX, 192);
  frame = 190; env.intervals[1](); assert.equal(inputs.at(-1), null);
  env.elements.find(element => element.textContent === 'Brake (90 frames)').onclick();
  assert.equal(inputs.at(-1).analogB, 255);
  assert.equal(inputs.at(-1).analogA, 0);
  assert.equal(inputs.at(-1).triggerRight, 0);
  env.elements.find(element => element.textContent === 'Swap riders (30 frames)').onclick();
  assert.equal(inputs.at(-1).mask, 128);
  assert.equal(inputs.at(-1).analogB, 0);
  frame = 220; env.intervals[1](); assert.equal(inputs.at(-1), null);
});
