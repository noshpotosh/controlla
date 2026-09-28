import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PreviewPorts,
  exportProbeLayout,
  importProbeLayout,
  probeAssignment,
  probeLayout,
  probeWidgets,
} from './controller-fixture.ts';
import {
  checkAssignment,
  validateLayout,
} from '../../../controls/layout/validate.ts';
import { RoundRunner } from '../../engine/round.ts';
import { SessionAuthority } from '../../../core/session.ts';
import { encodeInput } from '../../../core/protocol.ts';
import type { ControllerConfig } from '../../../controls/api.ts';
import type { InputFrame, Message, Player } from '../../../core/types.ts';

void test('four-control layout passes production validation and preserves adapted button props', () => {
  assert.deepEqual(validateLayout(probeLayout), []);
  assert.deepEqual(checkAssignment(probeAssignment, probeLayout), []);
  const imported = importProbeLayout(exportProbeLayout(probeLayout));
  assert.deepEqual(imported, probeLayout);
  assert.equal(imported.items[3].variant, 'danger');
  assert.equal(imported.items[2].props?.icon, 'fire');
  imported.items[0].rect.x = 5;
  assert.equal(probeLayout.items[0].rect.x, 0);
});

void test('layout import rejects malformed, overlapping and incorrectly bound layouts', () => {
  assert.throws(() => importProbeLayout('{'));
  assert.throws(() => importProbeLayout('{"schemaVersion": 1}'), /structure/);
  const overlap = structuredClone(probeLayout);
  overlap.items[1].rect = { ...overlap.items[0].rect };
  assert.throws(() => importProbeLayout(JSON.stringify(overlap)), /overlaps/);
  const binding = structuredClone(probeLayout);
  binding.items[0].type = 'button';
  assert.throws(() => importProbeLayout(JSON.stringify(binding)), /vector/);
  const missing = structuredClone(probeLayout);
  missing.items.pop();
  assert.throws(() => importProbeLayout(JSON.stringify(missing)), /cancel/);
});

void test('preview ports keep simultaneous vectors and discrete actions independent', () => {
  const preview = new PreviewPorts(probeWidgets),
    [move, look, fire, cancel] = probeWidgets.map(preview.portFor),
    movement = { x: 0.75, y: -0.25 };
  move.value(movement);
  look.value({ x: -0.5, y: 0.5 });
  fire.press(true);
  fire.press(true);
  cancel.press(true);
  const readings = preview.readings();
  assert.deepEqual(readings.move.value, movement);
  assert.deepEqual(readings.look.value, { x: -0.5, y: 0.5 });
  assert.deepEqual(readings.fire, { held: true, activations: 1 });
  assert.deepEqual(readings.cancel, { held: true, activations: 1 });
  movement.x = 99;
  readings.move.value = null;
  readings.cancel.held = false;
  assert.deepEqual(preview.readings().move.value, { x: 0.75, y: -0.25 });
  assert.equal(preview.readings().cancel.held, true);
});

void test('release and cancellation neutralize inputs without generating activations', () => {
  const preview = new PreviewPorts(probeWidgets),
    [move, look, fire, cancel] = probeWidgets.map(preview.portFor);
  move.value({ x: 1, y: 0 });
  look.value({ x: 0, y: 1 });
  fire.press(true);
  cancel.press(true);
  // Existing views report pointer cancel and lost capture through press(false).
  fire.press(false);
  assert.equal(preview.readings().cancel.held, true);
  assert.equal(preview.readings().fire.held, false);
  preview.releaseAll();
  assert.deepEqual(preview.readings(), {
    move: { value: { x: 0, y: 0 }, held: false, activations: 0 },
    look: { value: { x: 0, y: 0 }, held: false, activations: 0 },
    fire: { held: false, activations: 1 },
    cancel: { held: false, activations: 1 },
  });
  fire.press(true);
  assert.equal(preview.readings().fire.activations, 2);
});

void test('SessionAuthority rejects delayed generic values from an old configuration', (t) => {
  let clock = 0;
  t.mock.method(performance, 'now', () => clock);
  const configs: Record<string, ControllerConfig> = {};
  // Observe the real public game boundary while leaving simulation behavior intact.
  const frames = t.mock.method(RoundRunner.prototype, 'tick');
  const players: Player[] = ['a', 'b'].map((id, seat) => ({
    id,
    seat,
    name: id,
    venueId: 'host',
    color: 'cyan',
    connected: true,
  }));
  const session = new SessionAuthority('host', {
    toPlayer: (id, message) => {
      if (message.type === 'config') configs[id] = message.config;
    },
    toVenue: () => {},
    snapshot: () => {},
    event: () => {},
    warning: () => {},
  });
  session.setRoster({
    players,
    venues: [{ id: 'host', name: 'Host', connected: true }],
  });
  session.start('neon-harvest', 'standard');
  for (const player of players)
    session.control(player.id, {
      type: 'ready',
      generation: configs[player.id].generation,
    });
  session.tick();
  const oldGeneration = configs.a.generation,
    delayed: Message = {
      type: 'widget',
      action: 'aim',
      value: { x: -0.8, y: 0.6 },
      // The obsolete envelope retains its original generation and sample time.
      generation: oldGeneration,
      seq: 1,
      time: clock,
    };
  clock = 4000;
  session.control('a', { type: 'hello', bootId: 'reconnected-phone' });
  assert.notEqual(configs.a.generation, oldGeneration);
  session.control('a', { type: 'ready', generation: configs.a.generation });
  session.control('a', {
    type: 'widget',
    action: 'aim',
    generation: configs.a.generation,
    seq: 0,
    time: clock,
    value: { x: 0.1, y: 0.2 },
  });
  // This old value is both the wrong generation and four seconds stale.
  session.control('a', delayed);
  const frame: InputFrame = {
    seq: 1,
    time: clock,
    generation: configs.a.generation,
    x: 0.5,
    y: 0.5,
    vx: 0,
    vy: 0,
    buttons: 0,
    edges: [0, 0, 0, 0],
    edgeTimes: [0, 0, 0, 0],
    confidence: 1,
  };
  session.input('a', encodeInput({ ...frame, generation: oldGeneration }));
  assert.equal(
    session.playerMetrics.size,
    0,
    'binary path rejects the old generation',
  );
  session.input('a', encodeInput(frame));
  session.tick();
  assert.deepEqual(frames.mock.calls.at(-1)?.arguments[2].a?.aim.value, {
    x: 0.55,
    y: 0.6,
  });
  assert.equal(frames.mock.calls.at(-1)?.arguments[2].a?.aim.time, clock);
});
