import {
  pointerManifest,
  steeringManifest,
  controlManifests,
} from './fixtures/games.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  asControllerLayout,
  emptyLayout,
  isControllerLayout,
  layoutFileName,
  menuRect,
  slugify,
  type ControllerLayout,
  type LayoutItem,
  type Rotation,
} from '../src/controls/layout/schema.ts';
import {
  checkAssignment,
  validateLayout,
} from '../src/controls/layout/validate.ts';
import {
  rotateDirection,
  rotateVector,
  toLocal,
} from '../src/controls/layout/rotation.ts';
import { renderLayoutIndex } from '../src/controls/layout/index-file.ts';
import { layoutWidgets } from '../src/controls/layout/widgets.ts';
import {
  gameDefaultLayout,
  LAYOUTS,
  templateLayout,
  type LayoutPreset,
} from '../src/controls/layouts.ts';
import { definitionFor } from '../src/controls/registry.ts';
import { dpadDirection } from '../src/controls/dpad/logic.ts';
import {
  addItem,
  findFreeSpot,
  reorient,
  rotateItem,
} from '../src/controls/designer/model.ts';
import {
  defaultCapabilities,
  gameLayout,
  resolveConfig,
} from '../src/core/config.ts';
import type { Capabilities, Manifest } from '../src/core/types.ts';
import { layouts } from '../src/layouts/index.ts';

const layoutOf = (
  items: LayoutItem[],
  motion: Partial<ControllerLayout['motion']> = {},
): ControllerLayout => {
  const base = emptyLayout('test', 'Test', 'portrait');
  return { ...base, motion: { ...base.motion, ...motion }, items };
};
const item = (
  name: string,
  type: LayoutItem['type'],
  rect: LayoutItem['rect'],
  rotation: Rotation = 0,
): LayoutItem => ({ name, type, rect, rotation });
const top = (name = 'steer', type: LayoutItem['type'] = 'stick') =>
  item(name, type, { x: 0, y: 2, w: 12, h: 10 });
const bottom = (name = 'boost', type: LayoutItem['type'] = 'swipe-pad') =>
  item(name, type, { x: 0, y: 14, w: 12, h: 10 });
const messages = (issues: { message: string }[]) =>
  issues.map((i) => i.message).join('\n');
const withMotion = (): Capabilities => {
  const c = defaultCapabilities();
  c.sensors.gyro = { present: true, permission: 'granted' };
  c.sensors.accel = { present: true, permission: 'granted' };
  return c;
};

void test('the library: every layout is valid and every game fits its layout', () => {
  for (const layout of Object.values(layouts)) {
    assert.ok(isControllerLayout(layout), layout.id);
    assert.deepEqual(validateLayout(layout), [], layout.id);
  }
  for (const m of controlManifests)
    assert.deepEqual(checkAssignment(m, gameLayout(m)), [], m.id);
});

void test('schema guard rejects malformed layouts', () => {
  const good = layoutOf([top(), bottom()]);
  assert.ok(isControllerLayout(good));
  const bad: unknown[] = [
    null,
    { ...good, schemaVersion: 1 },
    { ...good, id: '../escape' },
    { ...good, name: '   ' },
    { ...good, orientation: 'diagonal' },
    { ...good, menu: 'middle' },
    { ...good, motion: { pointer: true } },
    { ...good, items: [{ ...top(), rotation: 45 }] },
    { ...good, items: [{ ...top(), rect: { x: -1, y: 0, w: 2, h: 2 } }] },
    { ...good, items: [{ ...top(), name: 'has spaces' }] },
  ];
  for (const b of bad) assert.equal(isControllerLayout(b), false);
  assert.throws(() => asControllerLayout({}), /Invalid/);
});

void test('ids: slugs are unique and the save path only allows plain ids', () => {
  assert.equal(slugify('Racing Wheel!'), 'racing-wheel');
  assert.equal(slugify('Racing wheel', ['racing-wheel']), 'racing-wheel-2');
  assert.equal(slugify('!!!'), 'layout');
  assert.equal(layoutFileName('racing-wheel'), 'racing-wheel.json');
  for (const id of ['../x', 'a/b', 'UP', '', 'x'.repeat(41), '-lead'])
    assert.equal(layoutFileName(id), null, id);
});

