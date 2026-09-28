import assert from 'node:assert/strict';
import test from 'node:test';
import { SessionRouter } from '../src/client/runtime/session-routing/session-router.ts';
import { encodeInput, type InputFrame } from '../src/client/engine/protocol.ts';
import type { Channel, Message } from '../src/client/engine/messages.ts';
import type { Identity, Role, Roster } from '../src/shared/room.ts';

function fixture(role: Role = 'host') {
  let time = 10000;
  const queued: (() => void)[] = [];
  const sent: { to: string; channel: Channel; data: Message | ArrayBuffer }[] =
    [];
  const input: { id: string; data: ArrayBuffer }[] = [];
  const control: { id: string; message: Message }[] = [];
  const display: { channel: Channel; message: Message }[] = [];
  const controller: Message[] = [];
  const identity: Identity = {
    id: role === 'host' ? 'host' : role === 'display' ? 'venue' : 'phone',
    role,
    hostId: 'host',
    venueId: role === 'host' ? 'host' : 'venue',
    room: 'TEST',
    token: 'secret',
  };
  const roster: Roster = {
    players: [
      {
        id: 'local',
        venueId: 'host',
        seat: 0,
        name: 'Ada',
        color: 'red',
        connected: true,
      },
      {
        id: 'phone',
        venueId: 'venue',
        seat: 1,
        name: 'Bea',
        color: 'blue',
        connected: true,
      },
    ],
    venues: [
      { id: 'host', name: 'Host', connected: true },
      { id: 'venue', name: 'Venue', connected: true },
    ],
  };
  const router = new SessionRouter(
    {
      localTime: () => time,
      authorityTime: () => time,
      defer: (fn) => queued.push(fn),
    },
    {
      send: (to, channel, data) => sent.push({ to, channel, data }),
      authorityInput: (id, data) => input.push({ id, data }),
      authorityControl: (id, message) => control.push({ id, message }),
      display: (channel, message) => display.push({ channel, message }),
      controller: (message) => controller.push(message),
    },
  );
  router.welcome(identity);
  router.setRoster(roster);
  const frame = (changes: Partial<InputFrame> = {}) =>
    encodeInput({
      seq: 1,
      generation: 7,
      time,
      x: 0.75,
      y: 0.25,
      vx: 0,
      vy: 0,
      buttons: 0,
      edges: [0, 0, 0, 0],
      edgeTimes: [0, 0, 0, 0],
      confidence: 1,
      ...changes,
    });
  const config = (generation = 7): Message => ({
    type: 'config',
    config: { schemaVersion: 1, generation },
  });
  const local = role === 'host' ? 'local' : 'phone';
  const ready = () => {
    if (role === 'host') router.toPlayer(local, config());
    else
      router.receive('host', 'ctrl', {
        type: 'toController',
        target: local,
        message: config(),
      });
    router.receive(local, 'ctrl', { type: 'ready', generation: 7 });
  };
  return {
    router,
    identity,
    roster,
    sent,
    input,
    control,
    display,
    controller,
    queued,
    frame,
    config,
    ready,
    local,
    at: (at: number) => {
      time = at;
    },
    flush: () => {
      while (queued.length) queued.shift()!();
    },
  };
}

void test('host routes local/remote deliveries and upstream control without leaking mutable identity or roster', () => {
  const h = fixture();
  h.identity.id = 'mutated';
  h.roster.players[0].venueId = 'mutated';
  h.router.sendUp({ type: 'clock' });
  assert.equal(h.control[0].id, 'host');
  h.router.toPlayer('local', h.config());
  h.router.toPlayer('phone', h.config());
  h.router.toPlayer('unknown', h.config());
  assert.deepEqual(
    h.sent.map(({ to, data }) => [to, (data as Message).type]),
    [
      ['local', 'config'],
      ['venue', 'toController'],
    ],
  );
  h.router.toVenue('venue', 'snapshot', { type: 'snapshot' });
  assert.equal(h.sent.at(-1)!.channel, 'snapshot');
  h.router.sendFrame(h.frame());
  assert.equal(h.sent.length, 3, 'only controllers emit upstream frames');
});

