import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  CHOP,
  ChopDetector,
  chopRate,
  type ChopEvent,
} from '../src/client/controls/motion/chop.ts';

const STEP = 1000 / 60;
const REMOTE = [0, 0, 1]; // Held flat like a remote: screen up.
const UPRIGHT = [0, 1, 0]; // Held upright like a hammer handle.

/** Feeds pitch rates (rad/s, negative tips the top edge down) at 60 Hz. */
function run(
  pitches: number[],
  up = REMOTE,
  detector = new ChopDetector(),
  start = 1000,
) {
  const events: (ChopEvent & { index: number })[] = [];
  pitches.forEach((pitch, index) => {
    const event = detector.sample([pitch, 0, 0], up, start + index * STEP);
    if (event) events.push({ ...event, index });
  });
  return { events, detector, end: start + pitches.length * STEP };
}
const rest = (ms: number) => Array(Math.round(ms / STEP)).fill(0);

void test('a quick downward swing fires once, dated from its onset', () => {
  const swing = [-1, -3, -6, -10, -7, -2, 5, 3, 0];
  const { events } = run([...rest(200), ...swing, ...rest(400)]);
  assert.equal(events.length, 1);
  const [event] = events;
  const onset = 12 + 1; // The -3 sample: the first past the onset rate.
  assert.equal(
    event.index,
    12 + 2,
    'fires on the first sample past the fire rate',
  );
  assert.equal(event.onsetAt, 1000 + onset * STEP);
  assert.equal(event.strength, 6 / CHOP.fullRate);
  assert.ok(event.at > event.onsetAt);
});

void test('a hard swing reports full strength', () => {
  const { events } = run([...rest(100), -2, -20, -8, 0]);
  assert.equal(events[0].strength, 1);
});

void test('slow downward aiming never fires, even if it speeds up late', () => {
  assert.equal(run([...rest(100), ...Array(40).fill(-2.5)]).events.length, 0);
  const late = [...rest(100), ...Array(25).fill(-2), -6, -8, -2, 0];
  assert.equal(run(late).events.length, 0, 'the wind-up took too long');
});

void test('upward swings and fast sideways turns never fire', () => {
  assert.equal(run([...rest(100), 3, 8, 12, 4, 0]).events.length, 0);
  const detector = new ChopDetector();
  for (let i = 0; i < 20; i++)
    // Turning about the vertical while held like a remote.
    assert.equal(detector.sample([0, 0, 9], REMOTE, 1000 + i * STEP), null);
});

void test('the rebound and wobble after a chop never count as another chop', () => {
  // Down, bounce up, a second dip before the phone has settled.
  const swing = [-3, -8, -4, 6, 4, -3, -6, -2, 0];
  assert.equal(run([...rest(100), ...swing, ...rest(300)]).events.length, 1);
  // Staying in the downswing past the refractory period doesn't re-arm.
  const held = [-3, -8, ...Array(30).fill(-6), 0];
  assert.equal(run([...rest(100), ...held]).events.length, 1);
});

void test('a second chop after the first has ended fires again', () => {
  const swing = [-3, -8, -3, 2, 0];
  const { events } = run([
    ...rest(100),
    ...swing,
    ...rest(CHOP.refractoryMs + 50),
    ...swing,
  ]);
  assert.equal(events.length, 2);
});

void test('grip does not matter: upright, flat and rolled wrists all chop', () => {
  assert.equal(run([...rest(100), -3, -8, 0], UPRIGHT).events.length, 1);
  const roll = (40 * Math.PI) / 180;
  const up = [Math.sin(roll), 0, Math.cos(roll)];
  // Rotation about the level right-hand axis, which is no longer the device x axis.
  const axis = [1 - up[0] ** 2, -up[0] * up[1], -up[0] * up[2]];
  const length = Math.hypot(...axis);
  const level = axis.map((v) => v / length);
  assert.ok(
    Math.abs(
      chopRate(
        level.map((v) => v * -8),
        up,
      ) + 8,
    ) < 1e-9,
  );
  const detector = new ChopDetector();
  const fired = [-3, -8, 0].map((rate, i) =>
    detector.sample(
      level.map((v) => v * rate),
      up,
      1000 + i * STEP,
    ),
  );
  assert.ok(fired[1], 'the rolled chop fires');
  // With the right edge pointing straight up there is no level axis; raw pitch is used.
  assert.equal(chopRate([-5, 1, 2], [1, 0, 0]), -5);
});

void test('settled releases a held cursor once the phone is calm, or after the cap', () => {
  const { detector, events } = run([...rest(100), -3, -8, -3]);
  const fired = events[0].at;
  assert.equal(detector.settled(fired + 10), false);
  // Calm samples, but not yet past the minimum hold.
  detector.sample([0, 0, 0], REMOTE, fired + 20);
  detector.sample([0, 0, 0], REMOTE, fired + 90);
  assert.equal(detector.settled(fired + 90), false);
  detector.sample([0, 0, 0], REMOTE, fired + CHOP.minHoldMs + 10);
  assert.equal(detector.settled(fired + CHOP.minHoldMs + 10), true);
  // Still moving: held until the cap.
  const moving = run([...rest(100), -3, -8, 5, 5, 5, 5]).detector;
  const at = 1000 + 7 * STEP + 5 * STEP;
  assert.equal(moving.settled(at), false);
  assert.equal(moving.settled(1000 + 7 * STEP + CHOP.maxHoldMs), true);
});

void test('reset forgets a swing in progress', () => {
  const detector = new ChopDetector();
  detector.sample([-3, 0, 0], REMOTE, 1000);
  detector.reset();
  // After a sampling gap, the old onset must not make a new downswing look slow.
  const event = detector.sample([-8, 0, 0], REMOTE, 5000);
  assert.ok(event);
  assert.equal(event.onsetAt, 5000);
});
