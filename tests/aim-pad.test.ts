import assert from 'node:assert/strict';
import test from 'node:test';
import { AimPadInput, aimPadVector } from '../src/controls/aim-pad/logic.ts';
import { aimPad } from '../src/controls/aim-pad/definition.ts';
import {
  channelOf,
  definitionFor,
  usesPressSlot,
} from '../src/controls/registry.ts';
import { views } from '../src/controls/views.ts';
import { screenPort } from '../src/controls/ControllerSurface.tsx';
import { parseControlValue } from '../src/controls/value.ts';
import { isControllerLayout } from '../src/controls/layout/schema.ts';
import {
  checkAssignment,
  validateLayout,
} from '../src/controls/layout/validate.ts';
import { layouts } from '../src/layouts/index.ts';
import { defaultCapabilities, resolveConfig } from '../src/core/config.ts';
import type { Manifest, Widget } from '../src/core/types.ts';
import type { ControlPort, Vector } from '../src/controls/types.ts';

void test('absolute aim fills every corner of a rectangular pad without radial clamping', () => {
  const size = { width: 300, height: 180 };
  for (const [x, y, expected] of [
    [0, 0, { x: -1, y: -1 }],
    [300, 0, { x: 1, y: -1 }],
    [0, 180, { x: -1, y: 1 }],
    [300, 180, { x: 1, y: 1 }],
    [150, 90, { x: 0, y: 0 }],
    [225, 45, { x: 0.5, y: -0.5 }],
  ] as const)
    assert.deepEqual(aimPadVector({ ...size, x, y }), expected);
  assert.deepEqual(aimPadVector({ ...size, x: -500, y: 900 }), { x: -1, y: 1 });
  assert.equal(aimPadVector({ ...size, width: 0, x: 0, y: 0 }), null);
  assert.equal(aimPadVector({ ...size, x: NaN, y: 0 }), null);
});

void test('release, cancellation and old-pad cleanup retain aim without activation or center jumps', () => {
  const values: Vector[] = [];
  let presses = 0;
  const port: ControlPort = {
    value: (value) => values.push(value as Vector),
    press: () => presses++,
    haptic() {},
  };
  const pad = new AimPadInput(port.value);
  assert.deepEqual(pad.point(), { x: 0, y: 0 });
  assert.deepEqual(values, [], 'mounting does not overwrite an accepted value');
  pad.move({ x: 90, y: 20, width: 100, height: 100 });
  assert.deepEqual(pad.point(), { x: 0.8, y: -0.6 });
  pad.end(); // normal release
  pad.end(); // cancellation / lost capture, using the same shared kit end callback
  pad.move({ x: 0, y: 0, width: 0, height: 100 });
  assert.deepEqual(values, [{ x: 0.8, y: -0.6 }]);
  const replacement = new AimPadInput(port.value);
  replacement.move({ x: 10, y: 80, width: 100, height: 100 });
  pad.end(); // late old-instance unmount must not reset the replacement's input
  assert.deepEqual(values.at(-1), { x: -0.8, y: 0.6 });
  assert.equal(values.length, 2);
  assert.equal(presses, 0);
  const reading = replacement.point();
  reading.x = 99;
  assert.deepEqual(replacement.point(), { x: -0.8, y: 0.6 });
});

void test('keyboard aim moves and holds in square coordinates; only Home explicitly centers it', () => {
  const values: Vector[] = [];
  const pad = new AimPadInput((point) => values.push(point));
  assert.equal(pad.key('Enter'), false);
  assert.equal(pad.key('constructor'), false);
  assert.equal(pad.key(' '), false);
  for (let i = 0; i < 20; i++) {
    pad.key('ArrowRight');
    pad.key('ArrowDown');
  }
  assert.deepEqual(pad.point(), { x: 1, y: 1 });
  pad.end();
  assert.deepEqual(pad.point(), { x: 1, y: 1 });
  assert.equal(pad.key('Home'), true);
  assert.deepEqual(values.at(-1), { x: 0, y: 0 });
});