void test('controller switches both reliable and binary paths while admitting only host/venue control', () => {
  const h = fixture('controller');
  for (const route of ['venue', 'direct-to-session'] as const) {
    h.router.setControllerRoute(route);
    h.router.sendUp({ type: 'ready' });
    h.router.sendFrame(h.frame());
  }
  assert.deepEqual(
    h.sent.map(({ to, channel }) => [to, channel]),
    [
      ['venue', 'ctrl'],
      ['venue', 'input'],
      ['host', 'ctrl'],
      ['host', 'input'],
    ],
  );
  h.router.receive('stranger', 'ctrl', h.config());
  h.router.receive('host', 'events', h.config());
  h.router.receive('venue', 'ctrl', h.config());
  h.router.receive('host', 'ctrl', h.config());
  assert.equal(h.controller.length, 2);
});

void test('display relays its own players with seat/identity envelopes and admits only host delivery', () => {
  const h = fixture('display');
  const bytes = h.frame();
  h.router.receive('phone', 'input', bytes);
  const relayed = h.sent[0].data as ArrayBuffer;
  assert.equal(relayed.byteLength, 48);
  assert.equal(new Uint8Array(relayed)[0], 1);
  assert.deepEqual(relayed.slice(1), bytes);
  h.router.receive('phone', 'ctrl', { type: 'hello' });
  assert.deepEqual(h.sent[1].data, {
    type: 'fromController',
    playerId: 'phone',
    message: { type: 'hello' },
  });
  h.router.receive('local', 'input', bytes);
  h.router.receive('stranger', 'ctrl', {
    type: 'toController',
    target: 'phone',
    message: h.config(),
  });
  h.router.receive('host', 'ctrl', {
    type: 'toController',
    target: 'local',
    message: h.config(),
  });
  assert.equal(h.sent.length, 2);
  h.router.receive('host', 'ctrl', {
    type: 'toController',
    target: 'phone',
    message: h.config(),
  });
  assert.equal(h.sent.at(-1)!.to, 'phone');
  h.router.receive('host', 'snapshot', { type: 'snapshot' });
  h.router.sendUp({ type: 'venueHello' });
  assert.equal(h.display.length, 1);
  assert.equal(h.sent.at(-1)!.to, 'host');
});

void test('host accepts direct controller fallback and validates venue membership before unwrapping relays', () => {
  const h = fixture();
  const bytes = h.frame();
  const relay = new Uint8Array(48);
  relay[0] = 1;
  relay.set(new Uint8Array(bytes), 1);
  h.router.receive('phone', 'input', bytes);
  h.router.receive('venue', 'input', relay.buffer);
  h.router.receive('venue', 'ctrl', {
    type: 'fromController',
    playerId: 'phone',
    message: { type: 'hello' },
  });
  h.router.receive('venue', 'ctrl', { type: 'venueHello' });
  assert.deepEqual(
    h.input.map(({ id }) => id),
    ['phone', 'phone'],
  );
  assert.deepEqual(h.input[1].data, bytes);
  assert.deepEqual(
    h.control.map(({ id }) => id),
    ['phone', 'venue'],
  );
  relay[0] = 0;
  h.router.receive('venue', 'input', relay.buffer);
  h.router.receive('venue', 'ctrl', {
    type: 'fromController',
    playerId: 'local',
    message: { type: 'hello' },
  });
  h.router.receive('stranger', 'ctrl', { type: 'venueHello' });
  h.router.receive('venue', 'input', new ArrayBuffer(47));
  h.roster.venues[1].connected = false;
  h.router.setRoster(h.roster);
  h.router.receive('venue', 'ctrl', { type: 'venueHello' });
  assert.equal(h.input.length, 2);
  assert.equal(h.control.length, 2);
});

void test('malformed direct frames are rejected but valid stale cursor frames still reach authority', () => {
  const h = fixture();
  h.router.receive('local', 'input', new ArrayBuffer(2));
  const bad = h.frame();
  new Uint8Array(bad)[0] = 99;
  h.router.receive('local', 'input', bad);
  assert.equal(h.input.length, 0);
  h.ready();
  h.router.receive('local', 'input', h.frame({ time: 7000 }));
  h.router.receive('local', 'input', h.frame({ time: 10200 }));
  h.router.receive('local', 'input', h.frame({ generation: 6 }));
  assert.equal(h.input.length, 3);
  assert.equal(h.router.cursors().length, 0);
});

