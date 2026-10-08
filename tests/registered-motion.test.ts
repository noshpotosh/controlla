import { pointer } from '../src/client/controls/motion/pointer-input.ts';
import { chop } from '../src/client/controls/motion/chop-input.ts';
import { CHOP } from '../src/client/controls/motion/chop.ts';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  shake,
  tilt,
} from '../src/client/controls/motion/accelerometer-inputs.ts';
import type { ValidatedMotionSample } from '../src/client/controls/motion/registration.ts';
import { motionFixture } from './fixtures/motion-provider.ts';

async function fixture() {
  const motion = motionFixture();
  await motion.motion.enable();
  let now = 0;
  const clocks = {
    localTime: () => now,
    authorityTime: (at: number) => at + 1000,
  };
  const sample = (
    at: number,
    overrides: Partial<ValidatedMotionSample> = {},
  ) => {
    motion.advance(at - now);
    now = at;
    motion.emit();
    return { ...motion.motion.getSnapshot(), ...overrides };
  };
  return { motion, clocks, sample };
}

void test('tilt calibration preserves signed coordinates, neutralizes stale input and detaches values', async () => {
  const f = await fixture();
  const processor = tilt.create(f.clocks);
  processor.configure({});
  const input = f.sample(10, { tilt: { x: 0.4, y: -0.3 } });
  assert.deepEqual(processor.process(input), [
    { type: 'value', confidence: 1, value: { x: 0.4, y: -0.3 }, at: 10 },
  ]);
  processor.command({ type: 'recenter', at: 10 });
  assert.deepEqual(processor.process(f.sample(20, { tilt: { x: -1, y: 1 } })), [
    { type: 'value', confidence: 1, value: { x: -1, y: 1 }, at: 20 },
  ]);
  assert.deepEqual(
    processor.process(f.sample(30, { tilt: { x: 0.4, y: -0.3 } })),
    [{ type: 'value', confidence: 1, value: { x: 0, y: 0 }, at: 30 }],
  );
  assert.deepEqual(processor.process(f.sample(40, { accelFresh: false })), [
    { type: 'value', confidence: 0, value: { x: 0, y: 0 }, at: 40 },
  ]);
  assert.deepEqual(processor.command({ type: 'cancel', at: 40 }), [
    { type: 'value', value: { x: 0, y: 0 }, at: 40 },
  ]);
  processor.dispose();
  processor.configure({});
  assert.deepEqual(processor.process(f.sample(50)), []);
  assert.deepEqual(processor.command({ type: 'cancel', at: 50 }), []);
  f.motion.motion.dispose();
});

void test('accelerometer processors reject duplicate, reordered, future, invalid and retired-epoch samples', async () => {
  const f = await fixture();
  for (const [index, definition] of [tilt, shake].entries()) {
    const processor = definition.create(f.clocks);
    const first = f.sample(100 + index * 100, { gravity: [40, 0, 0] });
    processor.process(first);
    assert.deepEqual(processor.process(first), []);
    assert.deepEqual(
      processor.process({
        ...first,
        sequence: first.sequence + 1,
        at: first.at! - 1,
      }),
      [],
    );
    assert.deepEqual(
      processor.process({
        ...first,
        sequence: first.sequence + 2,
        at: first.at! + 1,
      }),
      [],
    );
    const next = f.sample(110 + index * 100, {
      epoch: first.epoch + 1,
      sequence: 0,
    });
    processor.process(next);
    assert.deepEqual(
      processor.process({ ...first, sequence: 100, at: next.at }),
      [],
    );
    assert.deepEqual(
      processor.process({ ...next, epoch: NaN, sequence: 1 }),
      [],
    );
    processor.dispose();
  }
  f.motion.motion.dispose();
});

void test('shake preserves magnitude threshold and strict 600ms recognition cooldown', async () => {
  const f = await fixture();
  const processor = shake.create(f.clocks);
  processor.configure({ thresholdG: 1.8 });
  assert.deepEqual(processor.process(f.sample(0)), []);
  const moving = { gravity: [40, 0, 0] };
  assert.deepEqual(processor.process(f.sample(610, moving)), [
    { type: 'activation', value: 1, at: 610 },
  ]);
  assert.deepEqual(processor.process(f.sample(1210, moving)), []);
  assert.deepEqual(processor.process(f.sample(1211, moving)), [
    { type: 'activation', value: 1, at: 1211 },
  ]);
  assert.deepEqual(
    processor.process(f.sample(1300, { gravity: [NaN, 0, 0] })),
    [],
  );
  assert.deepEqual(
    processor.process(f.sample(1400, { ...moving, accelFresh: false })),
    [],
  );
  processor.dispose();
  processor.configure({ thresholdG: 0.1 });
  assert.deepEqual(processor.process(f.sample(1500, moving)), []);
  f.motion.motion.dispose();
});

