import assert from 'node:assert/strict';
import test from 'node:test';
import { installRendererDiagnostics } from './renderer-diagnostics.mjs';

test('probe reports retain observed native inputs after release without assuming delivery', async t => {
  const env = environment(t, '?rendererdiagnostics=1&probeinputs=1');
  let frame = 100, buttons = 0;
  installRendererDiagnostics({
    getAdapter: () => ({ loaded: true, async request() { return {}; } }),
    getFrame: () => ({ frame, ppcWasmHelperStats: `pad polls:${frame} updates:1 input:0 gen:1 buttons:${buttons} stick:192,128 fastsw:1` }),
    setProbeInput() {},
  });
  env.elements.find(element => element.textContent === 'Drift right + gas (300 frames)').onclick();
  env.intervals[1]();
  buttons = 65;
  for (frame = 101; frame <= 170; frame++) env.intervals[1]();
  frame = 400; env.intervals[1]();
  await env.intervals[0]();
  const probe = JSON.parse(env.elements[0].textContent).probe;
  assert.equal(probe.requested.mask, 65);
  assert.equal(probe.releasedAtFrame, 400);
  assert.equal(probe.observations.length, 64);
  assert.match(probe.observations.at(-1).pad, /buttons:65/);
  assert.equal(probe.observations.at(-1).frame, 400);
});

function environment(t, search) {
  const elements = [], intervals = [], cleanups = [];
  const replace = (name, value) => {
    const old = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { configurable: true, value });
    t.after(() => old ? Object.defineProperty(globalThis, name, old) : Reflect.deleteProperty(globalThis, name));
  };
  replace('location', { search });
  replace('document', {
    createElement(tag) { const element = { tag, append() {}, listeners: {}, addEventListener(event, callback) { this.listeners[event] = callback; } }; elements.push(element); return element; },
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
test('frame stepping refreshes paused presentation only after native success', async t => {
  const env = environment(t, '?rendererdiagnostics=1&framestep=1');
  const actions = [];
  let success = true;
  const result = { stepped: true, exactSingleFrame: true, frameDelta: 1,
    before: { frame: 10 }, after: { frame: 11 } };
  installRendererDiagnostics({
    getAdapter: () => ({ loaded: true,
      async request(type) { return type === 'controllaStepFrame' ? success ? result : { stepped: false, error: 'not paused' } : {}; },
      applyFrame(value) { assert.equal(value, result); actions.push('apply'); } }),
    getFrame: () => ({ frame: 11 }), refreshPresentation: () => actions.push('refresh'),
  });
  const step = env.elements.find(element => element.textContent === 'Step native frame');
  await step.listeners.click();
  assert.deepEqual(actions, ['apply', 'refresh']);
  assert.equal(step.textContent, 'Stepped one native frame');
  await env.intervals[0]();
  assert.deepEqual(JSON.parse(env.elements[0].textContent).frameStep.after, { frame: 11 });
  success = false;
  await step.listeners.click();
  assert.equal(step.textContent, 'not paused');
  assert.deepEqual(actions, ['apply', 'refresh']);
  assert.equal(step.disabled, false);
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
  env.elements.find(element => element.textContent === 'Drift right + gas (300 frames)').onclick();
  assert.equal(inputs.at(-1).mask, 65);
  assert.equal(inputs.at(-1).analogA, 255);
  assert.equal(inputs.at(-1).triggerRight, 255);
  assert.equal(inputs.at(-1).stickX, 192);
  frame = 400; env.intervals[1](); assert.equal(inputs.at(-1), null);
  env.elements.find(element => element.textContent === 'Brake (90 frames)').onclick();
  assert.equal(inputs.at(-1).analogB, 255);
  assert.equal(inputs.at(-1).analogA, 0);
  assert.equal(inputs.at(-1).triggerRight, 0);
  env.elements.find(element => element.textContent === 'Swap riders (30 frames)').onclick();
  assert.equal(inputs.at(-1).mask, 128);
  assert.equal(inputs.at(-1).analogB, 0);
  frame = 430; env.intervals[1](); assert.equal(inputs.at(-1), null);
});

test('published frames release probes before the heartbeat sees the target', async t => {
  const env = environment(t, '?rendererdiagnostics=1&probeinputs=1');
  const inputs = [];
  const diagnostics = installRendererDiagnostics({
    getAdapter: () => ({ loaded: true, async request() { return {}; } }),
    // Intentionally stale: the callback must use its supplied fresh frame.
    getFrame: () => ({ frame: 100 }),
    setProbeInput: state => inputs.push(state),
  });
  env.elements.find(element => element.textContent === 'Brake (90 frames)').onclick();
  diagnostics.observeFrame({ frame: 189 });
  assert.equal(inputs.at(-1).mask, 2);
  diagnostics.observeFrame({ frame: 190 });
  assert.equal(inputs.at(-1), null);
  const count = inputs.length;
  env.intervals[1]();
  assert.equal(inputs.length, count); // A stale heartbeat cannot reassert brake.
  await env.intervals[0]();
  assert.equal(JSON.parse(env.elements[0].textContent).probe.releasedAtFrame, 190);
});

test('page departure neutralizes an unfinished held probe', t => {
  const env = environment(t, '?rendererdiagnostics=1&probeinputs=1');
  const inputs = [];
  const diagnostics = installRendererDiagnostics({ getAdapter: () => ({ loaded: true }),
    getFrame: () => ({ frame: 100 }), setProbeInput: state => inputs.push(state) });
  env.elements.find(element => element.textContent === 'Accelerate (300 frames)').onclick();
  env.cleanups.forEach(callback => callback());
  assert.equal(inputs.at(-1), null);
  const count = inputs.length;
  diagnostics.observeFrame({ frame: 101 });
  assert.equal(inputs.length, count);
});
