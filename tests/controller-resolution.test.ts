import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import type {
  Capabilities,
  ControllerConfig,
  ControllerLayout,
  ControllerSpec,
  InputRequirement,
} from '../src/client/controls/api.ts';
import {
  available,
  defaultCapabilities,
  gameLayout,
  resolveConfig,
} from '../src/client/controls/resolve.ts';
import { emptyLayout } from '../src/client/controls/layout/schema.ts';
import { layouts } from '../src/client/controls/layouts/index.ts';
import {
  controllerSpec,
  resolveController,
} from '../src/client/engine/input.ts';
import { neonHarvest } from '../src/client/minigames/neon-harvest/index.ts';
import { games } from '../src/client/minigames/catalog.ts';
import type { GameDescriptor } from '../src/client/api/index.ts';
import { SessionAuthority } from '../src/core/session.ts';
import type { Message, Player } from '../src/core/types.ts';
import { Runtime } from '../src/client/runtime.ts';

const granted = (): Capabilities => {
  const c = defaultCapabilities();
  c.sensors.gyro = { present: true, permission: 'granted' };
  c.sensors.accel = { present: true, permission: 'granted' };
  return c;
};
const spec = (inputs: ControllerSpec['inputs']): ControllerSpec => ({
  id: 'resolution-probe',
  name: 'Resolution probe',
  inputs,
});
const motion = (
  prefer: 'pointer' | 'tilt',
  fallback?: 'stick',
): InputRequirement => ({
  prefer,
  required: true,
  ...(fallback && { fallback }),
});
function registerLayout(t: TestContext, layout: ControllerLayout) {
  assert.equal(layouts[layout.id], undefined);
  layouts[layout.id] = layout;
  t.after(() => {
    delete layouts[layout.id];
  });
  return { layout: layout.id };
}

void test('Neon controller projection and motion/touch resolution preserve the shipped configuration', () => {
  const projected = controllerSpec(neonHarvest);
  assert.deepEqual(Object.keys(projected).sort(), [
    'controller',
    'id',
    'inputs',
    'name',
  ]);
  const touch = resolveController(neonHarvest, defaultCapabilities(), 65535);
  assert.deepEqual(touch, {
    schemaVersion: 1,
    configId: 'neon-harvest-v1',
    generation: 65535,
    orientation: 'portrait',
    menu: 'top-right',
    sensors: {
      pointer: { enabled: false, rateHz: 60 },
      tilt: { enabled: false },
      shake: { enabled: false, thresholdG: 1.8 },
      accel: { enabled: false },
    },
    haptics: { enabled: false },
    substitutions: ['aim: pointer → aim-pad'],
    widgets: [
      {
        id: 'aim',
        action: 'aim',
        type: 'aim-pad',
        label: 'Aim',
        rect: [0, 2 / 24, 1, 13 / 24],
        rotation: 0,
        space: 'normalized',
      },
      {
        id: 'pulse',
        action: 'pulse',
        type: 'button',
        label: 'PULSE',
        rect: [0, 15 / 24, 1, 9 / 24],
        rotation: 0,
        props: { icon: 'fire' },
        space: 'signed',
      },
    ],
  });
  const aimed = resolveController(neonHarvest, granted(), 0);
  const expected = structuredClone(touch);
  expected.generation = 0;
  expected.sensors.pointer.enabled = true;
  expected.substitutions = [];
  expected.widgets[0].type = 'pointer';
  assert.deepEqual(aimed, expected);
  assert.deepEqual(
    resolveConfig(projected, defaultCapabilities(), 65535),
    touch,
  );
});

for (const [first, second] of [
  ['pointer', 'tilt'],
  ['pointer', 'pointer'],
  ['tilt', 'tilt'],
] as const) {
  void test(`one binary vector rejects ${first} plus ${second}, naming both actions without returning a config`, () => {
    let configuration: ControllerConfig | undefined;
    assert.throws(
      () => {
        configuration = resolveConfig(
          spec({ look: motion(first), move: motion(second) }),
          granted(),
          1,
        );
      },
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.match(
          error.message,
          /only one binary motion vector is supported/i,
        );
        assert.match(error.message, /look/);
        assert.match(error.message, /move/);
        return true;
      },
    );
    assert.equal(configuration, undefined);
  });
}

