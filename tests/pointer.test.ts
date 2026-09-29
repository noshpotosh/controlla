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

void test('turning past an edge is remembered: turning back returns to the same center', () => {
  // 30 degrees right runs about 11 degrees past the edge.
  const pointer = new GyroPointer(),
    { at } = turn(pointer, [0, 0, -30 * DEG], 1);
  assert.equal(pointer.current.x, 1);
  // Turning back first undoes the overshoot, leaving the cursor at the edge...
  const partway = turn(pointer, [0, 0, 30 * DEG], 0.2, FLAT, at);
  assert.equal(partway.p.x, 1);
  // ...so turning back the whole way lands on the center again.
  const back = turn(pointer, [0, 0, 30 * DEG], 0.8, FLAT, partway.at).p;
  assert.ok(Math.abs(back.x - 0.5) < 1e-9, `${back.x}`);
  assert.equal(back.y, 0.5);
});

void test('pushing far past an edge re-anchors beyond the remembered turn', () => {
  const pointer = new GyroPointer(),
    { at } = turn(pointer, [0, 0, -60 * DEG], 2);
  // Only 30 degrees of the overshoot are kept.
  const edge = turn(pointer, [0, 0, 60 * DEG], 0.45, FLAT, at);
  assert.equal(edge.p.x, 1);
  const away = turn(pointer, [0, 0, 60 * DEG], 0.15, FLAT, edge.at).p;
  assert.ok(away.x < 0.97);
  // Recenter forgets the overshoot too.
  pointer.recenter();
  turn(pointer, [0, 0, -60 * DEG], 1);
  pointer.recenter();
  assert.ok(turn(pointer, [0, 0, 20 * DEG], 0.2).p.x < 0.5);
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

const SWING = { rate: 1.5, calmMs: 60, maxMs: 400, lookbackMs: 250 };

void test('a locked aim stays put through the swing and resumes from there without a jump', () => {
  const pointer = new GyroPointer(),
    { at } = turn(pointer, [0, 0, -10 * DEG], 0.5),
    locked = pointer.lockAt(at, SWING);
  // A whack: hard down, then back up, then turning while still holding.
  const down = turn(pointer, [-8, 0, 0], 0.15, FLAT, at),
    up = turn(pointer, [6, 0, 0], 0.2, FLAT, down.at),
    held = turn(pointer, [0, 0, -20 * DEG], 0.3, FLAT, up.at);
  assert.deepEqual(held.p, locked);
  // Letting go picks up from the locked aim: nothing done meanwhile is added.
  assert.deepEqual(pointer.unlock(held.at), locked);
  assert.deepEqual(
    pointer.holdForPress(held.at),
    locked,
    'no rewind on unlock',
  );
});

void test('starting to swing as the thumb lands locks the aim from before the swing', () => {
  const pointer = new GyroPointer(),
    { at } = turn(pointer, [0, 0, -10 * DEG], 0.5),
    aimed = pointer.current;
  // The swing is 150 ms under way (and has dragged the cursor) when the press lands.
  const swing = turn(pointer, [-4, 0, 0], 0.15, FLAT, at);
  assert.ok(swing.p.y > aimed.y + 0.1);
  const locked = pointer.lockAt(swing.at - 100, SWING);
  assert.ok(Math.abs(locked.x - aimed.x) < 1e-9);
  assert.ok(Math.abs(locked.y - aimed.y) < 1e-9);
  // Aiming slowly at the press: the ordinary rewind, no further.
  const steady = new GyroPointer(),
    slow = turn(steady, [0, 0, -10 * DEG], 0.5);
  turn(steady, [0, 0, -10 * DEG], 0.1, FLAT, slow.at);
  assert.deepEqual(steady.lockAt(slow.at, SWING), slow.p);
});

void test('after unlocking, aiming counts at once while the rebound is ignored', () => {
  const pointer = new GyroPointer();
  pointer.lockAt(0, SWING);
  const start = pointer.unlock(0);
  // The swing's rebound, still under way, is ignored...
  const rebound = turn(pointer, [5, 0, 0], 0.1, FLAT, 0);
  assert.deepEqual(rebound.p, start);
  // ...but slower aiming moves the cursor straight away, with no dead time.
  const aim = turn(pointer, [0, 0, -30 * DEG], 0.05, FLAT, rebound.at);
  assert.ok(aim.p.x > start.x);
  // Once over, fast turns aim normally again.
  const calm = turn(pointer, [0, 0, 0], 0.1, FLAT, aim.at);
  assert.ok(turn(pointer, [0, 0, -3], 0.05, FLAT, calm.at).p.x > calm.p.x);
});

void test('a game can keep the cursor inside its play field', () => {
  const pointer = new GyroPointer();
  pointer.setBounds({ left: 0.1, top: 0.3, right: 0.9, bottom: 0.8 });
  const { p, at } = turn(pointer, [30 * DEG, 0, -60 * DEG], 1);
  assert.deepEqual(p, { x: 0.9, y: 0.3 });
  // Turning past the field's edge is remembered, like the screen edge.
  assert.equal(turn(pointer, [0, 0, 20 * DEG], 0.1, FLAT, at).p.x, 0.9);
  pointer.recenter();
  assert.deepEqual(pointer.current, { x: 0.5, y: 0.55 });
  // Nonsense bounds fall back to the whole screen.
  pointer.setBounds({ left: 0.5, top: 0, right: 0.52, bottom: 1 });
  assert.equal(turn(pointer, [0, 0, -60 * DEG], 1).p.x, 1);
});