void test('accelerometer definitions validate configuration, capability and semantic output', () => {
  const f = motionFixture();
  assert.equal(
    tilt.availability(f.motion.getSnapshot().capabilities).available,
    false,
  );
  assert.equal(
    shake.availability(f.motion.getSnapshot().capabilities).available,
    false,
  );
  assert.deepEqual(tilt.validateConfig({}), { ok: true, value: {} });
  assert.equal(tilt.validateConfig({ thresholdG: 1 }).ok, false);
  assert.deepEqual(shake.validateConfig({}), {
    ok: true,
    value: { thresholdG: 1.8 },
  });
  for (const invalid of [
    null,
    [],
    { thresholdG: 0 },
    { thresholdG: NaN },
    { thresholdG: 9 },
    { enabled: true },
  ])
    assert.equal(shake.validateConfig(invalid).ok, false);
  assert.equal(tilt.parseValue({ x: Infinity, y: 0 }), undefined);
  assert.equal(tilt.parseValue({ x: 1.1, y: 0 }), undefined);
  assert.deepEqual(tilt.parseValue({ x: 0.5, y: -1, extra: true }), {
    x: 0.5,
    y: -1,
  });
  assert.equal(shake.parseActivation(1.1), undefined);
  assert.equal(shake.parseActivation(1), 1);
  f.motion.dispose();
});

void test('registered swing preserves held aim, onset timestamps, release grace and rebound suppression', async () => {
  const f = await fixture();
  const processor = chop.create(f.clocks);
  processor.configure({});
  processor.process(f.sample(0));
  assert.deepEqual(processor.command({ type: 'press', down: true, at: 100 }), [
    { type: 'held', down: true },
    { type: 'aim-lock', captureAt: 0, policy: CHOP.swing },
  ]);
  assert.deepEqual(processor.process(f.sample(110, { rate: [2, 0, 0] })), []);
  assert.deepEqual(processor.command({ type: 'press', down: false, at: 120 }), [
    { type: 'held', down: false },
    { type: 'aim-release', at: 120 },
  ]);
  assert.deepEqual(processor.process(f.sample(130, { rate: [5, 0, 0] })), [
    { type: 'haptic', ms: 20 },
    { type: 'activation', value: 0.5, at: 110, capture: 'locked-aim' },
  ]);
  assert.deepEqual(processor.process(f.sample(140, { rate: [5, 0, 0] })), []);
  assert.deepEqual(processor.process(f.sample(400, { rate: [-5, 0, 0] })), []);
  assert.deepEqual(processor.process(f.sample(410, { rate: [5, 0, 0] })), []);
  processor.command({ type: 'press', down: true, at: 420 });
  processor.process(f.sample(430, { rate: [2, 0, 0] }));
  processor.command({ type: 'press', down: false, at: 440 });
  // A recognized swing outside release grace is discarded, even with an eligible onset.
  assert.deepEqual(processor.process(f.sample(591, { rate: [5, 0, 0] })), []);
  processor.dispose();
  f.motion.motion.dispose();
});

void test('registered swing cancellation, configuration retirement and disposal never activate', async () => {
  const f = await fixture();
  const processor = chop.create(f.clocks);
  processor.process(f.sample(0));
  processor.command({ type: 'press', down: true, at: 10 });
  processor.process(f.sample(20, { rate: [2, 0, 0] }));
  assert.deepEqual(processor.command({ type: 'cancel', at: 25 }), [
    { type: 'held', down: false },
    { type: 'aim-release', at: 25, immediate: true },
  ]);
  assert.deepEqual(processor.process(f.sample(30, { rate: [10, 0, 0] })), []);
  processor.command({ type: 'press', down: true, at: 40 });
  processor.reset('configuration');
  assert.deepEqual(processor.process(f.sample(50, { rate: [10, 0, 0] })), []);
  processor.dispose();
  processor.configure({});
  assert.deepEqual(
    processor.command({ type: 'press', down: true, at: 60 }),
    [],
  );
  assert.deepEqual(processor.process(f.sample(60, { rate: [10, 0, 0] })), []);
  f.motion.motion.dispose();
});

void test('registered swing retains hold across sensor epochs but rejects replayed samples', async () => {
  const f = await fixture();
  const processor = chop.create(f.clocks);
  const first = f.sample(0);
  processor.process(first);
  processor.command({ type: 'press', down: true, at: 10 });
  const next = f.sample(20, { epoch: first.epoch + 1, sequence: 0 });
  assert.deepEqual(processor.process(next), [
    { type: 'aim-lock', captureAt: 20, policy: CHOP.swing },
  ]);
  assert.deepEqual(
    processor.process({ ...first, sequence: 100, at: 20, rate: [10, 0, 0] }),
    [],
  );
  assert.deepEqual(processor.process({ ...next, rate: [10, 0, 0] }), []);
  processor.dispose();
  f.motion.motion.dispose();
});

