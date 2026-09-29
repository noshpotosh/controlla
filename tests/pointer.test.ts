import test from 'node:test';
import assert from 'node:assert/strict';
import {
  GyroPointer,
  PointerSmoother,
} from '../src/client/controls/motion/pointer.ts';

void test('small stationary tremors are attenuated without biasing the aim', () => {
  const filter = new PointerSmoother();
  filter.sample({ x: 0.5, y: 0.5 }, 0);
  let energy = 0;
  let mean = 0;
  for (let i = 1; i <= 120; i++) {
    const p = filter.sample(
      { x: 0.5 + (i % 2 ? 0.003 : -0.003), y: 0.5 },
      (i * 1000) / 60,
    );
    energy += (p.x - 0.5) ** 2;
    mean += p.x;
  }
  assert.ok(
    Math.sqrt(energy / 120) < 0.001,
    'reduce tremor RMS by at least two thirds',
  );
  assert.ok(Math.abs(mean / 120 - 0.5) < 0.0001);
});

void test('deliberate sweeps respond quickly and settle without overshoot', () => {
  const filter = new PointerSmoother();
  filter.sample({ x: 0.2, y: 0.4 }, 0);
  let p = { x: 0.2, y: 0.4 };
  for (let i = 1; i <= 12; i++) {
    const x = 0.2 + i * 0.05;
    p = filter.sample({ x, y: 0.4 }, (i * 1000) / 60);
    assert.ok(p.x <= x && x - p.x < 0.04, 'less than one frame of sweep lag');
  }
  for (let i = 13; i <= 30; i++) {
    p = filter.sample({ x: 0.8, y: 0.4 }, (i * 1000) / 60);
    assert.ok(p.x <= 0.8);
  }
  assert.ok(Math.abs(p.x - 0.8) < 0.00001);
});

void test('display glide behaves consistently at 30, 60, 120 Hz and irregular frame intervals', () => {
  const outputs = [
    [1000 / 30, 2000 / 30, 100],
    Array.from({ length: 6 }, (_, i) => ((i + 1) * 1000) / 60),
    Array.from({ length: 12 }, (_, i) => ((i + 1) * 1000) / 120),
    [7, 23, 39, 70, 82, 100],
  ].map((times) => {
    const filter = new PointerSmoother(false);
    filter.sample({ x: 0, y: 0 }, 0);
    return times.map((at) => filter.sample({ x: 1, y: 1 }, at)).at(-1)!;
  });
  for (const p of outputs) {
    assert.ok(Math.abs(p.x - outputs[0].x) < 1e-12);
    assert.ok(p.x > 0.999 && p.x <= 1);
  }
});

void test('resets and suspension snap to fresh input; duplicate and invalid samples do not poison state', () => {
  const filter = new PointerSmoother();
  assert.deepEqual(filter.sample({ x: 0.2, y: 0.3 }, 10), { x: 0.2, y: 0.3 });
  assert.deepEqual(filter.sample({ x: 0.9, y: 0.9 }, 10), { x: 0.2, y: 0.3 });
  assert.deepEqual(filter.sample({ x: NaN, y: Infinity }, 20), {
    x: 0.2,
    y: 0.3,
  });
  assert.deepEqual(filter.sample({ x: 0.8, y: 0.7 }, 1000), { x: 0.8, y: 0.7 });
  filter.reset();
  assert.deepEqual(filter.sample({ x: 0.5, y: 0.5 }, 1010), { x: 0.5, y: 0.5 });
});

const DEG = Math.PI / 180;
const FLAT = [0, 0, 1]; // Remote grip: screen faces up.
/** Feeds a constant angular velocity at 60 Hz; returns the final point and time. */
function turn(
  pointer: GyroPointer,
  rate: number[],
  seconds: number,
  up = FLAT,
  start = 0,
) {
  const steps = Math.round(seconds * 60);
  let p = pointer.current,
    at = start;
  for (let i = 1; i <= steps; i++) {
    at = start + (i * 1000) / 60;
    p = pointer.update(rate, up, 1 / 60, at);
  }
  return { p, at };
}

void test('turning right moves right and tilting up moves up, equal in pixels', () => {
  // Clockwise seen from above is a negative rotation about the face normal.
  const right = turn(new GyroPointer(), [0, 0, -10 * DEG], 0.5).p;
  assert.ok(right.x > 0.55);
  assert.equal(right.y, 0.5);
  const up = turn(new GyroPointer(), [10 * DEG, 0, 0], 0.5).p;
  assert.ok(up.y < 0.45);
  assert.equal(up.x, 0.5);
  // Same turn rate: vertical travel is 16/9 of horizontal in screen units.
  assert.ok(Math.abs((0.5 - up.y) / (right.x - 0.5) - 16 / 9) < 1e-9);
});

void test('rolling the phone around its top edge does not move the cursor', () => {
  const p = turn(new GyroPointer(), [0, 30 * DEG, 0], 1).p;
  assert.deepEqual(p, { x: 0.5, y: 0.5 });
});

void test('holding still does not drift: small rates fall inside the dead zone', () => {
  const p = turn(new GyroPointer(), [0.2 * DEG, 0, 0.3 * DEG], 10).p;
  assert.deepEqual(p, { x: 0.5, y: 0.5 });
});

void test('the same turn moves further as a quick flick than as a slow sweep', () => {
  const slow = turn(new GyroPointer(), [0, 0, -4 * DEG], 2).p.x - 0.5,
    fast = turn(new GyroPointer(), [0, 0, -80 * DEG], 0.1).p.x - 0.5;
  // Both turn 8 degrees in total.
  assert.ok(fast > slow * 2, `flick ${fast} vs sweep ${slow}`);
});

