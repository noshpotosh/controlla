import { pointerSpec, steeringSpec, controlSpecs } from './fixtures/games.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import type {
  ControllerLayout,
  LayoutItem,
  Rotation,
  LayoutPreset,
  Capabilities,
  ControllerSpec,
} from '../src/client/controls/api.ts';
import {
  asControllerLayout,
  emptyLayout,
  isControllerLayout,
  layoutFileName,
  menuRect,
  slugify,
} from '../src/client/controls/layout/schema.ts';
import {
  checkAssignment,
  layoutWarnings,
  validateLayout,
} from '../src/client/controls/layout/validate.ts';
import {
  rotateDirection,
  rotateVector,
  toLocal,
} from '../src/client/controls/layout/rotation.ts';
import { renderLayoutIndex } from '../src/client/controls/layout/index-file.ts';
import { layoutWidgets } from '../src/client/controls/layout/widgets.ts';

import {
  gameDefaultLayout,
  LAYOUTS,
  templateLayout,
} from '../src/client/controls/layouts.ts';
import { definitionFor } from '../src/client/controls/registry.ts';
import { dpadDirection } from '../src/client/controls/dpad/logic.ts';
import {
  addItem,
  alignmentGuides,
  fillAxis,
  findFreeSpot,
  reorient,
  resizeRect,
  rotateItem,
  sizePreset,
} from '../src/client/devtools/designer/model.ts';
import {
  defaultCapabilities,
  gameLayout,
  resolveConfig,
} from '../src/client/controls/resolve.ts';

import { layouts } from '../src/client/controls/layouts/index.ts';

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
  for (const m of controlSpecs)
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

void test('validation: bounds, overlap, menu corner, names', () => {
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
  assert.match(check([top('x'), bottom('x')]), /Two controls are named "x"/);
  assert.match(check([top(), bottom('bad name')]), /valid name/);
  // Motion inputs are toggled, never placed.
  assert.match(check([top('aim', 'pointer')]), /isn't a touch control/);
  const unnamed = { ...layoutOf([]), name: ' ' };
  assert.match(messages(validateLayout(unnamed)), /name/);
});

void test('undersized controls warn but never block', () => {
  const small = layoutOf([item('a', 'swipe-pad', { x: 0, y: 14, w: 1, h: 1 })]);
  assert.deepEqual(validateLayout(small), []);
  assert.match(
    messages(layoutWarnings(small)),
    /smaller than recommended \(4×4\)/,
  );
  // Rotation turns the recommendation with the control.
  const sideways = layoutOf([
    item('a', 'swipe-pad', { x: 0, y: 10, w: 4, h: 3 }, 90),
  ]);
  assert.match(messages(layoutWarnings(sideways)), /\(4×4\)/);
  assert.deepEqual(layoutWarnings(layoutOf([top(), bottom()])), []);
  // Shipped layouts are all comfortably sized.
  for (const layout of Object.values(layouts))
    assert.deepEqual(layoutWarnings(layout), [], layout.id);
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
  const fits = (l: ControllerLayout, m: ControllerSpec = steeringSpec) =>
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
    ...steeringSpec,
    controller: { layout: 'x', bind: { boost: 'go' } },
  };
  assert.equal(fits(layoutOf([top(), bottom('go')]), bound), '');
});

