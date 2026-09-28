import { pointerSpec, steeringSpec } from './fixtures/games.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  channelOf,
  definitions,
  definitionFor,
  PRESS_SLOTS,
  usesPressSlot,
} from '../src/client/controls/registry.ts';
import { views } from '../src/client/controls/views.ts';
import type { LayoutPreset } from '../src/client/controls/api.ts';
import {
  assignSlots,
  defaultLayout,
  LAYOUTS,
} from '../src/client/controls/layouts.ts';
import {
  deadzone,
  radialClamp,
  snapDirection,
} from '../src/client/controls/kit/geometry.ts';
import { dpadDirection } from '../src/client/controls/dpad/logic.ts';
import {
  clampOrigin,
  stickVector,
} from '../src/client/controls/stick/logic.ts';
import { classifySwipe } from '../src/client/controls/swipe-pad/logic.ts';
import { chargeAt } from '../src/client/controls/hold-meter/logic.ts';
import {
  defaultCapabilities,
  resolveConfig,
} from '../src/client/controls/resolve.ts';
import { layouts } from '../src/client/controls/layouts/index.ts';
import { emptyLayout } from '../src/client/controls/layout/schema.ts';

void test('every library control has one definition and a view', () => {
  const types = definitions.map((d) => d.type);
  assert.equal(new Set(types).size, types.length, 'duplicate control type');
  for (const d of definitions) {
    assert.ok(views[d.type], `${d.type} has no view in views.ts`);
    assert.equal(definitionFor(d.type), d);
    assert.ok(d.displayName && d.description && d.output, `${d.type} docs`);
  }
  for (const type of Object.keys(views))
    assert.ok(
      definitionFor(type as never),
      `${type} has a view but no definition`,
    );
});

void test('channels drive press slots and throttling', () => {
  assert.equal(usesPressSlot('button'), true);
  assert.equal(usesPressSlot('swipe-pad'), true);
  assert.equal(usesPressSlot('hold-meter'), true);
  assert.equal(usesPressSlot('stick'), false);
  assert.equal(usesPressSlot('dpad'), false);
  assert.equal(usesPressSlot('shake'), true, 'legacy shake keeps its edge');
  assert.equal(channelOf('stick').throttle, true);
  assert.equal(channelOf('dpad').throttle, false);
  assert.equal(channelOf('stick').drivesPointer, true);
});

void test('geometry: clamp, dead zone and direction snapping', () => {
  assert.deepEqual(radialClamp({ x: 3, y: 4 }), { x: 0.6, y: 0.8 });
  assert.deepEqual(deadzone({ x: 0.05, y: 0 }, 0.1), { x: 0, y: 0 });
  assert.equal(deadzone({ x: 1, y: 0 }, 0.1).x, 1, 'full travel reaches 1');
  assert.ok(Math.abs(deadzone({ x: 0.55, y: 0 }, 0.1).x - 0.5) < 1e-9);
  assert.deepEqual(snapDirection({ x: 0.9, y: 0.3 }, 4), { x: 1, y: 0 });
  assert.deepEqual(snapDirection({ x: 0.7, y: -0.7 }, 8), { x: 1, y: -1 });
  assert.deepEqual(snapDirection({ x: 0.7, y: -0.7 }, 4), { x: 1, y: 0 });
});

void test('dpad: centre is neutral, arms map to unit directions', () => {
  assert.deepEqual(dpadDirection({ x: 0.1, y: 0.1 }, 4), { x: 0, y: 0 });
  assert.deepEqual(dpadDirection({ x: 0, y: -0.8 }, 4), { x: 0, y: -1 });
  assert.deepEqual(dpadDirection({ x: -0.8, y: 0.1 }, 4), { x: -1, y: 0 });
  assert.deepEqual(dpadDirection({ x: 0.6, y: 0.6 }, 8), { x: 1, y: 1 });
  assert.deepEqual(dpadDirection({ x: 0.6, y: 0.55 }, 4), { x: 1, y: 0 });
});

