import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { Runtime } from '../src/client/runtime.ts';
import { encodeInput } from '../src/client/engine/protocol.ts';
import {
  defaultCapabilities,
  resolveConfig,
} from '../src/client/controls/resolve.ts';
import { pointerSpec } from './fixtures/games.ts';
import type { InputFrame } from '../src/client/engine/protocol.ts';
import type { Message } from '../src/client/engine/messages.ts';
import type { Roster } from '../src/shared/room.ts';

function localVenue(t: TestContext, role: 'host' | 'display') {
  let time = 10000;
  t.mock.method(performance, 'now', () => time);
  t.after(() => runtime.close());
  for (const [name, value] of Object.entries({
    document: Object.assign(new EventTarget(), { hidden: false }),
    window: Object.assign(new EventTarget(), { devicePixelRatio: 1 }),
    navigator: { maxTouchPoints: 1 },
    innerWidth: 800,
    innerHeight: 600,
  })) {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { configurable: true, value });
    t.after(() => {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    });
  }
  const runtime = new Runtime({ role, endpoint: 'ws://unused' });
  const id = role === 'host' ? 'host' : 'remote';
  runtime.view.identity = {
    id,
    role,
    hostId: 'host',
    venueId: id,
    room: 'TEST',
    token: 'token',
  };
  runtime.view.status = 'Connected';
  const roster: Roster = {
    players: [
      {
        id: 'phone',
        name: 'Ada',
        color: '#00ff88',
        connected: true,
        venueId: id,
        seat: 0,
      },
    ],
    venues: [
      { id: 'host', name: 'Host', connected: true },
      { id: 'remote', name: 'Remote', connected: true },
    ],
  };
  runtime.view.roster = structuredClone(roster);
  const sent: { id: string; channel: string; message: unknown }[] = [];
  t.mock.method(
    runtime.network,
    'send',
    (id: string, channel: string, message: unknown) => {
      sent.push({ id, channel, message });
    },
  );
  const config = (generation: number) => {
    const message = {
      type: 'config',
      config: resolveConfig(pointerSpec, defaultCapabilities(), generation),
    };
    if (role === 'host')
      (
        runtime as unknown as { toPlayer(id: string, message: Message): void }
      ).toPlayer('phone', message);
    else
      runtime.network.onMessage('host', 'ctrl', {
        type: 'toController',
        target: 'phone',
        message,
      });
  };
  const control = (message: Message) =>
    runtime.network.onMessage('phone', 'ctrl', message);
  const input = (overrides: Partial<InputFrame> = {}) => {
    const frame: InputFrame = {
      generation: 7,
      seq: 1,
      time,
      x: 0.8,
      y: 0.4,
      vx: 0,
      vy: 0,
      buttons: 0,
      edges: [0, 0, 0, 0],
      edgeTimes: [0, 0, 0, 0],
      confidence: 1,
      ...overrides,
    };
    runtime.network.onMessage('phone', 'input', encodeInput(frame));
  };
  const point = () =>
    runtime.cursors().find((cursor) => cursor.id === 'phone')?.point;
  return {
    runtime,
    sent,
    roster,
    config,
    control,
    input,
    point,
    at: (at: number) => {
      time = at;
    },
  };
}