void test('resolveConfig: motion when on and available, else the same-named touch control', () => {
  const lab = resolveConfig(pointerSpec, defaultCapabilities(), 1);
  assert.deepEqual(
    lab.widgets.map((w) => [w.action, w.type]),
    [
      ['aim', 'stick'],
      ['fire', 'button'],
    ],
  );
  assert.deepEqual(lab.substitutions, ['aim: pointer → stick']);
  const aimed = resolveConfig(pointerSpec, withMotion(), 1);
  assert.equal(aimed.widgets[0].type, 'pointer');
  assert.deepEqual(
    aimed.widgets[0].rect,
    layoutWidgets(layouts['aim-and-fire'])[0].rect,
  );
  assert.equal(!!aimed.motion.pointer, true);
  // A layout with motion off keeps the touch control even when the phone has a gyro.
  layouts['aim-touch'] = {
    ...layouts['aim-and-fire'],
    id: 'aim-touch',
    motion: {
      pointer: false,
      tilt: false,
      shake: false,
      chop: false,
      jolt: false,
    },
  };
  try {
    const touch = resolveConfig(
      { ...pointerSpec, controller: { layout: 'aim-touch' } },
      withMotion(),
      1,
    );
    assert.equal(touch.widgets[0].type, 'stick');
    assert.equal(!!touch.motion.pointer, false);
  } finally {
    delete layouts['aim-touch'];
  }
  assert.throws(
    () =>
      resolveConfig(
        { ...pointerSpec, controller: { layout: 'nope' } },
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
  const fallback = gameDefaultLayout(pointerSpec);
  assert.deepEqual(fallback.motion, {
    pointer: true,
    tilt: false,
    shake: false,
    chop: false,
    jolt: false,
  });
  assert.deepEqual(
    fallback.items.map((i) => [i.name, i.type]),
    [
      ['aim', 'stick'],
      ['fire', 'button'],
    ],
  );
  assert.deepEqual(validateLayout(fallback), []);
  assert.deepEqual(checkAssignment(pointerSpec, fallback), []);
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

void test('designer model: edge and corner resize, aspect lock', () => {
  const grid = { cols: 12, rows: 24 },
    start = { x: 4, y: 8, w: 4, h: 4 };
  // Edges move one side only.
  assert.deepEqual(resizeRect(start, 'e', 2, 5, grid), {
    x: 4,
    y: 8,
    w: 6,
    h: 4,
  });
  assert.deepEqual(resizeRect(start, 'w', -1, 0, grid), {
    x: 3,
    y: 8,
    w: 5,
    h: 4,
  });
  assert.deepEqual(resizeRect(start, 'n', 0, 2, grid), {
    x: 4,
    y: 10,
    w: 4,
    h: 2,
  });
  assert.deepEqual(resizeRect(start, 's', 0, 3, grid), {
    x: 4,
    y: 8,
    w: 4,
    h: 7,
  });
  // Corners keep the opposite corner; everything shrinks to 1×1 at most.
  assert.deepEqual(resizeRect(start, 'nw', 9, 9, grid), {
    x: 7,
    y: 11,
    w: 1,
    h: 1,
  });
  assert.deepEqual(resizeRect(start, 'se', -9, -9, grid), {
    x: 4,
    y: 8,
    w: 1,
    h: 1,
  });
  // Never past the grid edge.
  assert.deepEqual(resizeRect(start, 'e', 40, 0, grid), {
    x: 4,
    y: 8,
    w: 8,
    h: 4,
  });
  // ⇧: proportions hold; an edge grows the other axis about the centre.
  assert.deepEqual(resizeRect(start, 'se', 4, 0, grid, { lockAspect: true }), {
    x: 4,
    y: 8,
    w: 8,
    h: 8,
  });
  assert.deepEqual(
    resizeRect({ x: 4, y: 8, w: 4, h: 2 }, 'e', 2, 0, grid, {
      lockAspect: true,
    }),
    { x: 4, y: 8, w: 6, h: 3 },
  );
  assert.deepEqual(resizeRect(start, 's', 0, 2, grid, { lockAspect: true }), {
    x: 3,
    y: 8,
    w: 6,
    h: 6,
  });
});

void test('designer model: alignment guides', () => {
  const grid = { cols: 12, rows: 24 },
    others = [{ x: 0, y: 2, w: 6, h: 4 }];
  assert.deepEqual(alignmentGuides({ x: 0, y: 8, w: 6, h: 4 }, others, grid), {
    x: [0, 3, 6],
    // Its bottom edge also meets the surface's horizontal centre.
    y: [12],
  });
  // The surface centre is always a guide.
  assert.deepEqual(alignmentGuides({ x: 4, y: 10, w: 4, h: 4 }, [], grid), {
    x: [6],
    y: [12],
  });
});

void test('designer model: size presets and fill', () => {
  const base = layoutOf([
    item('fire', 'button', { x: 4, y: 10, w: 3, h: 3 }),
    item('jump', 'button', { x: 9, y: 10, w: 3, h: 3 }),
  ]);
  // Recommended button is 3×3: S 2×2, L 5×5, each about the same centre.
  assert.deepEqual(sizePreset(base, 0, 'S').items[0].rect, {
    x: 5,
    y: 11,
    w: 2,
    h: 2,
  });
  assert.deepEqual(sizePreset(base, 0, 'L').items[0].rect, {
    x: 3,
    y: 9,
    w: 5,
    h: 5,
  });
  assert.deepEqual(sizePreset(base, 0, 'M').items[0].rect, base.items[0].rect);
  // Fill stops at neighbours and at the menu corner.
  assert.deepEqual(fillAxis(base, 0, 'row').items[0].rect, {
    x: 0,
    y: 10,
    w: 9,
    h: 3,
  });
  assert.deepEqual(fillAxis(base, 1, 'column').items[1].rect, {
    x: 9,
    y: 2,
    w: 3,
    h: 22,
  });
});

void test('aimed motion reserves room for Recenter beside the menu', () => {
  const portrait = emptyLayout('x', 'X', 'portrait'),
    landscape = emptyLayout('x', 'X', 'landscape'),
    on = (layout: ControllerLayout, m: 'pointer' | 'tilt' | 'shake') => ({
      ...layout,
      motion: { ...layout.motion, [m]: true },
    });
  assert.deepEqual(menuRect(portrait), { x: 10, y: 0, w: 2, h: 2 });
  // Along the short edge: wider in portrait, taller in landscape.
  assert.deepEqual(menuRect(on(portrait, 'pointer')), {
    x: 8,
    y: 0,
    w: 4,
    h: 2,
  });
  assert.deepEqual(menuRect(on(landscape, 'tilt')), {
    x: 22,
    y: 0,
    w: 2,
    h: 4,
  });
  assert.deepEqual(menuRect({ ...on(portrait, 'tilt'), menu: 'bottom-left' }), {
    x: 0,
    y: 22,
    w: 4,
    h: 2,
  });
  // Shake has nothing to recenter.
  assert.deepEqual(menuRect(on(portrait, 'shake')), menuRect(portrait));
  // A control in the Recenter slot now fails validation.
  const crowded = on(
    layoutOf([item('a', 'button', { x: 7, y: 0, w: 2, h: 2 })]),
    'pointer',
  );
  assert.match(messages(validateLayout(crowded)), /menu corner/);
});

void test('layouts saved before chop existed still load, with chop off', () => {
  const older = structuredClone(emptyLayout('older', 'Older', 'portrait')) as {
    motion: Partial<Record<string, boolean>>;
  };
  delete older.motion.chop;
  assert.ok(isControllerLayout(older));
  assert.equal(!!asControllerLayout(older).motion.chop, false);
  // A present chop must still be a boolean, and older inputs stay required.
  assert.equal(
    isControllerLayout({ ...older, motion: { ...older.motion, chop: 'yes' } }),
    false,
  );
  const { shake: _shake, ...withoutShake } = older.motion;
  assert.equal(isControllerLayout({ ...older, motion: withoutShake }), false);
  assert.equal(!!layouts['aim-and-whack'].motion.chop, true);
});

void test('obsolete widget layouts fail parsing and validation with an explicit retirement message', () => {
  for (const type of ['slider', 'dial', 'text', 'draw-canvas']) {
    const obsolete = {
      ...emptyLayout('obsolete-probe', 'Obsolete probe', 'portrait'),
      items: [
        { name: 'old', type, rotation: 0, rect: { x: 0, y: 4, w: 4, h: 4 } },
      ],
    };
    assert.equal(isControllerLayout(obsolete), false);
    assert.throws(
      () => asControllerLayout(obsolete),
      new RegExp(`"${type}" widget is retired`),
    );
    assert.ok(
      validateLayout(obsolete as ControllerLayout).some((issue) =>
        issue.message.includes('widget is retired'),
      ),
    );
    const requirements = {
      inputs: { old: { prefer: type, required: true } },
    } as unknown as ControllerSpec;
    assert.ok(
      checkAssignment(requirements, obsolete as ControllerLayout).some(
        (issue) => issue.message.includes('widget is retired'),
      ),
    );
  }
});
