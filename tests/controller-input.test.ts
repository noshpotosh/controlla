import type { InputEffects } from '../src/client/runtime/controller-input/contracts.ts';
import assert from 'node:assert/strict';
import test from 'node:test';
import { ControllerInput } from '../src/client/runtime/controller-input/controller-input.ts';
import type { ControllerConfig, Widget } from '../src/client/controls/api.ts';
import type { MotionSnapshot } from '../src/client/controls/motion/contracts.ts';
import { decodeInput, type InputFrame } from '../src/client/engine/protocol.ts';

const widgets: Widget[] = [
  {
    id: 'aim',
    action: 'aim',
    type: 'aim-pad',
    label: 'Aim',
    space: 'normalized',
  },
  { id: 'other', action: 'other', type: 'stick', label: 'Other' },
  { id: 'fire', action: 'fire', type: 'button', label: 'Fire' },
  { id: 'hold', action: 'hold', type: 'hold-meter', label: 'Hold' },
  { id: 'shake', action: 'shake', type: 'shake', label: 'Shake' },
];
function configuration(): ControllerConfig {
  return {
    schemaVersion: 1,
    configId: 'test',
    generation: 1,
    orientation: 'any',
    menu: 'top-left',
    widgets: structuredClone(widgets),
    substitutions: [],
    haptics: { enabled: true },
    sensors: {
      pointer: { enabled: false, rateHz: 60 },
      tilt: { enabled: false },
      shake: { enabled: false, thresholdG: 0.1 },
      accel: { enabled: false },
    },
  };
}
function fixture(config = configuration()) {
  let now = 1000;
  const timers: { at: number; callback(): void; canceled: boolean }[] = [];
  const messages: Parameters<InputEffects['reliable']>[0][] = [],
    frames: InputFrame[] = [],
    vibrations: number[] = [];
  const input = new ControllerInput(
    {
      localTime: () => now,
      authorityTime: () => now + 100,
      schedule(callback, delay) {
        const timer = { at: now + delay, callback, canceled: false };
        timers.push(timer);
        return () => {
          timer.canceled = true;
        };
      },
    },
    {
      reliable: (message) => messages.push(message),
      frame: (data) => frames.push(decodeInput(data, now + 100)),
      haptic: (ms) => vibrations.push(ms),
    },
  );
  const motion: MotionSnapshot = {
    status: 'active',
    permission: 'granted',
    epoch: 0,
    sequence: 1,
    at: 1000,
    accelFresh: true,
    pointerFresh: true,
    confidence: 1,
    rateHz: 60,
    rate: [0, 0, 0],
    gravity: [0, 0, 9.81],
    up: [0, 0, 1],
    tilt: { x: 0.4, y: -0.3 },
    aim: { yaw: null, pitch: 0, anchored: false, epoch: 0 },
    compass: { fresh: false, heading: null, accuracy: null },
    capabilities: {
      sensors: {
        gyro: { present: true, permission: 'granted' },
        accel: { present: true, permission: 'granted' },
      },
      maxTouchPoints: 5,
      vibration: true,
      refreshRateHz: 60,
      devicePixelRatio: 1,
      safeAreaInsets: { top: 0, bottom: 0, left: 0, right: 0 },
      viewport: { w: 400, h: 800 },
    },
  };
  input.configure(config);
  input.setActive(true);
  return {
    input,
    config,
    timers,
    messages,
    frames,
    vibrations,
    motion,
    at(value: number) {
      now = value;
    },
    flush(value: number) {
      now = value;
      for (const timer of timers)
        if (!timer.canceled && timer.at <= now) {
          timer.canceled = true;
          timer.callback();
        }
    },
  };
}
void test('input captures detached source values and timestamps and flushes trailing actions independently', () => {
  const f = fixture();
  f.input.action('aim', { x: 0, y: 0 });
  f.input.action('other', { x: 1, y: 0 });
  f.at(1010);
  const value = { x: 0.8, y: 0.2 };
  f.input.action('aim', value);
  value.x = -1;
  f.at(1015);
  f.input.action('other', { x: 0, y: 0 });
  f.flush(1030);
  assert.deepEqual(
    f.messages
      .filter((m) => m.type === 'widget')
      .map((m) => [m.action, m.seq, m.time, m.value]),
    [
      ['aim', 0, 1100, { x: 0, y: 0 }],
      ['other', 0, 1100, { x: 1, y: 0 }],
      ['aim', 1, 1110, { x: 0.8, y: 0.2 }],
      ['other', 1, 1115, { x: 0, y: 0 }],
    ],
  );
});
void test('retired timer cannot flush a new pending value for the same action', () => {
  const f = fixture();
  f.input.action('aim', { x: 0, y: 0 });
  f.at(1010);
  f.input.action('aim', { x: 1, y: 0 });
  const old = f.timers[0];
  f.input.setActive(false);
  f.input.setActive(true);
  f.input.action('aim', { x: 0, y: 0 });
  f.at(1015);
  f.input.action('aim', { x: -1, y: 0 });
  old.callback();
  assert.equal(f.messages.length, 2);
  f.flush(1040);
  assert.equal(f.messages.length, 3);
});
void test('configuration identity retires ports and resets sequences while repeated configuration preserves ports', () => {
  const f = fixture();
  const port = f.input.portFor(widgets[0], 1);
  f.input.configure(f.config);
  port.value({ x: 0, y: 0 });
  assert.equal(f.messages.length, 1);
  f.input.configure({ ...f.config, configId: 'replacement' });
  port.value({ x: 1, y: 1 });
  port.haptic();
  assert.equal(f.messages.length, 1);
  assert.equal(f.vibrations.length, 0);
  f.input.action('aim', { x: -1, y: 0 });
  assert.equal(f.messages.filter((m) => m.type === 'widget').at(-1)!.seq, 0);
  f.input.configure({ ...f.config, generation: 2 });
  f.input.action('aim', { x: 1, y: 0 }, 1);
  assert.equal(f.messages.length, 2);
});
void test('suspension clears held input and permanently retires ports but keeps same-generation sequences', () => {
  const f = fixture();
  const port = f.input.portFor(widgets[0], 1);
  port.value({ x: 1, y: 1 });
  f.input.press('fire', true);
  f.input.setActive(false);
  f.input.tick(f.motion);
  assert.equal(f.frames.length, 0);
  f.input.setActive(true);
  port.value({ x: -1, y: -1 });
  port.haptic();
  f.input.action('aim', { x: 0, y: 0 });
  f.input.tick(f.motion);
  assert.equal(f.frames[0].buttons, 0);
  assert.equal(f.vibrations.length, 0);
  assert.equal(f.messages.filter((m) => m.type === 'widget').at(-1)!.seq, 1);
});
void test('end and dispose are idempotent terminal barriers for timers, controls, frames and haptics', () => {
  for (const terminal of ['end', 'dispose'] as const) {
    const f = fixture();
    const port = f.input.portFor(widgets[0], 1);
    port.value({ x: 0, y: 0 });
    f.at(1010);
    port.value({ x: 1, y: 0 });
    f.input[terminal]();
    const state = f.input.getSnapshot();
    f.input[terminal]();
    f.input.configure({ ...f.config, generation: 2 });
    f.input.setActive(true);
    f.input.action('aim', { x: -1, y: 0 });
    f.input.press('fire', true);
    f.input.haptic();
    port.value({ x: 0, y: 1 });
    port.haptic();
    f.timers[0].callback();
    f.input.tick(f.motion);
    f.input.recenter();
    f.input.setSensitivity(4);
    f.input.setPoint({ x: 1, y: 1 });
    assert.deepEqual(f.input.getSnapshot(), state);
    assert.equal(f.messages.length, 1);
    assert.equal(f.frames.length, 0);
    assert.equal(f.vibrations.length, 0);
  }
});
void test('press edges deduplicate, wrap, and carry captured activation values', () => {
  const f = fixture();
  f.input.press('hold', true);
  assert.equal(f.messages.length, 0);
  f.input.action('hold', { charge: 0.7, released: true });
  f.input.press('hold', true);
  f.input.press('hold', true);
  f.input.press('hold', false);
  const held = f.messages.find((m) => m.type === 'press');
  assert.ok(held && held.type === 'press');
  assert.deepEqual(held.press.value, { charge: 0.7, released: true });
  f.input.action('hold', { charge: 0.1, released: true });
  assert.deepEqual(held.press.value, { charge: 0.7, released: true });
  for (let n = 0; n < 256; n++) {
    f.input.press('fire', true);
    f.input.press('fire', true);
    f.input.press('fire', false);
  }
  const presses = f.messages.filter((m) => m.type === 'press');
  assert.equal(presses.length, 257);
  assert.equal(presses.at(-1)!.press.counter, 0);
});
void test('binary cadence stays at 60Hz, wraps sequences, and skips missed frames', () => {
  const f = fixture();
  for (let at = 1000; at < 2000; at += 8) {
    f.at(at);
    f.input.tick(f.motion);
  }
  assert.ok(f.frames.length >= 59 && f.frames.length <= 61);
  const before = f.frames.length;
  f.at(10000);
  f.input.tick(f.motion);
  f.input.tick(f.motion);
  assert.equal(f.frames.length, before + 1);
  for (let n = before + 1; n <= 65536; n++) {
    f.at(10000 + n * 20);
    f.input.tick(f.motion);
  }
  assert.equal(f.frames.at(-1)!.seq, 0);
});
void test('motion freshness neutralizes tilt and consumes each shake sample only once', () => {
  const config = configuration();
  config.sensors.tilt.enabled = true;
  config.sensors.shake.enabled = true;
  const f = fixture(config);
  const motion = { ...f.motion, gravity: [0, 0, 20] };
  f.input.tick(motion);
  assert.ok(Math.abs(f.frames[0].x - 0.4) < 0.001);
  f.at(1700);
  f.input.tick({ ...motion, accelFresh: false });
  assert.equal(f.frames.at(-1)!.x, 0);
  assert.equal(f.frames.at(-1)!.confidence, 0);
  f.at(2400);
  f.input.tick(motion);
  assert.equal(f.messages.filter((m) => m.type === 'press').length, 1);
});
void test('recentering makes the current tilt level', () => {
  const config = configuration();
  config.sensors.tilt.enabled = true;
  const f = fixture(config);
  f.input.tick(f.motion);
  assert.ok(Math.abs(f.frames.at(-1)!.x - 0.4) < 0.001);
  f.input.recenter();
  f.at(1700);
  f.input.tick(f.motion);
  assert.ok(Math.abs(f.frames.at(-1)!.x) < 0.001);
  assert.ok(Math.abs(f.frames.at(-1)!.y) < 0.001);
  // Tipping further from the new level still reads, clamped to the unit range.
  f.at(2400);
  f.input.tick({ ...f.motion, tilt: { x: -0.9, y: 0.9 } });
  assert.equal(f.frames.at(-1)!.x, -1);
  assert.equal(f.frames.at(-1)!.y, 1);
});
void test('pointer sampling and recovery preserve position, press anchoring and player settings', () => {
  const config = configuration();
  config.sensors.pointer.enabled = true;
  const f = fixture(config);
  f.input.setSensitivity(3);
  f.input.tick(f.motion);
  for (let n = 1; n <= 10; n++) {
    f.at(1000 + n * 20);
    f.input.tick({
      ...f.motion,
      at: 1000 + n * 20,
      sequence: n + 1,
      rate: [0.5, 0, 0],
    });
  }
  const moved = f.input.previewPoint();
  assert.notDeepEqual(moved, { x: 0.5, y: 0.5 });
  f.at(1230);
  f.input.tick({ ...f.motion, at: 1200, sequence: 11, pointerFresh: false });
  assert.deepEqual(f.input.previewPoint(), moved);
  f.input.setActive(false);
  f.input.setActive(true);
  f.at(4000);
  f.input.tick({
    ...f.motion,
    epoch: 1,
    at: 4000,
    sequence: 12,
    rate: [0.5, 0, 0],
  });
  assert.deepEqual(f.input.previewPoint(), moved);
  f.input.press('fire', true);
  const press = f.messages.find((m) => m.type === 'press');
  assert.ok(press && press.type === 'press');
  assert.deepEqual(
    { x: press.press.x, y: press.press.y },
    f.input.previewPoint(),
  );
  assert.equal(f.input.getSnapshot().sensitivity, 3);
  f.input.recenter();
  assert.equal(f.input.getSnapshot().recenters, 1);
  assert.deepEqual(f.input.previewPoint(), { x: 0.5, y: 0.5 });
});
void test('configuration and status cannot be mutated through caller-owned objects', () => {
  const f = fixture();
  f.config.widgets[0].action = 'changed';
  f.input.action('aim', { x: 1, y: 1 });
  assert.equal(f.messages.length, 1);
  const state = f.input.getSnapshot();
  assert.ok(Object.isFrozen(state) && Object.isFrozen(state.point));
  const point = f.input.previewPoint();
  point.x = -1;
  assert.equal(f.input.previewPoint().x, 1);
});

