import test from 'node:test';
import assert from 'node:assert/strict';
import { replayTilt, segmentReport } from './replay.ts';
import {
  RingBuffer,
  isMotionTrace,
  toRawSample,
  type MotionTrace,
  type RawMotionSample,
  type Vec3,
} from '../src/core/motion/trace.ts';

/** 60 Hz, phone flat and screen up, rotating at `rate` (reported order). */
function samples(from: number, seconds: number, rate: Vec3): RawMotionSample[] {
  return Array.from({ length: Math.round(seconds * 60) }, (_, i) => {
    const t = from + (i * 1000) / 60;
    return {
      t,
      at: t + 1,
      interval: 16.67,
      accel: [0, 0, 0],
      accelG: [0, 0, 9.81],
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
  // Tilt maps the reported beta channel to vertical movement.
  assert.ok(Math.abs(roll.dy) > 5, `dy ${roll.dy}`);
  assert.ok(Math.abs(roll.dx) < 0.5, `dx ${roll.dx}`);
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
