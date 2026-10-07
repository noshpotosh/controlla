import assert from 'node:assert/strict';
import { test } from 'node:test';
import { defaultCapabilities } from '../src/client/controls/resolve.ts';
import {
  controllerVector,
  jolt,
  JOLT,
  JoltProcessor,
  parseJolt,
  validateJoltConfig,
} from '../src/client/controls/motion/jolt.ts';
import type { Rotation, JoltOutput } from '../src/client/controls/api.ts';
import type { ValidatedMotionSample } from '../src/client/controls/motion/registration.ts';

function fixture(rotation: Rotation = 0) {
  let now = 0;
  let sequence = 0;
  const processor = new JoltProcessor({
    localTime: () => now,
    authorityTime: (at) => at + 1000,
  });
  processor.configure({ ...JOLT, rotation });
  const sample = (
    at: number,
    overrides: Partial<ValidatedMotionSample> = {},
  ) => {
    now = at;
    return {
      status: 'active',
      permission: 'granted',
      capabilities: defaultCapabilities(),
      epoch: 1,
      sequence: ++sequence,
      at,
      accelFresh: true,
      pointerFresh: true,
      confidence: 1,
      rateHz: 60,
      rate: [0, 0, 0],
      gravity: [0, 0, 9.81],
      up: [0, 0, 1],
      tilt: { x: 0, y: 0 },
      aim: { yaw: 0, pitch: 0, anchored: false, epoch: 1 },
      compass: { fresh: false, heading: null, accuracy: null },
      linearAcceleration: [0, 0, 0],
      ...overrides,
    } satisfies ValidatedMotionSample;
  };
  const feed = (at: number, overrides: Partial<ValidatedMotionSample> = {}) =>
    processor.process(sample(at, overrides));
  const prime = () => {
    feed(0);
    feed(60);
  };
  return { processor, sample, feed, prime };
}

void test('directional jolt validates bounded data/configuration and requires both sensors', () => {
  assert.deepEqual(validateJoltConfig({}), { ok: true, value: JOLT });
  for (const settings of [
    null,
    { triggerG: NaN },
    { rotation: 45 },
    { rearmG: 0.9 },
    { rearmRate: 3 },
    { fullG: 0.8 },
    { refractoryMs: 20 },
    { calmMs: 19 },
    { unexpected: 1 },
  ])
    assert.equal(validateJoltConfig(settings).ok, false);
  for (const value of [
    null,
    { kind: 'translation', direction: 'diagonal', strength: 1 },
    { kind: 'rotation', axis: 'x', sign: 0, strength: 1 },
    { kind: 'translation', direction: 'up', strength: Infinity },
    { kind: 'translation', direction: 'up', strength: -1 },
    { kind: 'rotation', axis: 'z', sign: 1, strength: 1.1 },
  ])
    assert.equal(parseJolt(value), undefined);
  const raw = {
    kind: 'translation',
    direction: 'up',
    strength: 0.5,
    ignored: [],
  };
  const parsed = parseJolt(raw);
  assert.deepEqual(parsed, {
    kind: 'translation',
    direction: 'up',
    strength: 0.5,
  });
  assert.notEqual(parsed, raw);
  const capabilities = defaultCapabilities();
  assert.equal(jolt.availability(capabilities).available, false);
  capabilities.sensors.accel = { present: true, permission: 'granted' };
  assert.equal(jolt.availability(capabilities).available, false);
  capabilities.sensors.gyro = { present: true, permission: 'granted' };
  assert.equal(jolt.availability(capabilities).available, true);
});

void test('translation traces resolve every cardinal direction with bounded strength and source timestamp', () => {
  for (const [vector, direction] of [
    [[30, 0, 0], 'right'],
    [[-30, 0, 0], 'left'],
    [[0, 30, 0], 'up'],
    [[0, -30, 0], 'down'],
    [[0, 0, -30], 'forward'],
    [[0, 0, 30], 'back'],
  ] as const) {
    const f = fixture();
    f.prime();
    assert.deepEqual(f.feed(80, { linearAcceleration: vector }), [
      {
        type: 'activation',
        at: 80,
        value: { kind: 'translation', direction, strength: 1 },
      },
    ]);
  }
});

void test('device-to-controller conversion honors all quarter-turns and angular handedness', () => {
  const translations = [
    [1, -2, 3],
    [2, 1, 3],
    [-1, 2, 3],
    [-2, -1, 3],
  ];
  const rates = [
    [-1, 2, -3],
    [-2, -1, -3],
    [1, -2, -3],
    [2, 1, -3],
  ];
  for (const [index, rotation] of ([0, 90, 180, 270] as const).entries()) {
    assert.deepEqual(
      controllerVector([1, 2, 3], rotation),
      translations[index],
    );
    assert.deepEqual(controllerVector([1, 2, 3], rotation, true), rates[index]);
    const f = fixture(rotation);
    f.prime();
    const value = (
      f.feed(80, { linearAcceleration: [30, 0, 0] })[0] as { value: JoltOutput }
    ).value;
    assert.equal(value.kind, 'translation');
    if (value.kind === 'translation')
      assert.equal(value.direction, ['right', 'down', 'left', 'up'][index]);
  }
  for (let axis = 0; axis < 3; axis++)
    for (const sign of [-1, 1] as const) {
      const f = fixture();
      f.prime();
      const rate: [number, number, number] = [0, 0, 0];
      rate[axis] = 10 * sign;
      const value = (f.feed(80, { rate })[0] as { value: JoltOutput }).value;
      assert.deepEqual(value, {
        kind: 'rotation',
        axis: ['x', 'y', 'z'][axis],
        sign: axis === 1 ? sign : -sign,
        strength: 1,
      });
    }
});

