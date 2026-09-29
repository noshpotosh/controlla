import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  CHOP,
  ChopDetector,
  type ChopEvent,
} from '../src/client/controls/motion/chop.ts';

const STEP = 1000 / 60;
const REST = [0, 0, 9.81];

/** Feeds spin rates (rad/s about any axis) at 60 Hz, with an optional jolt per sample (g). */
function run(
  spins: number[],
  jolts: number[] = [],
  detector = new ChopDetector(),
  start = 1000,
) {
  const events: (ChopEvent & { index: number })[] = [];
  spins.forEach((spin, index) => {
    const g = 9.81 * (1 + (jolts[index] ?? 0));
    const event = detector.sample(
      [spin, 0, 0],
      [0, 0, g],
      start + index * STEP,
    );
    if (event) events.push({ ...event, index });
  });
  return { events, detector, end: start + spins.length * STEP };
}
const rest = (ms: number) => Array(Math.round(ms / STEP)).fill(0);

void test('a sharp swing fires once, dated from when it began', () => {
  const swing = [-0.8, -2, -4, -9, -6, -2, 5, 3, 0];
  const { events } = run([...rest(200), ...swing, ...rest(400)]);
  assert.equal(events.length, 1);
  const [event] = events;
  assert.equal(
    event.index,
    12 + 2,
    'fires on the first sample past the fire rate',
  );
  assert.equal(
    event.onsetAt,
    1000 + 13 * STEP,
    'the -2 sample began the swing',
  );
  assert.equal(event.strength, 4 / CHOP.fullRate);
});

void test('any direction counts: the button already freezes the aim', () => {
  for (const axis of [0, 1, 2]) {
    const detector = new ChopDetector();
    const rate = [0, 0, 0];
    rate[axis] = 5;
    assert.ok(detector.sample(rate, REST, 1000), `axis ${axis}`);
  }
  assert.equal(run([...rest(100), 2, 6, 3, 0]).events.length, 1, 'upswing too');
});

void test('a jolt with little spin still counts, like a straight downward punch', () => {
  const { events } = run(
    [...rest(100), 0.3, 0.5, 0.4, 0],
    [...rest(100), 0.4, 1.2, 0.3, 0],
  );
  assert.equal(events.length, 1);
  assert.ok(Math.abs(events[0].strength - 1.2 / CHOP.fullJolt) < 1e-9);
  // A stale accelerometer reading is ignored rather than read as a jolt.
  assert.equal(new ChopDetector().sample([0.5, 0, 0], null, 1000), null);
});

void test('gentle movement and the thumb press never fire', () => {
  assert.equal(run([...rest(100), 0.5, 1, 1.4, 2, 2.6, 1, 0]).events.length, 0);
  assert.equal(run(rest(300), [...Array(18).fill(0.3)]).events.length, 0);
});

void test('the follow-through and rebound never count as another whack', () => {
  const swing = [-2, -8, -4, 6, 4, -3, -6, -2, 0];
  assert.equal(run([...rest(100), ...swing, ...rest(300)]).events.length, 1);
  // Still moving past the refractory period doesn't re-arm.
  const held = [-2, -8, ...Array(30).fill(-4), 0];
  assert.equal(run([...rest(100), ...held]).events.length, 1);
});

void test('a second swing after the phone calms fires again', () => {
  const swing = [-2, -8, -3, 0.5, 0];
  const { events } = run([
    ...rest(100),
    ...swing,
    ...rest(CHOP.refractoryMs + 50),
    ...swing,
  ]);
  assert.equal(events.length, 2);
});

void test('settled reports when the phone is calm again, or after the cap', () => {
  const { detector, events } = run([...rest(100), -2, -8, -3]);
  const fired = events[0].at;
  assert.equal(detector.settled(fired + 10), false);
  detector.sample([0, 0, 0], REST, fired + 20);
  detector.sample([0, 0, 0], REST, fired + 90);
  assert.equal(detector.settled(fired + 90), false, 'before the minimum hold');
  detector.sample([0, 0, 0], REST, fired + CHOP.minHoldMs + 10);
  assert.equal(detector.settled(fired + CHOP.minHoldMs + 10), true);
  const moving = run([...rest(100), -2, -8, 5, 5, 5, 5]).detector;
  const at = 1000 + 7 * STEP + 5 * STEP;
  assert.equal(moving.settled(at), false);
  assert.equal(moving.settled(1000 + 7 * STEP + CHOP.maxHoldMs), true);
  assert.equal(new ChopDetector().settled(0), true, 'nothing to settle from');
});

void test('a long wind-up is dated to shortly before the swing is recognised', () => {
  const { events } = run([...rest(100), ...Array(20).fill(-2), -6, 0]);
  assert.equal(events.length, 1);
  assert.equal(events[0].at - events[0].onsetAt, CHOP.maxWindupMs);
});

void test('reset forgets a swing in progress', () => {
  const detector = new ChopDetector();
  detector.sample([-2, 0, 0], REST, 1000);
  detector.reset();
  const event = detector.sample([-8, 0, 0], REST, 5000);
  assert.ok(event);
  assert.equal(event.onsetAt, 5000);
});
