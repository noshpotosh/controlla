import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { MotionSteering } from './motion-steering.mjs';

// Run the actual phone script against event-capable browser doubles. These
// cases exercise lifecycle ownership, not physical sensors or permissions.
function phone() {
  const elements = new Map(['h1', '#status', '#connection', '#enable', '#center', '#sensitivity', '#fallback'].map(id => [id, { value: '128', textContent: '' }]));
  const events = new Map(), orientations = new Map(), posts = [];
  let tick, now = 100;
  const document = { hidden: false, querySelector: id => elements.get(id), querySelectorAll: () => [], addEventListener: (name, fn) => events.set(name, fn) };
  const window = { addEventListener: (name, fn) => events.set(name, fn) };
  const screen = { orientation: { angle: 0, addEventListener: (name, fn) => orientations.set(name, fn) } };
  const source = readFileSync(new URL('./phone.js', import.meta.url), 'utf8').replace("import { MotionSteering } from './motion-steering.mjs';", '');
  runInNewContext(source, { MotionSteering, URLSearchParams, location: { search: '?token=test' },
    crypto: { getRandomValues: bytes => bytes.fill(1) }, document, window, screen, performance: { now: () => now },
    isSecureContext: true, DeviceMotionEvent: {}, AbortSignal: { timeout: () => undefined },
    fetch: async (_url, options) => { posts.push(JSON.parse(options.body)); return { ok: true }; },
    setInterval: fn => { tick = fn; } });
  return { elements, events, orientations, posts,
    async tick() { now += 40; tick(); await new Promise(resolve => setImmediate(resolve)); },
    sample(x) { events.get('devicemotion')({ accelerationIncludingGravity: { x, y: 0 } }); } };
}

test('touch input takes control after motion was enabled', async () => {
  const p = phone();
  await p.elements.get('#enable').onclick();
  p.sample(6);
  await p.tick();
  assert.ok(p.posts.at(-1).state.stickX > 128);
  const fallback = p.elements.get('#fallback');
  fallback.onpointerdown();
  fallback.value = '40';
  await p.tick();
  assert.equal(p.posts.at(-1).state.stickX, 40);
  assert.equal(p.elements.get('#enable').textContent, 'Enable motion');
  fallback.onpointerup();
  await p.tick();
  assert.equal(p.posts.at(-1).state.stickX, 128);
});

test('blur releases input and stays disconnected until focus returns', async () => {
  const p = phone();
  await p.tick();
  p.events.get('blur')();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(p.posts.at(-1).state.connected, false);
  const count = p.posts.length;
  await p.tick();
  assert.equal(p.posts.length, count);
  p.events.get('focus')();
  await p.tick();
  assert.equal(p.posts.at(-1).state.connected, true);
  assert.equal(p.posts.at(-1).state.stickX, 128);
});

test('orientation change releases old steering and requires enabling motion again', async () => {
  const p = phone();
  await p.elements.get('#enable').onclick();
  p.sample(6);
  await p.tick();
  p.orientations.get('change')();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(p.posts.at(-1).state.connected, false);
  p.sample(6);
  await p.tick();
  assert.equal(p.posts.at(-1).state.stickX, 128);
  assert.match(p.elements.get('#status').textContent, /orientation changed/);
});