void test('normalized strength chooses the dominant channel and deterministic translation/axis ties', () => {
  const tie = fixture();
  tie.prime();
  assert.deepEqual(
    tie.feed(80, {
      linearAcceleration: [JOLT.triggerG * 9.81, JOLT.triggerG * 9.81, 0],
      rate: [3, 3, 0],
    })[0],
    {
      type: 'activation',
      at: 80,
      value: {
        kind: 'translation',
        direction: 'right',
        strength: JOLT.triggerG / JOLT.fullG,
      },
    },
  );
  const spin = fixture();
  spin.prime();
  const output = spin.feed(80, {
    linearAcceleration: [10, 0, 0],
    rate: [0, 9, 0],
  });
  assert.deepEqual(output[0], {
    type: 'activation',
    at: 80,
    value: { kind: 'rotation', axis: 'y', sign: 1, strength: 0.9 },
  });
});

void test('jolt requires refractory time plus consecutive calm samples and suppresses rebound', () => {
  const f = fixture();
  f.prime();
  assert.equal(f.feed(80, { linearAcceleration: [30, 0, 0] }).length, 1);
  assert.deepEqual(f.feed(100, { linearAcceleration: [-30, 0, 0] }), []);
  f.feed(120);
  f.feed(180);
  assert.deepEqual(f.feed(200, { linearAcceleration: [30, 0, 0] }), []);
  f.feed(300);
  f.feed(340);
  assert.deepEqual(f.feed(350, { linearAcceleration: [30, 0, 0] }), []);
  f.feed(400);
  f.feed(460);
  assert.equal(f.feed(480, { linearAcceleration: [30, 0, 0] }).length, 1);
});

void test('gravity fallback waits for a stable baseline and subtracts it without stationary triggers', () => {
  const f = fixture();
  for (const at of [0, 60, 120, 180, 200])
    assert.deepEqual(f.feed(at, { linearAcceleration: null }), []);
  assert.deepEqual(
    f.feed(220, { gravity: [30, 0, 9.81], linearAcceleration: null }),
    [
      {
        type: 'activation',
        at: 220,
        value: { kind: 'translation', direction: 'right', strength: 1 },
      },
    ],
  );
  const unprimed = fixture();
  assert.deepEqual(
    unprimed.feed(0, { gravity: [30, 0, 9.81], linearAcceleration: null }),
    [],
  );
  assert.deepEqual(
    unprimed.feed(60, { gravity: [30, 0, 9.81], linearAcceleration: null }),
    [],
  );
});

void test('duplicate/reordered samples, invalid data, recovery epochs, reconfiguration and disposal never activate stale jolt', () => {
  const f = fixture();
  f.prime();
  const impulse = f.sample(80, { linearAcceleration: [30, 0, 0] });
  assert.equal(f.processor.process(impulse).length, 1);
  assert.deepEqual(f.processor.process(impulse), []);
  assert.deepEqual(
    f.processor.process({ ...impulse, sequence: impulse.sequence - 1 }),
    [],
  );
  assert.deepEqual(
    f.feed(600, { epoch: 2, linearAcceleration: [30, 0, 0] }),
    [],
  );
  f.feed(620, { epoch: 2 });
  f.feed(680, { epoch: 2 });
  assert.equal(
    f.feed(700, { epoch: 2, linearAcceleration: [30, 0, 0] }).length,
    1,
  );
  assert.deepEqual(
    f.feed(720, { epoch: 2, linearAcceleration: [NaN, 0, 0] }),
    [],
  );
  assert.deepEqual(
    f.feed(740, { epoch: 2, linearAcceleration: [30, 0, 0] }),
    [],
  );
  f.processor.configure(JOLT);
  assert.deepEqual(f.feed(760, { linearAcceleration: [30, 0, 0] }), []);
  f.processor.dispose();
  f.processor.dispose();
  f.processor.configure(JOLT);
  f.processor.reset('epoch');
  for (const at of [800, 860, 880])
    assert.deepEqual(
      f.feed(at, { linearAcceleration: at === 880 ? [30, 0, 0] : [0, 0, 0] }),
      [],
    );
});

void test('freshness gaps and cancellation require calm rearming, including gyro-only onset', () => {
  const f = fixture();
  f.prime();
  assert.deepEqual(f.feed(1000, { rate: [10, 0, 0] }), []);
  f.feed(1020);
  f.feed(1080);
  f.processor.command({ type: 'cancel', at: 1080 });
  assert.deepEqual(f.feed(1100, { rate: [10, 0, 0] }), []);
  assert.deepEqual(f.feed(1120, { pointerFresh: false }), []);
  f.feed(1140);
  f.feed(1200);
  assert.equal(f.feed(1220, { rate: [10, 0, 0] }).length, 1);
  // Force local clock beyond the sample's 500 ms freshness window.
  const stale = f.sample(1240);
  f.sample(1800);
  assert.deepEqual(f.processor.process(stale), []);
});