void test('configuration and aim settings remain input-owned detached projections', () => {
  const h = fixture();
  const config = h.input.getConfiguration()!;
  config.widgets.length = 0;
  assert.notEqual(h.input.getConfiguration()!.widgets.length, 0);
  assert.equal(
    h.input.configure({
      ...configuration(),
      schemaVersion: 99,
    } as unknown as ControllerConfig),
    false,
  );
  assert.equal(h.input.getConfiguration()!.schemaVersion, 1);
  h.input.beginAdjustAim();
  assert.equal(h.input.getSnapshot().adjustingAim, true);
  h.input.finishAdjustAim();
  assert.equal(h.input.getSnapshot().adjustingAim, false);
  h.input.dispose();
  h.input.beginAdjustAim();
  assert.equal(h.input.getSnapshot().adjustingAim, false);
  assert.equal(h.input.configure(configuration()), false);
});
function swingFixture(config = configuration()) {
  config.sensors.pointer.enabled = true;
  config.sensors.chop = { enabled: true };
  config.widgets = [
    {
      id: 'aim',
      action: 'aim',
      type: 'pointer',
      label: 'Aim',
      space: 'normalized',
    },
    { id: 'whack', action: 'whack', type: 'chop', label: 'Whack' },
  ];
  const f = fixture(config);
  let at = 1000,
    sequence = 1;
  const sample = (rate: number[], gravity = [0, 0, 9.81]) => {
    at += 16;
    sequence++;
    f.at(at);
    f.input.tick({ ...f.motion, at, sequence, rate, gravity });
  };
  const presses = () => f.messages.filter((m) => m.type === 'press');
  return { ...f, sample, presses, now: () => at };
}

