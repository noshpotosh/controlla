import assert from 'node:assert/strict';
import test from 'node:test';
import { motionFixture as fixture } from './fixtures/motion-provider.ts';
import { defaultCapabilities } from '../src/client/controls/resolve.ts';
import type { Permission } from '../src/client/controls/api.ts';

void test('recorded motion preserves screen rotation for each sample', async () => {
  let angle = 90;
  const f = fixture(async () => 'granted', true, () => angle);
  const angles: (number | undefined)[] = [];
  f.motion.onSample(sample => angles.push(sample.screenAngle));
  await f.motion.enable();
  f.emit();
  angle = -90;
  f.emit();
  angle = NaN;
  f.emit();
  assert.deepEqual(angles, [90, -90, undefined]);
  f.motion.dispose();
});

void test('permission is single-flight; suspension wins over pending permission and diagnostics', async () => {
  let grant!: (value: Permission) => void;
  const f = fixture(
    () =>
      new Promise((resolve) => {
        grant = resolve;
      }),
  );
  const first = f.motion.enable();
  assert.equal(first, f.motion.enable());
  assert.equal(f.counts().requests, 1);
  assert.equal(f.motion.getSnapshot().status, 'requesting');
  f.motion.suspend();
  grant('granted');
  await first;
  f.motion.start();
  assert.equal(f.counts().starts, 0);
  assert.equal(f.motion.getSnapshot().status, 'suspended');
  f.motion.resume();
  assert.equal(f.counts().starts, 1);
  assert.equal(f.counts().requests, 1);
  assert.equal(f.motion.getSnapshot().status, 'waiting');
  f.motion.dispose();
});
void test('dispose permanently rejects late permission, stale event callbacks and timers', async () => {
  let grant!: (value: Permission) => void;
  const f = fixture(
    () =>
      new Promise((resolve) => {
        grant = resolve;
      }),
  );
  const pending = f.motion.enable();
  f.motion.dispose();
  grant('granted');
  await pending;
  f.motion.resume();
  f.motion.start();
  await f.motion.enable();
  assert.equal(f.counts().starts, 0);
  assert.equal(f.motion.getSnapshot().status, 'disposed');
  const g = fixture();
  await g.motion.enable();
  const stale = g.listener()!;
  let observed = 0;
  g.motion.onSample(() => {
    observed++;
  });
  g.motion.dispose();
  g.motion.dispose();
  stale({ timeStamp: 123 });
  g.advance(5000);
  assert.equal(observed, 0);
  assert.deepEqual(g.counts(), { requests: 1, starts: 1, stops: 1, timers: 0 });
});
void test('absent, denied and failed permissions do not attach listeners; explicit retry works', async () => {
  for (const permission of [
    async () => 'denied' as const,
    async () => 'unavailable' as const,
    async () => {
      throw Error('permission');
    },
  ]) {
    const f = fixture(permission, false);
    await f.motion.enable();
    assert.equal(f.motion.getSnapshot().status, 'unavailable');
    assert.equal(f.counts().starts, 0);
    f.motion.dispose();
  }
  let denied = true;
  const f = fixture(async () => (denied ? 'denied' : 'granted'));
  await f.motion.enable();
  denied = false;
  await f.motion.enable();
  assert.equal(f.counts().starts, 1);
  f.motion.dispose();
});
void test('no samples fall back after 1.8 seconds and recover automatically without another request', async () => {
  const f = fixture();
  const states: string[] = [];
  f.motion.subscribe(() => states.push(f.motion.getSnapshot().status));
  await f.motion.enable();
  f.advance(1799);
  assert.equal(f.motion.getSnapshot().status, 'waiting');
  f.advance(1);
  assert.equal(f.motion.getSnapshot().status, 'unavailable');
  f.emit();
  assert.equal(f.motion.getSnapshot().status, 'active');
  assert.equal(f.motion.capabilities.sensors.gyro.present, true);
  assert.equal(f.counts().requests, 1);
  const count = states.length;
  f.advance(10);
  f.emit();
  assert.equal(
    states.length,
    count,
    'ordinary samples do not republish status',
  );
  f.motion.dispose();
});
void test('freshness gates at 500 ms, availability at 2 seconds, and recovery resets integration timing', async () => {
  const f = fixture();
  await f.motion.enable();
  f.emit();
  const epoch = f.motion.getSnapshot().epoch;
  f.advance(499);
  assert.equal(f.motion.getSnapshot().pointerFresh, true);
  f.advance(1);
  assert.equal(f.motion.getSnapshot().pointerFresh, false);
  assert.equal(f.motion.capabilities.sensors.gyro.present, true);
  f.advance(1500);
  assert.equal(f.motion.capabilities.sensors.gyro.present, false);
  f.emit();
  assert.equal(f.motion.getSnapshot().pointerFresh, true);
  assert.ok(f.motion.getSnapshot().epoch > epoch);
  assert.equal(f.counts().requests, 1);
  f.motion.dispose();
});
void test('partial and nonfinite sensors cannot reuse old valid input', async () => {
  const f = fixture();
  await f.motion.enable();
  f.emit();
  f.advance(10);
  f.emit({ rotationRate: null });
  assert.equal(f.motion.getSnapshot().accelFresh, true);
  assert.equal(f.motion.getSnapshot().pointerFresh, false);
  assert.equal(f.motion.capabilities.sensors.gyro.present, false);
  f.emit({
    accelerationIncludingGravity: { x: NaN, y: 0, z: 0 },
    rotationRate: { alpha: 0, beta: Infinity, gamma: 0 },
  });
  assert.equal(f.motion.getSnapshot().accelFresh, false);
  assert.equal(f.motion.getSnapshot().pointerFresh, false);
  f.emit();
  assert.equal(f.motion.getSnapshot().pointerFresh, true);
  f.motion.dispose();
});
void test('suspend detaches observers from sensor delivery and invalidates old callbacks; snapshots are detached and frozen', async () => {
  const f = fixture();
  await f.motion.enable();
  f.emit();
  const snapshot = f.motion.getSnapshot(),
    stale = f.listener()!;
  assert.throws(() => {
    (snapshot.rate as number[])[0] = 123;
  });
  assert.throws(() => {
    (
      snapshot.capabilities as ReturnType<typeof defaultCapabilities>
    ).sensors.gyro.present = false;
  });
  let observations = 0;
  const off = f.motion.onSample((sample) => {
    observations++;
    sample.at = 999;
    throw Error('observer');
  });
  f.motion.suspend();
  stale({ timeStamp: 100 });
  f.advance(3000);
  assert.equal(observations, 0);
  assert.equal(f.counts().timers, 0);
  f.motion.start();
  assert.equal(f.counts().starts, 1);
  f.motion.resume();
  f.emit();
  assert.equal(observations, 1);
  assert.equal(f.motion.recentSamples().at(-1)?.at, 3000);
  assert.equal(snapshot.pointerFresh, true);
  off();
  f.emit();
  assert.equal(observations, 1);
  f.motion.dispose();
});
