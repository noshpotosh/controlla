import test from 'node:test';
import assert from 'node:assert/strict';
import { PointerSmoother } from '../src/core/pointer.ts';

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
