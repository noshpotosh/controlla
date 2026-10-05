import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MotionSteering } from './motion-steering.mjs';

test('tilt provides proportional steering, full lock, and neutral jitter suppression', () => {
  const steering = new MotionSteering({ smoothingMs: 0 });
  assert.equal(steering.sample(0, 16), 128);
  assert.equal(steering.sample(0.01, 16), 128);
  assert.equal(steering.sample(-1, 16), 0);
  assert.equal(steering.sample(1, 16), 255);
  assert.ok(steering.sample(0.3, 16) > 128);
  assert.ok(steering.sample(0.3, 16) < 255);
});

test('recenter accommodates the held phone angle and stale samples release steering', () => {
  const steering = new MotionSteering({ smoothingMs: 0 });
  steering.recenter(0.3);
  assert.equal(steering.sample(0.3, 16), 128);
  assert.ok(steering.sample(0.6, 16) > 128);
  assert.equal(steering.sample(0.6, 16, { sampleAgeMs: 251 }), 128);
  assert.equal(steering.sample(0.6, 16, { connected: false }), 128);
  assert.equal(steering.sample(NaN, 16), 128);
});

test('smoothing has equivalent response across sample rates', () => {
  const fast = new MotionSteering();
  const slow = new MotionSteering();
  let a, b;
  for (let i = 0; i < 10; i++) a = fast.sample(0.5, 10);
  for (let i = 0; i < 5; i++) b = slow.sample(0.5, 20);
  assert.equal(a, b);
  assert.throws(() => new MotionSteering({ deadzone: 1 }), /settings/);
});