void test('denied permissions resolve independent touch fallbacks; a partial grant leaves one motion vector', () => {
  const input = spec({
    look: motion('pointer', 'stick'),
    move: motion('tilt', 'stick'),
  });
  const denied = granted();
  denied.sensors.gyro.permission = denied.sensors.accel.permission = 'denied';
  assert.deepEqual(
    resolveConfig(input, denied, 2).widgets.map((w) => [
      w.action,
      w.type,
      w.space,
    ]),
    [
      ['look', 'stick', 'normalized'],
      ['move', 'stick', 'signed'],
    ],
  );
  const partial = granted();
  partial.sensors.gyro.permission = 'denied';
  assert.equal(available('pointer', partial), false);
  assert.deepEqual(
    resolveConfig(input, partial, 3).widgets.map((w) => w.type),
    ['stick', 'tilt'],
  );
  assert.throws(
    () => resolveConfig(input, granted(), 4),
    /binary motion vector/,
  );
});

void test('unused layout motion toggles do not consume vector capacity', (t) => {
  const layout = emptyLayout('unused-motion-test', 'Unused motion', 'portrait');
  layout.motion = { pointer: true, tilt: true, shake: false };
  const input = {
    ...spec({ look: motion('pointer') }),
    controller: registerLayout(t, layout),
  };
  assert.deepEqual(
    resolveConfig(input, granted(), 1).widgets.map((w) => w.type),
    ['pointer'],
  );
  assert.deepEqual(
    resolveConfig({ ...input, inputs: {} }, granted(), 2).widgets,
    [],
  );
});

void test('two independent touch vectors coexist with one resolved motion action', () => {
  const input = spec({
    look: motion('pointer'),
    move: { prefer: 'stick', required: true },
    inspect: { prefer: 'stick', required: true },
  });
  assert.deepEqual(
    resolveConfig(input, granted(), 9).widgets.map((w) => [w.action, w.type]),
    [
      ['look', 'pointer'],
      ['move', 'stick'],
      ['inspect', 'stick'],
    ],
  );
});

void test('required motion without a fallback fails explicitly, while generated presets remain supported', () => {
  const input = spec({ look: motion('pointer') });
  assert.throws(
    () => resolveConfig(input, defaultCapabilities(), 1),
    /Motion access is off for look/,
  );
  const generated = {
    ...spec({
      move: { prefer: 'stick', required: true },
      fire: { prefer: 'button', required: true },
    }),
    layout: 'duo' as const,
  };
  assert.equal(gameLayout(generated).id, 'resolution-probe-default');
  assert.deepEqual(
    resolveConfig(generated, granted(), 2).widgets.map((w) => w.rect),
    [
      [0, 2 / 24, 0.5, 22 / 24],
      [0.5, 2 / 24, 0.5, 22 / 24],
    ],
  );
});

void test('generated layouts preserve long descriptor identity without applying persisted file-name limits', () => {
  const input = {
    ...spec({ fire: { prefer: 'button', required: true } }),
    id: 'a'.repeat(40),
    name: 'N'.repeat(60),
  };
  const config = resolveConfig(input, defaultCapabilities(), 21);
  assert.equal(config.configId, input.id + '-v1');
  assert.equal(gameLayout(input).id, input.id + '-default');
  assert.equal(config.generation, 21);
});

void test('the public resolver validates layout/bindings and preserves rotation, coordinate spaces, props and action order', (t) => {
  const layout = emptyLayout('binding-rotation-test', 'Bindings', 'portrait');
  layout.items = [
    {
      name: 'pad',
      type: 'stick',
      rect: { x: 0, y: 2, w: 12, h: 12 },
      rotation: 90,
      label: 'Look',
      variant: 'default',
      props: { sensitivity: 0.8 },
    },
    {
      name: 'trigger',
      type: 'button',
      rect: { x: 0, y: 14, w: 12, h: 10 },
      rotation: 180,
    },
  ];
  const input: ControllerSpec = {
    ...spec({
      fire: { prefer: 'button', required: true },
      look: motion('pointer', 'stick'),
    }),
    controller: {
      ...registerLayout(t, layout),
      bind: { look: 'pad', fire: 'trigger' },
    },
  };
  const config = resolveConfig(input, granted(), 12);
  assert.deepEqual(
    config.widgets.map((w) => [w.action, w.type, w.rotation, w.space]),
    [
      ['fire', 'button', 180, 'signed'],
      ['look', 'stick', 90, 'normalized'],
    ],
  );
  assert.deepEqual(config.widgets[1].props, { sensitivity: 0.8 });
  assert.equal(config.widgets[1].variant, 'default');
  assert.throws(
    () =>
      resolveConfig(
        {
          ...input,
          controller: {
            ...input.controller!,
            bind: { look: 'trigger', fire: 'trigger' },
          },
        },
        granted(),
        13,
      ),
    /needs a vector control/,
  );
  layout.items[1].rect.y = 3;
  assert.throws(() => resolveConfig(input, granted(), 14), /overlaps/);
  layout.items[1].rect.y = 14;
  layout.motion.pointer = true;
  const pointer = resolveConfig(input, granted(), 15).widgets[1];
  assert.equal(pointer.rotation, 90);
  assert.equal(pointer.props, undefined);
  assert.equal(pointer.variant, undefined);
});

