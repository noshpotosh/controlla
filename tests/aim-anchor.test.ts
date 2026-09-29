import assert from 'node:assert/strict';
import test from 'node:test';
import {
  COMPASS,
  compassHeading,
  HeadingFilter,
} from '../src/client/controls/motion/heading.ts';
import { ANCHOR } from '../src/client/controls/motion/anchor.ts';
import { GyroPointer } from '../src/client/controls/motion/pointer.ts';
import { MotionProcessor } from '../src/client/controls/motion/processor.ts';
import {
  axisAngle,
  inverse,
  multiply,
  rotate,
  identity,
  wrapAngle,
  type Quaternion,
} from '../src/client/controls/motion/calibration.ts';
import type { AimReference } from '../src/client/controls/motion/contracts.ts';
import type {
  RawMotionSample,
  RawOrientationSample,
  Vec3,
} from '../src/client/controls/motion/trace.ts';
import { motionFixture } from './fixtures/motion-provider.ts';

const DEG = Math.PI / 180;
const near = (actual: number, expected: number, tolerance: number, what = '') =>
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${what} ${actual} is not within ${tolerance} of ${expected}`,
  );

const orientation = (
  at: number,
  overrides: Partial<RawOrientationSample> = {},
): RawOrientationSample => ({
  t: at,
  at,
  alpha: null,
  beta: null,
  gamma: null,
  absolute: false,
  heading: null,
  accuracy: null,
  ...overrides,
});

void test('compass heading comes from iOS directly or from an absolute orientation', () => {
  near(
    compassHeading(orientation(0, { heading: 90, accuracy: 10 }))!,
    90 * DEG,
    1e-12,
  );
  assert.equal(
    compassHeading(orientation(0, { heading: 90, accuracy: -1 })),
    null,
  );
  // Absolute alpha turns counterclockwise from north: 90° faces west.
  near(
    compassHeading(orientation(0, { absolute: true, alpha: 90, beta: 10 }))!,
    -90 * DEG,
    1e-12,
  );
  // Tipped past vertical, the top edge faces the other way.
  near(
    Math.abs(
      compassHeading(orientation(0, { absolute: true, alpha: 0, beta: 120 }))!,
    ),
    Math.PI,
    1e-12,
  );
  assert.equal(
    compassHeading(orientation(0, { absolute: true, alpha: 0, beta: 85 })),
    null,
  );
  assert.equal(compassHeading(orientation(0, { alpha: 30, beta: 0 })), null);
});

void test('the heading filter aligns once, settles slowly and shrugs off disturbances', () => {
  const filter = new HeadingFilter();
  for (let at = 0; at <= 1000; at += 16) filter.track(at, 0.5);
  filter.fix(1000, 1.5, 10, true);
  near(filter.offset, 1, 1e-12, 'first reading aligns fully');
  assert.equal(filter.epoch, 1);
  assert.ok(filter.anchored(1000));
  // A small, steady disagreement closes over about `settleSeconds`.
  let at = 1000;
  for (; at <= 4000; at += 16) {
    filter.track(at, 0.5);
    filter.fix(at, 1.5 + 5 * DEG, 10, true);
  }
  const settled = filter.offset - 1;
  assert.ok(
    settled > 2.5 * DEG && settled < 5 * DEG,
    `settled ${settled / DEG}°`,
  );
  // Not while turning fast, nor from poorly rated readings.
  const before = filter.offset;
  filter.track(at, 0.5);
  filter.fix(at, 1.5 + 10 * DEG, 10, false);
  filter.fix(at, 1.5 + 10 * DEG, COMPASS.maxAccuracy + 1, true);
  assert.equal(filter.offset, before);
  // A brief magnetic disturbance is ignored, then heading goes unanchored...
  const disturbed = at;
  for (; at <= disturbed + 1800; at += 16) {
    filter.track(at, 0.5);
    filter.fix(at, 1.5 + 60 * DEG, 10, true);
  }
  assert.equal(filter.offset, before);
  assert.equal(filter.anchored(at), false);
  // ...and if it persists, the gyro must have lost track: re-align.
  for (; at <= disturbed + 2200; at += 16) {
    filter.track(at, 0.5);
    filter.fix(at, 1.5 + 60 * DEG, 10, true);
  }
  near(filter.offset, 1 + 60 * DEG, 1e-9);
  assert.equal(filter.epoch, 2);
  assert.ok(filter.anchored(at));
});

void test('the heading filter compares the compass with where the gyro was when it read', () => {
  const filter = new HeadingFilter();
  // The gyro turns steadily; the compass reports the same turn, late by `lagMs`.
  const yaw = (at: number) => (at / 1000) * 30 * DEG;
  for (let at = 0; at <= 3000; at += 16) {
    filter.track(at, yaw(at));
    filter.fix(at, yaw(at - COMPASS.lagMs) + 1, null, true);
  }
  near(filter.offset, 1, 0.3 * DEG, 'no pull toward the late reading');
});

/** Flat and screen up, then turned by `rate` (°/s, alpha=X, beta=Y, gamma=Z). */
function motionSamples(
  seconds: number,
  rate: Vec3,
  {
    start = 0,
    from = [...identity] as Quaternion,
    gravitySign = 1,
    reported = rate,
    compass,
  }: {
    start?: number;
    from?: Quaternion;
    gravitySign?: number;
    reported?: Vec3;
    /** Compass heading (degrees) to report at each sample time. */
    compass?: (at: number) => number;
  } = {},
) {
  const samples: RawMotionSample[] = [];
  let q = from;
  const step = axisAngle(...rate, (Math.hypot(...rate) * DEG) / 60);
  for (let i = 1; i <= Math.round(seconds * 60); i++) {
    q = multiply(q, step);
    const at = start + (i * 1000) / 60;
    samples.push({
      t: at,
      at,
      interval: 16.67,
      accel: [0, 0, 0],
      accelG: rotate(inverse(q), [0, 0, gravitySign * 9.81]) as Vec3,
      rate: reported,
      ...(compass
        ? {
            orientation: orientation(at, {
              heading: compass(at),
              accuracy: 10,
            }),
          }
        : {}),
    });
  }
  return { samples, q, end: start + Math.round(seconds * 60) * (1000 / 60) };
}

void test('aim follows the top edge: clockwise turns and tipping up, for either gravity sign', () => {
  for (const gravitySign of [-1, 1]) {
    const motion = new MotionProcessor(),
      still = motionSamples(0.5, [0, 0, 0], { gravitySign });
    for (const s of still.samples) motion.sample(s);
    const start = motion.aim;
    assert.equal(start.pitch !== null && Math.abs(start.pitch) < 1e-6, true);
    // Clockwise seen from above is a negative rotation about the face normal.
    const right = motionSamples(1, [0, 0, -20], {
      start: still.end,
      from: still.q,
      gravitySign,
    });
    for (const s of right.samples) motion.sample(s);
    near(
      wrapAngle(motion.aim.yaw! - start.yaw!),
      20 * DEG,
      0.5 * DEG,
      `sign ${gravitySign} yaw`,
    );
    const up = motionSamples(1, [20, 0, 0], {
      start: right.end,
      from: right.q,
      gravitySign,
    });
    for (const s of up.samples) motion.sample(s);
    near(motion.aim.pitch!, 20 * DEG, 0.5 * DEG, `sign ${gravitySign} pitch`);
    assert.equal(motion.aim.epoch, start.epoch, 'no jumps along the way');
    // Tipped nearly upright, the top edge has no heading.
    const steep = motionSamples(2.5, [20, 0, 0], {
      start: up.end,
      from: up.q,
      gravitySign,
    });
    for (const s of steep.samples) motion.sample(s);
    assert.equal(motion.aim.yaw, null);
    assert.ok(motion.aim.pitch! > 60 * DEG);
  }
});

void test('the compass wins back heading the gyro under-reports', () => {
  const run = (withCompass: boolean) => {
    const motion = new MotionProcessor();
    // True heading: north, then a 90° clockwise turn, then still. The gyro
    // reports only 90% of the turn; the compass reports it late.
    const truth = (at: number) =>
      Math.min(90, Math.max(0, ((at - 1000) / 1000) * 30));
    const compass = withCompass
      ? (at: number) => truth(at - COMPASS.lagMs)
      : undefined;
    const still = motionSamples(1, [0, 0, 0], { compass }),
      turn = motionSamples(3, [0, 0, -30], {
        start: still.end,
        from: still.q,
        reported: [0, 0, -27],
        compass,
      }),
      after = motionSamples(12, [0, 0, 0], {
        start: turn.end,
        from: turn.q,
        compass,
      });
    for (const s of still.samples) motion.sample(s);
    const start = motion.aim;
    for (const s of [...turn.samples, ...after.samples]) motion.sample(s);
    return { turned: wrapAngle(motion.aim.yaw! - start.yaw!), end: motion.aim };
  };
  const plain = run(false);
  assert.equal(plain.end.anchored, false);
  near(plain.turned, 81 * DEG, 0.5 * DEG, 'the gyro alone falls short');
  const anchored = run(true);
  assert.equal(anchored.end.anchored, true);
  near(anchored.end.yaw!, 90 * DEG, 1 * DEG, 'held to the compass');
  near(anchored.turned, 90 * DEG, 1 * DEG);
});

const FLAT = [0, 0, 1];
const SWING = { rate: 1.5, calmMs: 60, maxMs: 400, lookbackMs: 250 };

/** A phone in the remote grip: its true heading and elevation, and the pointer it drives. */
function phone(anchoring = true) {
  const pointer = new GyroPointer();
  pointer.anchoring = anchoring;
  const state = {
    pointer,
    at: 0,
    yaw: 0,
    pitch: 0,
    anchored: true,
    epoch: 0,
    steep: false,
    /** Turns at `rate` (rad/s, device frame) for `seconds`; the gyro reports `gyro`. */
    turn(rate: number[], seconds: number, gyro = rate) {
      const steps = Math.round(seconds * 60);
      for (let i = 0; i < steps; i++) {
        state.at += 1000 / 60;
        // Screen up: clockwise is negative about Z; tipping up is positive about X.
        state.yaw -= rate[2] / 60;
        state.pitch += rate[0] / 60;
        const aim: AimReference = {
          yaw: state.steep ? null : wrapAngle(state.yaw),
          pitch: state.pitch,
          anchored: state.anchored,
          epoch: state.epoch,
        };
        pointer.update(gyro, FLAT, 1 / 60, state.at, aim);
      }
      return pointer.current;
    },
  };
  return state;
}

void test('anchoring changes nothing until the cursor misses a turn', () => {
  const plain = new GyroPointer(),
    anchored = new GyroPointer();
  anchored.anchoring = true;
  let at = 0;
  for (const rate of [
    [0.3, 0, -0.5],
    [-0.2, 0.1, 0.4],
    [0.05, 0, 0.02],
    [0, 0, -1.2],
  ])
    for (let i = 0; i < 30; i++) {
      at += 1000 / 60;
      assert.deepEqual(
        anchored.update(rate, FLAT, 1 / 60, at),
        plain.update(rate, FLAT, 1 / 60, at),
      );
    }
});

void test('a turn left over from a locked swing is won back only while the player aims', () => {
  const run = (anchoring: boolean) => {
    const p = phone(anchoring);
    p.turn([0, 0, -10 * DEG], 0.5);
    p.pointer.lockAt(p.at, SWING);
    const locked = p.pointer.current;
    // The whack leaves the phone turned 6° further right than it began.
    p.turn([-6, 0, 0], 0.1);
    p.turn([6, 0, 0], 0.1);
    p.turn([0, 0, -30 * DEG], 0.2);
    assert.deepEqual(p.pointer.current, locked, 'the locked aim never moves');
    p.pointer.unlock(p.at);
    const released = p.turn([0, 0, 0], 1);
    assert.deepEqual(released, locked, 'a still cursor never moves by itself');
    return p;
  };
  const plain = run(false),
    anchored = run(true);
  near(anchored.pointer.drift!.x, 6 * DEG, 0.2 * DEG, 'owed turn');
  // Sweeping left and right, ending where it began.
  for (let i = 0; i < 3; i++)
    for (const p of [plain, anchored]) {
      p.turn([0, 0, -8 * DEG], 1);
      p.turn([0, 0, 8 * DEG], 1);
    }
  assert.ok(Math.abs(anchored.pointer.drift!.x) < ANCHOR.minDebt + 1e-9);
  const won = anchored.pointer.current.x - plain.pointer.current.x;
  assert.ok(won > 0.08, `won back ${won}`);
  near(anchored.pointer.current.y, plain.pointer.current.y, 1e-9);
});

void test('slow turns under the dead zone count sideways only with the compass', () => {
  for (const anchored of [true, false]) {
    const p = phone();
    p.anchored = anchored;
    const start = p.pointer.current;
    p.turn([0, 0, -0.4 * DEG], 10);
    assert.deepEqual(p.pointer.current, start, 'too slow to move the cursor');
    near(
      p.pointer.drift!.x,
      anchored ? 4 * DEG : 0,
      0.05 * DEG,
      `anchored ${anchored}`,
    );
  }
  // Gravity always anchors elevation: tipping up slowly is owed as cursor-up.
  const p = phone();
  p.anchored = false;
  p.turn([0.4 * DEG, 0, 0], 10);
  near(p.pointer.drift!.y, -4 * DEG, 0.05 * DEG);
});

void test('gyro turns hidden by a steep stretch are bridged by the reference', () => {
  const p = phone();
  p.pointer.lockAt(p.at, SWING);
  p.turn([0, 0, 0], 0.1);
  // Steep: no heading, and the gyro misses a 6° turn to the right.
  p.steep = true;
  p.turn([0, 0, -30 * DEG], 0.2, [0, 0, 0]);
  p.steep = false;
  p.turn([0, 0, 0], 0.1);
  near(p.pointer.drift!.x, 6 * DEG, 0.1 * DEG);
});

void test('jumps in the reference, re-grips and Recenter are not drift', () => {
  const p = phone();
  p.turn([0, 0, -10 * DEG], 0.5);
  // The compass re-aligned: heading jumps, with a new epoch.
  p.yaw += 30 * DEG;
  p.epoch++;
  p.turn([0, 0, 0], 0.2);
  near(p.pointer.drift!.x, 0, 1e-9);
  // Turned far away while locked: that mismatch is the player's to Recenter.
  p.pointer.lockAt(p.at, SWING);
  p.turn([0, 0, -1], 1);
  p.pointer.unlock(p.at);
  assert.ok(p.pointer.drift!.x > ANCHOR.forgive);
  p.turn([0, 0, 0], 0.5);
  const before = p.pointer.current.x;
  p.turn([0, 0, -20 * DEG], 0.5);
  const moved = p.pointer.current.x - before;
  near(p.pointer.drift!.x, 0, 1e-9);
  assert.ok(moved > 0 && moved < 0.3, `moved ${moved} like a plain turn`);
  // Recenter starts afresh.
  p.pointer.lockAt(p.at, SWING);
  p.turn([0, 0, -30 * DEG], 0.2);
  p.pointer.unlock(p.at);
  p.pointer.recenter();
  near(p.pointer.drift!.x, 0, 1e-9);
});

void test('the provider attaches the latest compass reading to the next motion sample', async () => {
  const f = motionFixture();
  await f.motion.enable();
  const seen: RawMotionSample[] = [];
  f.motion.onSample((sample) => seen.push(sample));
  f.emitOrientation({ webkitCompassHeading: 12, webkitCompassAccuracy: 5 });
  f.emitOrientation({ webkitCompassHeading: 14, webkitCompassAccuracy: 5 });
  f.emit();
  f.emit();
  assert.equal(seen[0].orientation?.heading, 14);
  assert.equal(seen[1].orientation, undefined);
  const snapshot = f.motion.getSnapshot();
  assert.deepEqual(snapshot.compass, { fresh: true, heading: 14, accuracy: 5 });
  f.advance(600);
  assert.equal(f.motion.getSnapshot().compass.fresh, false);
  // Suspension detaches orientation too; stale callbacks are ignored.
  const stale = f.orientationListener()!;
  f.motion.suspend();
  assert.equal(f.orientationListener(), null);
  stale({ timeStamp: 700, webkitCompassHeading: 99 });
  f.motion.resume();
  f.emit();
  assert.equal(seen.at(-1)?.orientation, undefined);
  assert.equal(f.motion.getSnapshot().compass.heading, null);
  f.motion.dispose();
  assert.equal(f.orientationListener(), null);
});