void test('registered held swing suppresses follow-through and rearms after a return and turn', async () => {
  const f = await fixture();
  const processor = chop.create(f.clocks);
  processor.process(f.sample(0));
  processor.command({ type: 'press', down: true, at: 10 });
  assert.equal(
    processor
      .process(f.sample(20, { rate: [5, 0, 0] }))
      .some((output) => output.type === 'activation'),
    true,
  );
  assert.deepEqual(processor.process(f.sample(300, { rate: [5, 0, 0] })), []);
  assert.deepEqual(processor.process(f.sample(310, { rate: [-5, 0, 0] })), []);
  assert.equal(
    processor
      .process(f.sample(320, { rate: [5, 0, 0] }))
      .some((output) => output.type === 'activation'),
    true,
  );
  processor.dispose();
  f.motion.motion.dispose();
});

void test('registered pointer integrates each fresh sample once and preserves its aim while stale', async () => {
  const f = await fixture();
  const processor = pointer.create(f.clocks);
  const config = pointer.validateConfig({ anchor: false });
  if (!config.ok) throw new Error(config.reason);
  processor.configure(config.value);
  assert.deepEqual(processor.process(f.sample(0)), [
    { type: 'value', confidence: 1, value: { x: 0.5, y: 0.5 }, at: 0 },
  ]);
  const next = f.sample(50, { rate: [0, 0, -1] });
  const moved = processor.process(next);
  assert.equal(moved[0].type, 'value');
  if (moved[0].type !== 'value') throw new Error('Expected pointer value');
  const point = moved[0].value;
  assert.ok(typeof point === 'object' && 'x' in point && point.x > 0.5);
  assert.deepEqual(processor.process(next), []);
  assert.deepEqual(
    processor.process(f.sample(60, { pointerFresh: false })),
    [],
  );
  const resumed = f.sample(70, { epoch: next.epoch + 1, sequence: 0 });
  assert.deepEqual(processor.process(resumed), [
    { type: 'value', confidence: 1, value: point, at: 70 },
  ]);
  assert.deepEqual(processor.process({ ...next, sequence: 100, at: 70 }), []);
  processor.dispose();
  processor.configure(config.value);
  assert.deepEqual(processor.process(f.sample(80)), []);
  assert.deepEqual(processor.command({ type: 'recenter', at: 80 }), []);
  f.motion.motion.dispose();
});

void test('registered pointer handles generic aim capture, release, bounds and calibration commands', async () => {
  const f = await fixture();
  const processor = pointer.create(f.clocks);
  const config = pointer.validateConfig({
    anchor: false,
    bounds: { left: 0.2, right: 0.8, top: 0.1, bottom: 0.9 },
  });
  if (!config.ok) throw new Error(config.reason);
  processor.configure(config.value);
  processor.process(f.sample(0));
  processor.process(f.sample(50, { rate: [0, 0, -1] }));
  const locked = processor.command({
    type: 'aim-lock',
    at: 0,
    policy: CHOP.swing,
  });
  assert.deepEqual(locked, [
    { type: 'value', confidence: 1, value: { x: 0.5, y: 0.5 }, at: 0 },
  ]);
  assert.deepEqual(processor.process(f.sample(100, { rate: [0, 0, -5] })), [
    { type: 'value', confidence: 1, value: { x: 0.5, y: 0.5 }, at: 100 },
  ]);
  processor.command({ type: 'aim-release', at: 100 });
  assert.deepEqual(processor.process(f.sample(150, { rate: [0, 0, -5] })), [
    { type: 'value', confidence: 1, value: { x: 0.5, y: 0.5 }, at: 150 },
  ]);
  processor.command({ type: 'cancel', at: 150 });
  const moving = processor.process(f.sample(200, { rate: [0, 0, -5] }));
  assert.notDeepEqual(moving[0], {
    type: 'value',
    confidence: 1,
    value: { x: 0.5, y: 0.5 },
    at: 200,
  });
  assert.deepEqual(processor.command({ type: 'recenter', at: 200 }), [
    { type: 'value', confidence: 1, value: { x: 0.5, y: 0.5 }, at: 200 },
  ]);
  assert.deepEqual(
    processor.command({ type: 'sensitivity', value: 2, at: 200 }),
    [],
  );
  processor.dispose();
  f.motion.motion.dispose();
});

void test('pointer registration rejects invalid bounds, rate and semantic coordinates', () => {
  for (const config of [
    null,
    { anchor: 1 },
    { rateHz: Infinity },
    { rateHz: 0 },
    { unknown: true },
    { bounds: { left: 0, right: 0.05, top: 0, bottom: 1 } },
    { bounds: { left: -1, right: 1, top: 0, bottom: 1 } },
  ])
    assert.equal(pointer.validateConfig(config).ok, false);
  assert.deepEqual(pointer.parseValue({ x: -0.1, y: 0.5 }), {
    x: -0.1,
    y: 0.5,
  });
  assert.equal(pointer.parseValue({ x: NaN, y: 0.5 }), undefined);
  assert.deepEqual(pointer.parseValue({ x: 0.3, y: 0.4, extra: true }), {
    x: 0.3,
    y: 0.4,
  });
});