for (const role of ['host', 'display'] as const)
  void test(`${role} local cursor follows config and ACK, rejecting stale generations and reordered binary input`, (t) => {
    const h = localVenue(t, role);
    h.input();
    assert.equal(
      h.point(),
      undefined,
      'unconfigured input cannot establish a cursor generation',
    );
    h.config(7);
    assert.equal(
      h.sent.at(-1)?.id,
      'phone',
      'the config still reaches its local phone',
    );
    h.input();
    h.control({ type: 'ready', generation: 6 });
    h.input();
    assert.equal(
      h.point(),
      undefined,
      'only a current-generation ACK opens the immediate path',
    );
    h.control({ type: 'ready', generation: 7 });
    h.input({ seq: 11 });
    const latest = { ...h.point()! };
    h.input({ seq: 10, x: 0.1 });
    h.input({ seq: 11, x: 0.2 });
    h.input({ seq: 12, generation: 6, x: 0.3 });
    h.input({ seq: 12, time: 7000, x: 0.3 });
    h.input({ seq: 12, time: 10200, x: 0.3 });
    assert.deepEqual(h.point(), latest);
    h.config(7);
    h.input({ seq: 10, x: 0.1 });
    assert.deepEqual(
      h.point(),
      latest,
      'duplicate configs do not retire ordering',
    );
    h.config(8);
    assert.equal(
      h.point(),
      undefined,
      'a new config removes the old cursor immediately',
    );
    h.control({ type: 'ready', generation: 7 });
    h.input({ generation: 8, seq: 0 });
    assert.equal(h.point(), undefined);
    h.control({ type: 'ready', generation: 8 });
    h.input({ generation: 7, seq: 12 });
    assert.equal(h.point(), undefined);
    h.input({ generation: 8, seq: 65535, x: 0.25 });
    h.input({ generation: 8, seq: 0, x: 0.75 });
    h.input({ generation: 8, seq: 65535, x: 0.25 });
    assert.equal(
      h.point()?.x,
      0.75,
      'sequence wrap keeps forward movement and rejects the old tail',
    );
    const frame = h.runtime.screenPort.advanceFrame();
    assert.ok(Object.isFrozen(frame.localCursors));
    assert.ok(Object.isFrozen(frame.localCursors.phone));
    assert.throws(() => {
      (frame.localCursors.phone as { x: number }).x = 0;
    }, TypeError);
    h.input({ generation: 8, seq: 1, x: 0.5 });
    assert.equal(
      frame.localCursors.phone.x,
      0.75,
      'presentation reads remain detached from later packets',
    );
    assert.equal(h.point()?.x, 0.5);
  });

void test('local cursor cleanup closes admission on disconnect, relocation, hello, reconnect, and session end', (t) => {
  const h = localVenue(t, 'display');
  const ready = () => {
    h.config(7);
    h.control({ type: 'ready', generation: 7 });
    h.input();
  };
  ready();
  h.control({ type: 'hello', bootId: 'reloaded-phone' });
  h.input({ seq: 2, x: 0.1 });
  assert.equal(
    h.point(),
    undefined,
    'a phone handshake waits for configuration acknowledgement again',
  );
  h.config(7);
  h.control({ type: 'ready', generation: 7 });
  h.input({ seq: 2 });
  assert.ok(h.point());
  const disconnected = structuredClone(h.roster);
  disconnected.players[0].connected = false;
  h.runtime.network.onRoster(disconnected);
  h.config(7);
  h.control({ type: 'ready', generation: 7 });
  h.input({ seq: 3 });
  assert.equal(h.point(), undefined);
  h.runtime.network.onRoster(h.roster);
  h.input({ seq: 4 });
  assert.equal(
    h.point(),
    undefined,
    'roster return alone cannot revive old admission',
  );
  ready();
  const moved = structuredClone(h.roster);
  moved.players[0].venueId = 'host';
  h.runtime.network.onRoster(moved);
  h.input({ seq: 2 });
  assert.equal(h.point(), undefined);
  h.runtime.network.onRoster(h.roster);
  ready();
  h.runtime.network.onStatus('Reconnecting…');
  h.input({ seq: 2 });
  assert.equal(h.point(), undefined);
  ready();
  h.runtime.network.onEnded('Host left');
  ready();
  assert.equal(
    h.point(),
    undefined,
    'late callbacks cannot repopulate an ended presentation',
  );
});

void test('rejected duplicate packets do not keep a stalled local cursor alive', (t) => {
  const h = localVenue(t, 'display');
  h.config(7);
  h.control({ type: 'ready', generation: 7 });
  h.input();
  h.at(10900);
  h.input({ time: 10000 });
  h.at(11001);
  assert.equal(
    h.point(),
    undefined,
    'the one-second display expiry uses the last accepted packet',
  );
});