void test('the existing screen port rotates aim output and leaves a separate pulse button independent', () => {
  const readings: Record<string, unknown> = {};
  let pulseCount = 0,
    held = false;
  const aim: Widget = {
    id: 'aim',
    action: 'aim',
    label: 'Aim',
    type: 'aim-pad',
  };
  for (const [rotation, expected] of [
    [0, { x: 1, y: -1 }],
    [90, { x: 1, y: 1 }],
    [180, { x: -1, y: 1 }],
    [270, { x: -1, y: -1 }],
  ] as const) {
    const port = screenPort(
      { ...aim, rotation },
      {
        value: (value) => {
          readings.aim = value;
        },
        press: () => assert.fail('aim must not activate a press slot'),
        haptic() {},
      },
    );
    const pad = new AimPadInput(port.value);
    pad.move({ x: 100, y: 0, width: 100, height: 100 });
    assert.deepEqual(readings.aim, expected);
    const pulse: ControlPort = {
      value: () => assert.fail('button is press-only'),
      press(down) {
        if (down && !held) pulseCount++;
        held = down;
      },
      haptic() {},
    };
    pulse.press(true);
    pulse.press(false);
    pad.end();
    assert.deepEqual(
      readings.aim,
      expected,
      'pulse and release do not change aim',
    );
  }
  assert.equal(pulseCount, 4);
  assert.equal(held, false);
  const unchanged: Vector[] = [],
    rotated: Vector[] = [];
  const pad = new AimPadInput((value) => unchanged.push(value));
  pad.move({ x: 100, y: 0, width: 100, height: 100 });
  const newPort = screenPort(
    { ...aim, rotation: 90 },
    {
      value: (value) => rotated.push(value as Vector),
      press() {},
      haptic() {},
    },
  );
  pad.setEmitter(newPort.value);
  assert.deepEqual(
    pad.point(),
    { x: 1, y: -1 },
    'changing a designer port does not reset aim',
  );
  assert.deepEqual(
    rotated,
    [],
    'rotation alone does not invent an input sample',
  );
  pad.move({ x: 100, y: 100, width: 100, height: 100 });
  assert.deepEqual(rotated, [{ x: -1, y: 1 }]);
  assert.equal(unchanged.length, 1, 'subsequent input uses the updated port');
});

void test('aim pad is registered as a validated signed vector and aim-and-pulse is a valid pointer fallback layout', () => {
  assert.equal(definitionFor('aim-pad'), aimPad);
  assert.ok(views['aim-pad']);
  assert.deepEqual(channelOf('aim-pad'), {
    channel: 'value',
    throttle: true,
    drivesPointer: true,
  });
  assert.equal(usesPressSlot('aim-pad'), false);
  assert.deepEqual(parseControlValue('aim-pad', { x: -1, y: 1 }), {
    x: -1,
    y: 1,
  });
  assert.equal(parseControlValue('aim-pad', { x: 1.1, y: 0 }), undefined);
  assert.equal(parseControlValue('aim-pad', { x: 0, y: Infinity }), undefined);
  const layout = JSON.parse(JSON.stringify(layouts['aim-and-pulse']));
  assert.ok(isControllerLayout(layout));
  assert.deepEqual(validateLayout(layout), []);
  const manifest: Manifest = {
    id: 'aim-pad-fixture',
    name: 'Aim pad fixture',
    players: { min: 1, max: 8 },
    inputs: {
      aim: { required: true, prefer: 'pointer', fallback: 'aim-pad' },
      pulse: { required: true, prefer: 'button' },
    },
    controller: { layout: 'aim-and-pulse' },
    expectedDurationSec: 30,
    scoring: 'points',
    onPlayerDropped: 'freeze',
    retroactiveInput: false,
    interpolatable: [],
    discrete: [],
  };
  assert.deepEqual(checkAssignment(manifest, layout), []);
  const touch = resolveConfig(manifest, defaultCapabilities(), 4);
  assert.deepEqual(
    touch.widgets.map((widget) => [widget.action, widget.type, widget.label]),
    [
      ['aim', 'aim-pad', 'Aim'],
      ['pulse', 'button', 'PULSE'],
    ],
  );
  assert.equal(touch.widgets[0].space, 'normalized');
  assert.deepEqual(touch.substitutions, ['aim: pointer → aim-pad']);
  const motion = defaultCapabilities();
  motion.sensors.gyro = motion.sensors.accel = {
    present: true,
    permission: 'granted',
  };
  assert.equal(resolveConfig(manifest, motion, 5).widgets[0].type, 'pointer');
});