for (const role of ['host', 'display'] as const)
  void test(`${role} cursor requires config ACK, preserves ordering, freezes observations and expires`, () => {
    const h = fixture(role);
    h.router.receive(h.local, 'input', h.frame());
    h.router.receive(h.local, 'ctrl', { type: 'ready', generation: 7 });
    assert.equal(h.router.cursors().length, 0);
    h.ready();
    h.router.receive(h.local, 'input', h.frame({ seq: 65535 }));
    h.router.receive(h.local, 'input', h.frame({ seq: 0, x: 0.5 }));
    const snapshot = h.router.cursors();
    assert.equal(snapshot[0].point.x, 0.5);
    assert.throws(() => {
      (snapshot[0].point as { x: number }).x = 0;
    }, TypeError);
    h.router.receive(h.local, 'input', h.frame({ seq: 65535 }));
    h.at(10900);
    h.router.receive(h.local, 'input', h.frame({ seq: 0 }));
    assert.equal(h.router.cursors()[0].point.x, 0.5);
    h.at(11000);
    assert.equal(h.router.cursors().length, 0);
    assert.equal(snapshot[0].point.x, 0.5);
    h.router.receive(h.local, 'input', h.frame({ seq: 1 }));
    h.router.receive(h.local, 'ctrl', { type: 'hello' });
    h.router.receive(h.local, 'input', h.frame({ seq: 2 }));
    assert.equal(h.router.cursors().length, 0);
    h.ready();
    h.router.receive(h.local, 'input', h.frame({ seq: 2 }));
    assert.equal(h.router.cursors().length, 1);
    h.roster.players.find((p) => p.id === h.local)!.connected = false;
    h.router.setRoster(h.roster);
    assert.equal(h.router.cursors().length, 0);
    h.roster.players.find((p) => p.id === h.local)!.connected = true;
    h.router.setRoster(h.roster);
    h.router.receive(h.local, 'ctrl', { type: 'ready', generation: 7 });
    h.router.receive(h.local, 'input', h.frame({ seq: 3 }));
    assert.equal(h.router.cursors().length, 0);
  });

void test('host-local delivery is deferred, ordered, and copied at scheduling time', () => {
  const h = fixture();
  const message = { type: 'phase', payload: { value: 1 } };
  h.router.toVenue('host', 'ctrl', message);
  message.payload.value = 9;
  h.router.toVenue('host', 'events', { type: 'event' });
  assert.equal(h.display.length, 0);
  h.flush();
  assert.deepEqual(h.display, [
    { channel: 'ctrl', message: { type: 'phase', payload: { value: 1 } } },
    { channel: 'events', message: { type: 'event' } },
  ]);
});

for (const operation of ['disconnect', 'welcome', 'end', 'dispose'] as const)
  void test(`${operation} retires queued delivery and cursor admission`, () => {
    const h = fixture();
    h.ready();
    h.router.receive('local', 'input', h.frame());
    h.router.toVenue('host', 'ctrl', { type: 'phase' });
    if (operation === 'welcome') h.router.welcome(h.identity);
    else h.router[operation]();
    h.flush();
    assert.equal(h.display.length, 0);
    assert.equal(h.router.cursors().length, 0);
    const before = h.sent.length + h.control.length + h.input.length;
    if (operation !== 'welcome') {
      h.router.sendUp({ type: 'hello' });
      h.router.toPlayer('local', h.config());
      h.router.toVenue('venue', 'ctrl', { type: 'phase' });
      h.router.receive('local', 'input', h.frame());
      assert.equal(h.sent.length + h.control.length + h.input.length, before);
    }
    h.router.welcome(h.identity);
    h.router.setRoster(h.roster);
    h.router.receive('local', 'ctrl', { type: 'ready', generation: 7 });
    h.router.receive('local', 'input', h.frame({ seq: 2 }));
    assert.equal(
      h.router.cursors().length,
      0,
      'old ACK alone cannot restore admission',
    );
    h.ready();
    h.router.receive('local', 'input', h.frame({ seq: 3 }));
    assert.equal(
      h.router.cursors().length,
      operation === 'end' || operation === 'dispose' ? 0 : 1,
    );
    h.router.dispose();
    h.router.dispose();
  });
