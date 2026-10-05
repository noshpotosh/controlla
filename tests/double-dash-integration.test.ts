import assert from 'node:assert/strict';
import test from 'node:test';
import { doubleDash } from '../src/client/minigames/double-dash/index.ts';
import {
  DoubleDash,
  isDoubleDashState,
  neutralController,
} from '../src/client/minigames/double-dash/game.ts';
import { findGame } from '../src/client/minigames/catalog.ts';
import { resolveController } from '../src/client/engine/input.ts';
import { defaultCapabilities } from '../src/client/controls/resolve.ts';
import { SessionAuthority } from '../src/client/engine/session.ts';
import { encodeInput } from '../src/client/engine/protocol.ts';
import type { ControllerConfig } from '../src/client/controls/api.ts';
import type { GameInput, Player } from '../src/client/api/index.ts';
import { isLocalGameRequest } from '../scripts/mario-kart/vite-plugin.ts';

const players: Player[] = ['a', 'b', 'c', 'd'].map((id, seat) => ({
  id,
  seat,
  venueId: 'host',
  name: id,
  color: '#fff',
  connected: true,
}));
void test('Double Dash resolves in the shared catalog with motion and touch controllers', () => {
  assert.equal(findGame('double-dash'), doubleDash);
  assert.equal(resolveController(doubleDash).widgets[0].type, 'stick');
  const capabilities = defaultCapabilities();
  capabilities.sensors.accel = { present: true, permission: 'granted' };
  const motion = resolveController(doubleDash, capabilities);
  assert.equal(motion.sensors.tilt.enabled, true);
  assert.equal(motion.widgets[0].type, 'tilt');
  assert.equal(
    motion.widgets.filter((widget) => widget.type === 'button').length,
    4,
  );
});
void test('room inputs map to four stable native ports, release and expire safely', () => {
  const game = new DoubleDash();
  game.load();
  game.start({ mode: 'free-play', players, startAt: 0, endAt: 3600000 });
  const input: GameInput = {
    phase: 'running',
    time: 100,
    dt: 16,
    presentationDelay: 0,
    actions: [],
    values: {
      a: {
        steer: { value: { x: -1, y: 0 }, time: 100 },
        accelerate: { value: true, time: 100 },
        drift: { value: true, time: 100 },
        options: { value: { x: 0, y: -1 }, time: 100 },
      },
      d: { item: { value: true, time: 100 } },
    },
  };
  game.tick(input);
  assert.equal(game.snapshot().controllers[0].mask, 1 | 64 | 16);
  assert.equal(game.snapshot().controllers[0].stickX, 1);
  assert.equal(game.snapshot().controllers[3].mask, 4);
  assert.equal(isDoubleDashState(game.snapshot()), true);
  const detached = game.snapshot();
  detached.controllers[0].mask = 0;
  assert.notEqual(game.snapshot().controllers[0].mask, 0);
  game.disconnect('a');
  assert.deepEqual(game.snapshot().controllers[0], neutralController());
  game.reconnect('a');
  game.tick({ ...input, time: 400 });
  assert.equal(game.snapshot().controllers[0].mask, 0);
  assert.equal(game.snapshot().controllers[0].stickX, 128);
  assert.ok(
    game
      .finalize()
      .every((outcome) => outcome.placement === 1 && outcome.score === 0),
  );
  game.dispose();
  assert.equal(game.ready(), false);
});
void test('authority delivers held buttons from existing binary phone frames and clears stale holds', (t) => {
  let clock = 0;
  t.mock.method(performance, 'now', () => clock);
  let config: ControllerConfig | null = null;
  const inputs: GameInput[] = [];
  const create = doubleDash.create.bind(doubleDash);
  t.mock.method(doubleDash, 'create', () => {
    const game = create(),
      tick = game.tick.bind(game);
    game.tick = (input) => {
      inputs.push(input);
      return tick(input);
    };
    return game;
  });
  const authority = new SessionAuthority('host', {
    toPlayer(_id, message) {
      if (message.type === 'config') config = message.config;
    },
    toVenue() {},
    snapshot() {},
    event() {},
    warning() {},
  });
  t.after(() => authority.dispose());
  authority.setRoster({
    players: [players[0]],
    venues: [{ id: 'host', name: 'Host', connected: true }],
  });
  authority.start('double-dash', 'free-play');
  authority.control('a', { type: 'ready', generation: config!.generation });
  authority.tick();
  clock = 4000;
  authority.input(
    'a',
    encodeInput({
      seq: 1,
      time: clock,
      generation: config!.generation,
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      buttons: 1,
      edges: [1, 0, 0, 0],
      edgeTimes: [clock, 0, 0, 0],
      confidence: 1,
    }),
  );
  authority.tick();
  assert.equal(inputs.at(-1)?.values.a.accelerate.value, true);
  clock += 260;
  authority.tick();
  assert.equal(inputs.at(-1)?.values.a.accelerate.value, false);
});
void test('local runtime proxy excludes LAN and tunnel requests', () => {
  assert.equal(isLocalGameRequest('localhost:3000', '127.0.0.1'), true);
  assert.equal(isLocalGameRequest('127.0.0.1:3000', '::ffff:127.0.0.1'), true);
  assert.equal(
    isLocalGameRequest('example.trycloudflare.com', '127.0.0.1'),
    false,
  );
  assert.equal(isLocalGameRequest('localhost:3000', '10.0.0.2'), false);
  assert.equal(isLocalGameRequest('10.0.0.170:3000', '127.0.0.1'), false);
});

void test('binary phone tilt steers the kart with held gas and drift, then expires', (t) => {
  let clock = 0;
  t.mock.method(performance, 'now', () => clock);
  let config: ControllerConfig | null = null;
  const game = new DoubleDash();
  t.mock.method(doubleDash, 'create', () => game);
  const authority = new SessionAuthority('host', {
    toPlayer(_id, message) {
      if (message.type === 'config') config = message.config;
    },
    toVenue() {}, snapshot() {}, event() {}, warning() {},
  });
  t.after(() => authority.dispose());
  authority.setRoster({
    players: [players[0]],
    venues: [{ id: 'host', name: 'Host', connected: true }],
  });
  const capabilities = defaultCapabilities();
  capabilities.sensors.accel = { present: true, permission: 'granted' };
  authority.control('a', { type: 'capabilities', capabilities });
  authority.start('double-dash', 'free-play');
  assert.equal(config!.widgets.find((widget) => widget.action === 'steer')?.type, 'tilt');
  authority.control('a', { type: 'ready', generation: config!.generation });
  authority.tick();
  clock = 4000;
  const send = (seq: number, x: number) => {
    authority.input('a', encodeInput({
      seq, time: clock, generation: config!.generation,
      x, y: 0, vx: 0, vy: 0, buttons: 5,
      edges: [1, 0, 1, 0], edgeTimes: [clock, 0, clock, 0], confidence: 1,
    }));
    authority.tick();
  };
  send(1, -1);
  assert.equal(game.snapshot().controllers[0].stickX, 1);
  assert.equal(game.snapshot().controllers[0].mask, 1 | 64);
  assert.equal(game.snapshot().controllers[0].analogA, 255);
  assert.equal(game.snapshot().controllers[0].triggerRight, 255);
  clock += 100;
  send(2, 1);
  clock += 100;
  send(3, 1);
  assert.equal(game.snapshot().controllers[0].stickX, 255);
  clock += 260;
  authority.tick();
  const released = game.snapshot().controllers[0];
  assert.equal(released.stickX, 128);
  assert.equal(released.mask, 0);
  assert.equal(released.analogA, 0);
  assert.equal(released.triggerRight, 0);
});