void test('without the swing button held, motion only aims and never whacks', () => {
  const f = swingFixture();
  for (let i = 0; i < 6; i++) f.sample([0, 0, 0]);
  const before = f.input.previewPoint();
  for (const pitch of [-3, -8, -3, 0]) f.sample([pitch, 0, 0]);
  assert.equal(f.presses().length, 0);
  assert.notDeepEqual(f.input.previewPoint(), before, 'the swing aims');
  assert.equal(f.input.getSnapshot().chops, 0);
});

void test('holding the swing button freezes the aim, and a swing whacks there', () => {
  const f = swingFixture();
  // Aim right, then hold still.
  for (let i = 0; i < 12; i++) f.sample([0, 0, -0.4]);
  for (let i = 0; i < 6; i++) f.sample([0, 0, 0]);
  const aimed = f.input.previewPoint();
  assert.ok(aimed.x > 0.55);
  // The thumb press jolts the phone; the aim comes from just before it.
  f.sample([0, 0, -2]);
  f.input.holdAim(true);
  assert.equal(f.input.getSnapshot().aimHeld, true);
  assert.ok(Math.abs(f.input.previewPoint().x - aimed.x) < 0.01);
  // Waving the phone around while held never moves the aim.
  for (let i = 0; i < 4; i++) f.sample([0.6, 0.5, -0.6]);
  assert.equal(f.presses().length, 0, 'gentle motion is not a swing');
  const onset = f.now() + 16;
  for (const rate of [
    [-2, 0.5, 0],
    [-9, 1, 0],
  ])
    f.sample(rate);
  const [press] = f.presses();
  assert.ok(press && press.type === 'press');
  assert.ok(Math.abs(press.press.x - aimed.x) < 0.01);
  assert.ok(Math.abs(press.press.y - aimed.y) < 0.01);
  // Authority time runs 100 ms ahead of local time in this fixture.
  assert.equal(press.press.time, onset + 100);
  assert.ok(
    Math.abs((press.press.value as number) - Math.hypot(9, 1) / 10) < 1e-9,
  );
  assert.deepEqual(f.vibrations, [20]);
  assert.equal(f.input.getSnapshot().chops, 1);
  // The rebound neither moves the aim nor whacks again.
  for (const pitch of [6, 4, -3, 0]) f.sample([pitch, 0, 0]);
  assert.equal(f.presses().length, 1);
  assert.deepEqual(f.input.previewPoint(), {
    x: press.press.x,
    y: press.press.y,
  });
  // A second swing while still held whacks again at the same aim.
  for (let i = 0; i < 20; i++) f.sample([0, 0, 0]);
  for (const pitch of [-2, -7, 0]) f.sample([pitch, 0, 0]);
  assert.equal(f.presses().length, 2);
  // Released and settled: aiming works again from where it was.
  f.input.holdAim(false);
  for (let i = 0; i < 12; i++) f.sample([0, 0, 0]);
  for (let i = 0; i < 6; i++) f.sample([0, 0, -0.4]);
  assert.ok(f.input.previewPoint().x > press.press.x);
});