void test('pushing past an edge re-anchors: turning back moves away at once', () => {
  const pointer = new GyroPointer(),
    { at } = turn(pointer, [0, 0, -60 * DEG], 1);
  assert.equal(pointer.current.x, 1);
  const back = turn(pointer, [0, 0, 20 * DEG], 0.1, FLAT, at).p;
  assert.ok(back.x < 0.97);
});

void test('a press aims where the cursor was before the tap and ignores its jolt', () => {
  const pointer = new GyroPointer(),
    { at } = turn(pointer, [0, 0, -10 * DEG], 0.5),
    before = pointer.current;
  // The finger arriving wobbles the phone for 30 ms before touchdown.
  const jolted = turn(pointer, [40 * DEG, 0, 40 * DEG], 0.03, FLAT, at);
  const held = pointer.holdForPress(jolted.at);
  // About 50 ms back lands before the jolt started.
  assert.ok(Math.abs(held.x - before.x) < 0.02);
  assert.ok(Math.abs(held.y - before.y) < 0.02);
  // The touch itself jolts it further; that is discarded during the hold.
  const during = turn(pointer, [40 * DEG, 0, 40 * DEG], 0.1, FLAT, jolted.at);
  assert.deepEqual(during.p, held);
});

void test('turning stays horizontal when the phone is pitched up at the screen', () => {
  // Pitched 30 degrees up: world-up leans toward the top edge in device terms.
  const up = [0, Math.sin(30 * DEG), Math.cos(30 * DEG)],
    rate = up.map((c) => c * -10 * DEG),
    p = turn(new GyroPointer(), rate, 0.5, up).p;
  assert.ok(p.x > 0.55);
  // Rotation about world-up has a small component about the right edge only if
  // up had an x part; here it has none, so y stays put.
  assert.equal(p.y, 0.5);
});

void test('recenter returns the cursor to the middle', () => {
  const pointer = new GyroPointer();
  turn(pointer, [0, 0, -30 * DEG], 1);
  pointer.recenter();
  assert.deepEqual(pointer.current, { x: 0.5, y: 0.5 });
});

void test('a hammer swing restores the aim from before it began and holds until released', () => {
  const pointer = new GyroPointer(),
    { at } = turn(pointer, [0, 0, -10 * DEG], 0.5),
    aimed = pointer.current;
  // The chop tips the phone down hard for 150 ms, diving the cursor.
  const swing = turn(pointer, [-8, 0, 0], 0.15, FLAT, at);
  assert.ok(swing.p.y > aimed.y + 0.2, 'the swing itself moves the cursor');
  const held = pointer.holdAt(at - 30, swing.at + 700);
  assert.ok(Math.abs(held.x - aimed.x) < 0.02);
  assert.ok(Math.abs(held.y - aimed.y) < 0.02);
  // The rebound swings back up: discarded while held, and a tap can't re-rewind.
  const rebound = turn(pointer, [6, 0, 0], 0.1, FLAT, swing.at);
  assert.deepEqual(rebound.p, held);
  assert.deepEqual(pointer.holdForPress(rebound.at), held);
  // Released once the phone settles, the cursor moves again from the held aim.
  pointer.release(rebound.at);
  const after = turn(pointer, [0, 0, -10 * DEG], 0.2, FLAT, rebound.at).p;
  assert.ok(after.x > held.x);
  assert.equal(after.y, held.y);
});

void test('letting go settles: the aim stays put until the lift-off jolt dies down', () => {
  const pointer = new GyroPointer(),
    settle = { rate: 30 * DEG, calmMs: 50, minMs: 120, maxMs: 400 },
    { at } = turn(pointer, [0, 0, -10 * DEG], 0.5),
    held = pointer.holdAt(at, Infinity);
  pointer.settleFrom(at, settle);
  // The thumb lifting off twists the phone at 45°/s for 200 ms: ignored.
  const jolt = turn(pointer, [45 * DEG, 0, 45 * DEG], 0.2, FLAT, at);
  assert.deepEqual(jolt.p, held);
  // Calm for 50 ms ends the hold; then aiming moves the cursor again.
  const calm = turn(pointer, [0, 0, 0], 0.06, FLAT, jolt.at);
  const after = turn(pointer, [0, 0, -20 * DEG], 0.2, FLAT, calm.at).p;
  assert.ok(after.x > held.x);
  // Motion that never calms is held for at most `maxMs`.
  const busy = new GyroPointer();
  busy.holdAt(0, Infinity);
  busy.settleFrom(0, settle);
  const early = turn(busy, [0, 0, -60 * DEG], 0.35).p;
  assert.deepEqual(early, { x: 0.5, y: 0.5 });
  assert.ok(turn(busy, [0, 0, -60 * DEG], 0.2, FLAT, 350).p.x > 0.5);
});

void test('a game can keep the cursor inside its play field', () => {
  const pointer = new GyroPointer();
  pointer.setBounds({ left: 0.1, top: 0.3, right: 0.9, bottom: 0.8 });
  const { p, at } = turn(pointer, [30 * DEG, 0, -60 * DEG], 1);
  assert.deepEqual(p, { x: 0.9, y: 0.3 });
  // Pushing past the field's edge re-anchors there, like the screen edge.
  assert.ok(turn(pointer, [0, 0, 20 * DEG], 0.1, FLAT, at).p.x < 0.87);
  pointer.recenter();
  assert.deepEqual(pointer.current, { x: 0.5, y: 0.55 });
  // Nonsense bounds fall back to the whole screen.
  pointer.setBounds({ left: 0.5, top: 0, right: 0.52, bottom: 1 });
  assert.equal(turn(pointer, [0, 0, -60 * DEG], 1).p.x, 1);
});