void test('stick: output is clamped to the unit circle with a dead zone', () => {
  const o = { x: 100, y: 100 };
  assert.deepEqual(stickVector(o, { x: 102, y: 100 }, 50, 0.12).output, {
    x: 0,
    y: 0,
  });
  const full = stickVector(o, { x: 400, y: 100 }, 50, 0.12);
  assert.deepEqual(full.output, { x: 1, y: 0 });
  assert.deepEqual(full.knob, { x: 1, y: 0 });
  const diag = stickVector(o, { x: 200, y: 200 }, 50, 0.12).output;
  assert.ok(Math.hypot(diag.x, diag.y) <= 1.0005);
  // Floating origins stay a full radius from the edges.
  assert.deepEqual(
    clampOrigin({ x: 5, y: 290 }, { width: 200, height: 300 }, 50),
    {
      x: 50,
      y: 250,
    },
  );
});

void test('swipe: short swipes are ignored, direction and speed are reported', () => {
  const size = { width: 300, height: 200 };
  assert.equal(classifySwipe(10, 5, 100, size, 0.12), null);
  const up = classifySwipe(10, -100, 100, size, 0.12)!;
  assert.equal(up.dir, 'up');
  assert.equal(up.y, -0.5);
  assert.ok(up.velocity > 4.9 && up.velocity < 5.1);
  assert.equal(classifySwipe(-80, 20, 50, size, 0.12)!.dir, 'left');
});

void test('hold meter: charge ramps linearly and caps at 1', () => {
  assert.equal(chargeAt(0, 1000), 0);
  assert.equal(chargeAt(250, 1000), 0.25);
  assert.equal(chargeAt(5000, 1000), 1);
  assert.equal(chargeAt(-5, 1000), 0);
});

void test('presets assign slots in order and refuse to overflow', () => {
  for (const [preset, slots] of Object.entries(LAYOUTS)) {
    const widgets = slots.map((_, i) => ({ id: `w${i}` }));
    assert.deepEqual(
      assignSlots(preset as LayoutPreset, widgets).map((w) => w.slot),
      [...slots],
      `${preset} assigns slots in order`,
    );
    assert.throws(
      () => assignSlots(preset as LayoutPreset, [...widgets, { id: 'extra' }]),
      /fits/,
    );
  }
  // Explicit slots win; the rest fill what's left.
  assert.deepEqual(
    assignSlots('gamepad', [{ id: 'jump', slot: 'b' }, { id: 'move' }]).map(
      (w) => w.slot,
    ),
    ['b', 'primary'],
  );
  assert.throws(
    () => assignSlots('duo', [{ id: 'x', slot: 'primary' }]),
    /no slot/,
  );
  assert.throws(
    () =>
      assignSlots('stack', [
        { id: 'x', slot: 'a' },
        { id: 'y', slot: 'a' },
      ]),
    /twice/,
  );
  assert.equal(defaultLayout(1), 'single');
  assert.equal(defaultLayout(3), 'gamepad');
});

void test('resolveConfig lays out the built-in games from their layouts', () => {
  const c = defaultCapabilities();
  const lab = resolveConfig(pointerSpec, c, 1);
  assert.equal(lab.orientation, 'portrait');
  assert.equal(lab.menu, 'top-right');
  assert.deepEqual(
    lab.widgets.map((w) => [w.action, w.type, w.label]),
    [
      ['aim', 'stick', 'Aim'],
      ['fire', 'button', 'Fire'],
    ],
  );
  // Grid cells become normalized rects.
  assert.deepEqual(lab.widgets[0].rect, [0, 2 / 24, 1, 13 / 24]);
  assert.deepEqual(lab.widgets[1].props, { icon: 'fire' });
  const race = resolveConfig(steeringSpec, c, 2);
  assert.equal(race.widgets[1].type, 'swipe-pad');
});

void test('resolveConfig rejects more press controls than the frame carries', () => {
  const inputs = Object.fromEntries(
    Array.from({ length: PRESS_SLOTS + 1 }, (_, i) => [
      `b${i}`,
      { required: true, prefer: 'button' as const },
    ]),
  );
  // Register a (deliberately invalid) layout just for this test.
  layouts['five-buttons'] = {
    ...emptyLayout('five-buttons', 'Five buttons', 'portrait'),
    items: Object.keys(inputs).map((name, i) => ({
      name,
      type: 'button',
      rect: { x: 0, y: 2 + i * 4, w: 4, h: 4 },
      rotation: 0,
    })),
  };
  try {
    assert.throws(
      () =>
        resolveConfig(
          {
            ...pointerSpec,
            inputs,
            controller: { layout: 'five-buttons' },
          },
          defaultCapabilities(),
          1,
        ),
      /at most 4/,
    );
  } finally {
    delete layouts['five-buttons'];
  }
});