void test('a punch-like jolt whacks, and releasing mid-swing ignores the rebound', () => {
  const f = swingFixture();
  for (let i = 0; i < 6; i++) f.sample([0, 0, 0]);
  f.input.holdAim(true);
  const held = f.input.previewPoint();
  f.sample([0.2, 0, 0], [0, 0, 9.81 * 1.4]);
  f.sample([0.3, 0, 0], [0, 0, 9.81 * 2.2]);
  assert.equal(f.presses().length, 1);
  const [press] = f.presses();
  assert.ok(press.type === 'press');
  assert.deepEqual({ x: press.press.x, y: press.press.y }, held);
  // Let go straight away while the phone is still swinging back.
  f.input.holdAim(false);
  const released = f.input.previewPoint();
  f.sample([6, 0, 0]);
  f.sample([5, 0, 0]);
  assert.deepEqual(f.input.previewPoint(), released, 'the rebound is ignored');
  for (let i = 0; i < 12; i++) f.sample([0, 0, 0]);
  for (let i = 0; i < 6; i++) f.sample([0.6, 0, 0]);
  assert.notDeepEqual(f.input.previewPoint(), held, 'settled, aiming again');
  assert.equal(f.presses().length, 1);
});

void test('the swing button does nothing unless the host enables chop, and retiring lets go', () => {
  const config = configuration();
  config.sensors.pointer.enabled = true;
  config.widgets = [
    { id: 'whack', action: 'whack', type: 'chop', label: 'Whack' },
  ];
  const f = fixture(config);
  f.input.holdAim(true);
  assert.equal(f.input.getSnapshot().aimHeld, false);
  for (const [i, pitch] of [-3, -8, -3].entries())
    f.input.tick({
      ...f.motion,
      at: 1016 + i * 16,
      sequence: i + 2,
      rate: [pitch, 0, 0],
    });
  assert.equal(f.messages.filter((m) => m.type === 'press').length, 0);
  const swing = swingFixture();
  swing.input.holdAim(true);
  swing.input.setActive(false);
  assert.equal(swing.input.getSnapshot().aimHeld, false);
});