void test('shake activations consume the existing four press slots, independently of vector capacity', () => {
  const inputs = Object.fromEntries(
    Array.from({ length: 4 }, (_, i) => [
      `shake${i}`,
      { prefer: 'shake' as const, required: true },
    ]),
  );
  assert.equal(resolveConfig(spec(inputs), granted(), 1).widgets.length, 4);
  assert.throws(
    () =>
      resolveConfig(
        spec({ ...inputs, shake4: { prefer: 'shake', required: true } }),
        granted(),
        2,
      ),
    /more than 4 press/,
  );
});

function live(t: TestContext) {
  const sent: Message[] = [];
  const authority = new SessionAuthority('host', {
    toPlayer: (_id, message) => sent.push(message),
    toVenue() {},
    snapshot() {},
    event() {},
    warning() {},
  });
  const player: Player = {
    id: 'a',
    name: 'Ada',
    seat: 0,
    color: '#fff',
    connected: true,
    venueId: 'host',
  };
  authority.setRoster({
    players: [player],
    venues: [{ id: 'host', name: 'Host', connected: true }],
  });
  t.after(() => authority.dispose());
  let created = 0;
  const descriptor: GameDescriptor = {
    ...neonHarvest,
    id: 'motion-conflict-probe',
    controls: {
      inputs: {
        look: motion('pointer', 'stick'),
        move: motion('tilt', 'stick'),
      },
    },
    create: () => {
      created++;
      return neonHarvest.create();
    },
  };
  (games as GameDescriptor[]).push(descriptor);
  t.after(() => {
    (games as GameDescriptor[]).splice(games.indexOf(descriptor), 1);
  });
  return { authority, sent, descriptor, created: () => created };
}

void test('live capability upgrades use the controller error channel without publishing a partial replacement', (t) => {
  const r = live(t);
  r.authority.start(r.descriptor.id, 'standard');
  const before = r.sent.filter((m) => m.type === 'config').at(-1)!
    .config as ControllerConfig;
  const start = r.sent.length;
  r.authority.control('a', { type: 'capabilities', capabilities: granted() });
  const update = r.sent.slice(start);
  assert.equal(
    update.some((m) => m.type === 'config'),
    false,
  );
  assert.match(
    update.find((m) => m.type === 'error')!.message,
    /binary motion vector/,
  );
  r.authority.control('a', {
    type: 'capabilities',
    capabilities: defaultCapabilities(),
  });
  const restored = r.sent.filter((m) => m.type === 'config').at(-1)!.config;
  assert.deepEqual(
    restored,
    before,
    'failed resolution did not replace or advance the configuration',
  );
});

void test('live preflight rejects conflicts before loading/reconfiguration and exposes the existing host warning', (t) => {
  const r = live(t);
  r.authority.control('a', { type: 'capabilities', capabilities: granted() });
  const before = structuredClone(r.sent);
  const progress = r.authority.summary().progress;
  t.after(() => host.close());
  for (const [key, value] of Object.entries({
    document: Object.assign(new EventTarget(), { hidden: false }),
    window: Object.assign(new EventTarget(), { devicePixelRatio: 1 }),
    navigator: { maxTouchPoints: 1 },
    innerWidth: 800,
    innerHeight: 600,
  })) {
    const old = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, {
      configurable: true,
      writable: true,
      value,
    });
    t.after(() => {
      if (old) Object.defineProperty(globalThis, key, old);
      else Reflect.deleteProperty(globalThis, key);
    });
  }
  const host = new Runtime({ role: 'host', endpoint: 'ws://unused/signal' });
  Reflect.set(host, 'authority', r.authority);
  host.startGame(r.descriptor.id, 'standard');
  assert.match(host.view.warning, /binary motion vector/);
  assert.equal(r.created(), 0);
  assert.deepEqual(r.sent, before);
  assert.deepEqual(r.authority.summary().progress, progress);
});