void test('the generated index imports each layout once, sorted', () => {
  const src = renderLayoutIndex(['steer-and-boost', 'aim-and-fire', '../bad']);
  assert.match(
    src,
    /import layout_aim_and_fire from '\.\/aim-and-fire\.json'[\s\S]*import layout_steer_and_boost/,
  );
  assert.match(
    src,
    /'steer-and-boost': asControllerLayout\(layout_steer_and_boost\)/,
  );
  assert.doesNotMatch(src, /bad/);
});

void test('validation: bounds, overlap, menu corner, size, names', () => {
  const check = (items: LayoutItem[]) =>
    messages(validateLayout(layoutOf(items)));
  assert.equal(check([top(), bottom()]), '');
  assert.match(
    check([item('a', 'stick', { x: 6, y: 2, w: 8, h: 8 })]),
    /outside/,
  );
  assert.match(
    check([top(), item('b', 'button', { x: 0, y: 10, w: 4, h: 4 })]),
    /overlaps/,
  );
  assert.match(
    check([item('a', 'button', { x: 8, y: 0, w: 4, h: 4 })]),
    /menu corner/,
  );
  assert.match(
    check([item('a', 'swipe-pad', { x: 0, y: 14, w: 2, h: 2 })]),
    /too small/,
  );
  assert.match(check([top('x'), bottom('x')]), /Two controls are named "x"/);
  assert.match(check([top(), bottom('bad name')]), /valid name/);
  // Motion inputs are toggled, never placed.
  assert.match(check([top('aim', 'pointer')]), /isn't a touch control/);
  const unnamed = { ...layoutOf([]), name: ' ' };
  assert.match(messages(validateLayout(unnamed)), /name/);
});

void test('validation: at most four press inputs, counting shake', () => {
  const buttons = (n: number) =>
    Array.from({ length: n }, (_, i) =>
      item(`b${i}`, 'button', {
        x: (i % 3) * 4,
        y: 2 + Math.floor(i / 3) * 4,
        w: 4,
        h: 4,
      }),
    );
  assert.equal(messages(validateLayout(layoutOf(buttons(4)))), '');
  assert.match(
    messages(validateLayout(layoutOf(buttons(4), { shake: true }))),
    /at most 4/,
  );
});

void test('assignment: inputs bind to controls by name, or to motion', () => {
  // Tilt Rally: steer prefers tilt; boost needs a swipe.
  const fits = (l: ControllerLayout, m: Manifest = steeringManifest) =>
    messages(checkAssignment(m, l));
  assert.equal(
    fits(layoutOf([top(), bottom()])),
    '',
    'stick stands in for tilt',
  );
  assert.equal(
    fits(layoutOf([bottom()], { tilt: true })),
    '',
    'tilt alone is enough',
  );
  assert.match(fits(layoutOf([bottom()])), /needs tilt switched on/);
  assert.match(fits(layoutOf([top()])), /No control named "boost"/);
  assert.match(
    fits(layoutOf([top(), bottom('boost', 'button')])),
    /needs a swipe control/,
  );
  // `bind` maps an input onto a differently named control.
  const bound = {
    ...steeringManifest,
    controller: { layout: 'x', bind: { boost: 'go' } },
  };
  assert.equal(fits(layoutOf([top(), bottom('go')]), bound), '');
});

void test('resolveConfig: motion when on and available, else the same-named touch control', () => {
  const lab = resolveConfig(pointerManifest, defaultCapabilities(), 1);
  assert.deepEqual(
    lab.widgets.map((w) => [w.action, w.type]),
    [
      ['aim', 'stick'],
      ['fire', 'button'],
    ],
  );
  assert.deepEqual(lab.substitutions, ['aim: pointer → stick']);
  const aimed = resolveConfig(pointerManifest, withMotion(), 1);
  assert.equal(aimed.widgets[0].type, 'pointer');
  assert.deepEqual(
    aimed.widgets[0].rect,
    layoutWidgets(layouts['aim-and-fire'])[0].rect,
  );
  assert.equal(aimed.sensors.pointer.enabled, true);
  // A layout with motion off keeps the touch control even when the phone has a gyro.
  layouts['aim-touch'] = {
    ...layouts['aim-and-fire'],
    id: 'aim-touch',
    motion: { pointer: false, tilt: false, shake: false },
  };
  try {
    const touch = resolveConfig(
      { ...pointerManifest, controller: { layout: 'aim-touch' } },
      withMotion(),
      1,
    );
    assert.equal(touch.widgets[0].type, 'stick');
    assert.equal(touch.sensors.pointer.enabled, false);
  } finally {
    delete layouts['aim-touch'];
  }
  assert.throws(
    () =>
      resolveConfig(
        { ...pointerManifest, controller: { layout: 'nope' } },
        withMotion(),
        1,
      ),
    /doesn't exist/,
  );
});

void test('rotation: local/screen conversion round-trips', () => {
  const v = { x: 0.3, y: -0.7 };
  for (const r of [0, 90, 180, 270] as Rotation[])
    assert.deepEqual(rotateVector(toLocal(v, r), r), v, `${r}°`);
  assert.deepEqual(rotateVector({ x: 0, y: -1 }, 90), { x: 1, y: 0 });
  assert.equal(rotateDirection('up', 90), 'right');
  assert.equal(rotateDirection('left', 270), 'down');
});

void test('rotation: a rotated D-pad reports the direction the player sees', () => {
  const rotate = definitionFor('dpad')!.rotateOutput!;
  // Placed at 90°, the pad's own "up" arm points right on screen.
  const arm = dpadDirection(toLocal({ x: 0.8, y: 0 }, 90), 4);
  assert.deepEqual(arm, { x: 0, y: -1 });
  assert.deepEqual(rotate(arm, 90), { x: 1, y: 0 });
  const swipe = definitionFor('swipe-pad')!.rotateOutput!(
    { dir: 'up', x: 0, y: -0.5, distance: 0.5, velocity: 2 },
    90,
  );
  assert.deepEqual(swipe, {
    dir: 'right',
    x: 0.5,
    y: 0,
    distance: 0.5,
    velocity: 2,
  });
});

void test('templates and game defaults are valid in both orientations', () => {
  for (const preset of Object.keys(LAYOUTS) as LayoutPreset[])
    for (const o of ['portrait', 'landscape'] as const) {
      const layout = templateLayout(preset, o, 'demo', 'Demo');
      assert.equal(layout.orientation, o);
      assert.deepEqual(validateLayout(layout), [], `${preset} ${o}`);
    }
  // A game with no layout: touch inputs placed, motion switched on, fallback placed.
  const fallback = gameDefaultLayout(pointerManifest);
  assert.deepEqual(fallback.motion, {
    pointer: true,
    tilt: false,
    shake: false,
  });
  assert.deepEqual(
    fallback.items.map((i) => [i.name, i.type]),
    [
      ['aim', 'stick'],
      ['fire', 'button'],
    ],
  );
  assert.deepEqual(validateLayout(fallback), []);
  assert.deepEqual(checkAssignment(pointerManifest, fallback), []);
});

void test('designer model: add, find space, rotate and reorient', () => {
  let layout = emptyLayout('x', 'X', 'portrait');
  layout = addItem(layout, 'stick')!.layout;
  layout = addItem(layout, 'button')!.layout;
  layout = addItem(layout, 'button')!.layout;
  assert.deepEqual(
    layout.items.map((i) => [i.name, i.label]),
    [
      ['stick', 'Stick'],
      ['button', 'Button'],
      ['button-2', 'Button 2'],
    ],
  );
  assert.deepEqual(validateLayout(layout), []);
  // Free spots avoid the menu corner.
  const empty = emptyLayout('x', 'X', 'portrait');
  const spot = findFreeSpot(empty, { w: 12, h: 2 })!;
  assert.ok(spot.y >= menuRect(empty).h);
  // Rotating swaps the footprint about its centre.
  const turned = rotateItem(
    layoutOf([item('b', 'swipe-pad', { x: 0, y: 10, w: 8, h: 4 })]),
    0,
  ).items[0];
  assert.equal(turned.rotation, 90);
  assert.deepEqual(turned.rect, { x: 2, y: 8, w: 4, h: 8 });
  const wide = reorient(layoutOf([top()]), 'landscape');
  assert.deepEqual(wide.grid, { cols: 24, rows: 12 });
  assert.deepEqual(wide.items[0].rect, { x: 0, y: 1, w: 24, h: 5 });
});
