import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  MotionControls,
  type MotionEffects,
} from '../src/client/controls/motion/composition.ts';
import { motionDefinitions } from '../src/client/controls/motion/registry.ts';
import { motionMetadata } from '../src/client/controls/motion/metadata-registry.ts';
import { motionFixture } from './fixtures/motion-provider.ts';

void test('pure metadata and live processor registration describe exactly the same inputs', () => {
  assert.deepEqual(
    motionDefinitions.map((definition) =>
      Object.fromEntries(
        Object.entries(definition).filter(([key]) => key !== 'create'),
      ),
    ),
    motionMetadata,
  );
  for (const definition of motionDefinitions)
    assert.equal(typeof definition.create, 'function');
});

void test('generic composition routes held capture, timestamps and haptics and retains a valid setup after rejection', async () => {
  const motion = motionFixture();
  await motion.motion.enable();
  let now = 0;
  const activations: Parameters<MotionEffects['activation']>[] = [],
    haptics: number[] = [];
  const controls = new MotionControls(
    { localTime: () => now, authorityTime: (at) => at + 1000 },
    {
      activation: (...args) => activations.push(args),
      haptic: (ms) => haptics.push(ms),
    },
  );
  assert.equal(
    controls.configure([
      { action: 'cursor', type: 'pointer', config: { anchor: false } },
      { action: 'strike', type: 'chop', config: {} },
    ]),
    true,
  );
  const feed = (at: number, rate = 0) => {
    motion.advance(at - now);
    now = at;
    motion.emit({
      rotationRate: { alpha: (rate * 180) / Math.PI, beta: 0, gamma: 0 },
    });
    controls.process(motion.motion.getSnapshot());
  };
  feed(0);
  controls.command('strike', { type: 'press', down: true, at: 100 });
  assert.equal(controls.getSnapshot().inputs.strike.held, true);
  assert.equal(
    controls.configure([
      { action: 'broken', type: 'pointer', config: { rateHz: NaN } },
    ]),
    false,
  );
  assert.equal(
    controls.getSnapshot().inputs.strike.held,
    true,
    'invalid candidate cannot retire a held gesture',
  );
  feed(110, 2);
  controls.command('strike', { type: 'press', down: false, at: 120 });
  feed(130, 5);
  assert.deepEqual(activations, [
    ['strike', 0.5, { at: 110, aim: { x: 0.5, y: 0.5 } }],
  ]);
  assert.deepEqual(haptics, [20]);
  const snapshot = controls.getSnapshot();
  assert.equal(snapshot.inputs.strike.activations, 1);
  assert.equal(Reflect.set(snapshot.point, 'x', 99), false);
  assert.equal(Reflect.set(snapshot.inputs.strike, 'held', true), false);
  controls.command('strike', { type: 'press', down: true, at: 140 });
  controls.cancel();
  assert.equal(controls.getSnapshot().inputs.strike.held, false);
  feed(150, 10);
  assert.equal(activations.length, 1);
  controls.dispose();
  controls.command('strike', { type: 'press', down: true, at: 160 });
  feed(160, 10);
  assert.equal(activations.length, 1);
  assert.equal(controls.configure([]), false);
  motion.motion.dispose();
});

void test('composition rejects ambiguous actions, repeated inputs, vector conflicts and unknown types atomically', () => {
  const controls = new MotionControls(
    { localTime: () => 0, authorityTime: (at) => at },
    { activation() {}, haptic() {} },
  );
  for (const bindings of [
    [
      { action: 'a', type: 'pointer' as const, config: {} },
      { action: 'b', type: 'tilt' as const, config: {} },
    ],
    [
      { action: 'a', type: 'shake' as const, config: {} },
      { action: 'a', type: 'chop' as const, config: {} },
    ],
    [
      { action: 'a', type: 'shake' as const, config: {} },
      { action: 'b', type: 'shake' as const, config: {} },
    ],
    [{ action: 'a', type: 'button' as const, config: {} }],
  ])
    assert.equal(controls.configure(bindings), false);
  assert.deepEqual(controls.getSnapshot().inputs, {});
  controls.dispose();
});

void test('configuration projects pointer bounds before a sample arrives', () => {
  const controls = new MotionControls(
    { localTime: () => 0, authorityTime: (at) => at },
    { activation() {}, haptic() {} },
  );
  assert.equal(
    controls.configure([
      {
        action: 'aim',
        type: 'pointer',
        config: { bounds: { left: 0.7, top: 0.1, right: 0.9, bottom: 0.9 } },
      },
    ]),
    true,
  );
  assert.deepEqual(controls.getSnapshot().point, { x: 0.7, y: 0.5 });
  controls.dispose();
});