void test('a swing recognised just after letting go still whacks, but a later one does not', () => {
  const f = swingFixture();
  for (let i = 0; i < 6; i++) f.sample([0, 0, 0]);
  f.input.holdAim(true);
  const held = f.input.previewPoint();
  // The thumb lifts as the swing begins; it is recognised a sample later.
  f.sample([-2, 0, 0]);
  f.input.holdAim(false);
  f.sample([-8, 0, 0]);
  assert.equal(f.presses().length, 1);
  const [press] = f.presses();
  assert.ok(press.type === 'press');
  assert.deepEqual({ x: press.press.x, y: press.press.y }, held);
  // A swing that starts after letting go only aims.
  for (let i = 0; i < 30; i++) f.sample([0, 0, 0]);
  for (const pitch of [-2, -8, 0]) f.sample([pitch, 0, 0]);
  assert.equal(f.presses().length, 1);
});

void test('frames show the swing button held while the aim is locked', () => {
  const f = swingFixture();
  const buttons = () => {
    for (let i = 0; i < 4; i++) f.sample([0, 0, 0]);
    return f.frames.at(-1)!.buttons;
  };
  assert.equal(buttons(), 0);
  f.input.holdAim(true);
  // The chop is the only press control, so it owns slot 0.
  assert.equal(buttons(), 1);
  f.input.holdAim(false);
  assert.equal(buttons(), 0);
});

