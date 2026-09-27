import test from 'node:test';
import assert from 'node:assert/strict';
import { replayTilt, segmentReport } from './replay.ts';
import { axisAngle, inverse, rotate } from '../src/core/calibration.ts';
import {
  RingBuffer,
  isMotionTrace,
  toRawSample,
  type MotionTrace,
  type RawMotionSample,
  type Vec3,
} from '../src/core/motion/trace.ts';

/** Start screen-up, then rotate with matching gravity at 60 Hz. */
function samples(
  from: number,
  seconds: number,
  rate: Vec3,
  gravitySign = 1,
): RawMotionSample[] {
  return Array.from({ length: Math.round(seconds * 60) }, (_, i) => {
    const t = from + (i * 1000) / 60;
    return {
      t,
      at: t + 1,
      interval: 16.67,
      accel: [0, 0, 0],
      // Motion rates are alpha=X, beta=Y, gamma=Z, unlike orientation angles.
      accelG: rotate(
        inverse(
          axisAngle(...rate, (Math.hypot(...rate) * Math.PI * i) / (180 * 60)),
        ),
        [0, 0, gravitySign * 9.81],
      ) as Vec3,
      rate,
    };
  });
}

const trace: MotionTrace = {
  version: 1,
  name: 'synthetic',
  recordedAt: '2026-01-01T00:00:00.000Z',
  device: { userAgent: 'test', screen: { w: 390, h: 844, dpr: 3 } },
  samples: [...samples(0, 1, [0, 0, 0]), ...samples(1000, 1, [0, 30, 0])],
  segments: [
    { label: 'still', prompt: '', start: 0, end: 999 },
    { label: 'roll', prompt: '', start: 1000, end: 2000 },
  ],
};

void test('replay runs the tilt pipeline and reports per segment', async () => {
  assert.ok(isMotionTrace(trace));
  const cursor = await replayTilt(trace);
  assert.equal(cursor.length, trace.samples.length);
  const still = segmentReport(trace, cursor, trace.segments[0]);
  assert.equal(still.excursion, 0);
  const roll = segmentReport(trace, cursor, trace.segments[1]);
  assert.equal(roll.rateChannel, 'beta');
  // Rolling side edges must not be mistaken for vertical pitch.
  assert.ok(roll.excursion < 0.5, `roll excursion ${roll.excursion}`);
});

void test('raw motion events move in all four intended directions for either gravity sign', async () => {
  const gestures: {
    name: string;
    rate: Vec3;
    axis: 'x' | 'y';
    sign: number;
  }[] = [
    { name: 'tip up', rate: [10, 0, 0], axis: 'y', sign: -1 },
    { name: 'tip down', rate: [-10, 0, 0], axis: 'y', sign: 1 },
    { name: 'turn right', rate: [0, 0, -10], axis: 'x', sign: 1 },
    { name: 'turn left', rate: [0, 0, 10], axis: 'x', sign: -1 },
  ];
  for (const gravitySign of [-1, 1]) {
    for (const { name, rate, axis, sign } of gestures) {
      const cursor = await replayTilt({
        ...trace,
        samples: samples(0, 0.5, rate, gravitySign),
        segments: [],
      });
      const end = cursor.at(-1)!;
      assert.ok(
        (end[axis] - 0.5) * sign > 0.05,
        `${name}, gravity ${gravitySign}`,
      );
      const other = axis === 'x' ? 'y' : 'x';
      assert.ok(
        Math.abs(end[other] - 0.5) < 0.001,
        `${name} must stay on its axis`,
      );
    }
  }
});

void test('replay restores the browser globals it stubs', async () => {
  const before = Object.getOwnPropertyDescriptor(performance, 'now');
  await replayTilt(trace);
  assert.deepEqual(Object.getOwnPropertyDescriptor(performance, 'now'), before);
  assert.equal((globalThis as { window?: unknown }).window, undefined);
});

void test('raw samples keep exactly what the event reported', () => {
  const s = toRawSample(
    {
      timeStamp: 12.5,
      interval: 16,
      acceleration: { x: 0.1, y: null, z: 0 },
      accelerationIncludingGravity: { x: 0, y: 0, z: 9.8 },
      rotationRate: { alpha: 1, beta: 2, gamma: 3 },
    },
    13,
  );
  assert.deepEqual(s, {
    t: 12.5,
    at: 13,
    interval: 16,
    accel: null,
    accelG: [0, 0, 9.8],
    rate: [1, 2, 3],
  });
});

void test('ring buffer keeps the most recent items in order', () => {
  const ring = new RingBuffer<number>(3);
  for (let i = 1; i <= 5; i++) ring.push(i);
  assert.deepEqual(ring.toArray(), [3, 4, 5]);
  ring.clear();
  assert.equal(ring.size, 0);
});