void test('only a configuration that opts in anchors aim, winning back a turn made while locked', () => {
  const run = (anchor: boolean) => {
    const config = configuration();
    if (anchor) config.sensors.pointer.anchor = true;
    const f = swingFixture(config);
    for (let i = 0; i < 6; i++) f.sample([0, 0, 0]);
    f.input.holdAim(true);
    // Turning right while the aim is locked.
    for (let i = 0; i < 10; i++) f.sample([0, 0, -0.6]);
    f.input.holdAim(false);
    for (let i = 0; i < 10; i++) f.sample([0, 0, 0]);
    const released = f.input.previewPoint();
    for (let i = 0; i < 10; i++) f.sample([0, 0, -0.4]);
    return { released, aimed: f.input.previewPoint() };
  };
  const plain = run(false),
    anchored = run(true);
  assert.deepEqual(anchored.released, plain.released, 'no jump on release');
  assert.ok(
    anchored.aimed.x > plain.aimed.x,
    `anchored ${anchored.aimed.x} vs ${plain.aimed.x}`,
  );
});

void test('the host can keep the pointer inside the play field', () => {
  const config = configuration();
  config.sensors.pointer.bounds = {
    left: 0.1,
    top: 0.3,
    right: 0.9,
    bottom: 0.8,
  };
  const f = swingFixture(config);
  for (let i = 0; i < 60; i++) f.sample([1, 0, -2]);
  const p = f.input.previewPoint();
  assert.ok(Math.abs(p.x - 0.9) < 1e-6 && Math.abs(p.y - 0.3) < 1e-6);
  f.input.recenter();
  assert.deepEqual(f.input.previewPoint(), { x: 0.5, y: 0.55 });
});
