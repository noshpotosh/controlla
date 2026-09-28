import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { Network } from '../src/client/network.ts';
import { APP_PROTOCOL_VERSION } from '../src/shared/app-protocol.ts';
import { SessionProgress } from '../src/client/engine/progress.ts';
import {
  historyMessages,
  ProgressAssembler,
} from '../src/client/engine/history.ts';
import type { Message } from '../src/core/types.ts';
import type { Identity, Player, Roster } from '../src/shared/room.ts';

const utf8 = new TextEncoder();
const players: Player[] = Array.from({ length: 8 }, (_, seat) => ({
  id: `player-${seat}`,
  venueId: 'venue',
  seat,
  name: `選手 ${seat}`,
  color: '#b6ff65',
  connected: true,
}));
function ledger(rounds: number) {
  const progress = new SessionProgress();
  const stats = Object.fromEntries(
    Array.from({ length: 12 }, (_, i) => ['s'.repeat(60) + i, 123.456789]),
  );
  for (let i = 0; i < rounds; i++)
    progress
      .open(
        'report-fixture',
        players.map((p) => p.id),
        { mode: 'tracking', players },
      )
      .complete(
        players.map((p, i) => ({
          playerId: p.id,
          placement: i + 1,
          score: 123,
          stats,
        })),
      );
  return progress;
}

function fixture(
  t: TestContext,
  transport: 'rtc' | 'relay' = 'relay',
  role: 'host' | 'display' = 'host',
) {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const delivered: { to: string; data: Message; route: string }[] = [];
  const warnings: string[] = [];
  class Socket {
    static OPEN = 1;
    static instances: Socket[] = [];
    readyState = 1;
    bufferedAmount = 0;
    onopen: (() => void) | null = null;
    onclose: (() => void) | null = null;
    onmessage: ((event: { data: string }) => void) | null = null;
    onerror: (() => void) | null = null;
    constructor() {
      Socket.instances.push(this);
    }
    send(serialized: string) {
      this.bufferedAmount += utf8.encode(serialized).byteLength;
      const message = JSON.parse(serialized) as Message;
      if (message.type === 'relay')
        delivered.push({ to: message.to, data: message.data, route: 'relay' });
    }
    close() {
      this.readyState = 3;
      this.onclose?.();
    }
    server(message: Message) {
      this.onmessage?.({ data: JSON.stringify(message) });
    }
  }
  class DataChannel {
    readyState = transport === 'rtc' ? 'open' : 'connecting';
    bufferedAmount = 0;
    to = '';
    send(serialized: string) {
      this.bufferedAmount += utf8.encode(serialized).byteLength;
      delivered.push({
        to: this.to,
        data: JSON.parse(serialized),
        route: 'rtc',
      });
    }
  }
  class Connection {
    connectionState = 'new';
    channels: DataChannel[] = [];
    createDataChannel() {
      const channel = new DataChannel();
      this.channels.push(channel);
      return channel;
    }
    createOffer() {
      return Promise.reject(new Error('Mock uses configured transport'));
    }
    getStats() {
      return Promise.resolve(new Map());
    }
    close() {
      for (const channel of this.channels) channel.readyState = 'closed';
    }
  }
  for (const [key, value] of Object.entries({
    WebSocket: Socket,
    RTCPeerConnection: Connection,
  })) {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, {
      configurable: true,
      writable: true,
      value,
    });
    t.after(() => {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    });
  }
  const network = new Network('ws://test', { role });
  t.after(() => network.close());
  network.onWarning = (message) => warnings.push(message);
  const roster: Roster = {
    players: structuredClone(players),
    venues: ['host', 'venue'].map((id) => ({ id, name: id, connected: true })),
  };
  const identity: Identity = {
    id: role === 'host' ? 'host' : 'venue',
    role,
    room: 'ROOM',
    venueId: role === 'host' ? 'host' : 'venue',
    token: 'token',
    hostId: 'host',
  };
  function welcome(socket: Socket) {
    socket.onopen?.();
    socket.server({
      type: 'welcome',
      protocolVersion: APP_PROTOCOL_VERSION,
      identity,
      iceServers: [],
    });
    socket.server({ type: 'roster', ...roster });
    for (const [id, peer] of network.peers)
      for (const channel of peer.channels.values())
        (channel as unknown as DataChannel).to = id;
    socket.bufferedAmount = 0;
  }
  network.connect();
  welcome(Socket.instances.at(-1)!);
  const socket = () => Socket.instances.at(-1)!;
  const ctrl = (to = 'venue') =>
    network.peers.get(to)!.channels.get('ctrl')! as unknown as DataChannel;
  function tick(drain = 8192) {
    socket().bufferedAmount = Math.max(0, socket().bufferedAmount - drain);
    for (const peer of network.peers.values())
      for (const channel of peer.channels.values()) {
        const mock = channel as unknown as DataChannel;
        mock.bufferedAmount = Math.max(0, mock.bufferedAmount - drain);
      }
    t.mock.timers.tick(50);
  }
  return { network, socket, ctrl, roster, delivered, warnings, tick, welcome };
}

void test('large eight-phone reports survive relay backpressure and hydrate every recipient', (t) => {
  const f = fixture(t);
  const progress = ledger(50).view();
  const messages = historyMessages(progress);
  const assemblers = new Map(
    [...players.map((p) => p.id), 'venue'].map((id) => [
      id,
      new ProgressAssembler(),
    ]),
  );
  f.socket().bufferedAmount = 70_000;
  for (const player of players)
    for (const message of messages)
      f.network.send('venue', 'ctrl', {
        type: 'toController',
        target: player.id,
        message,
      });
  for (const message of messages) f.network.send('venue', 'ctrl', message);
  f.tick(0);
  assert.equal(
    f.delivered.length,
    0,
    'history waits above its reserved transport budget',
  );
  f.network.send('venue', 'ctrl', { type: 'config', generation: 8 });
  f.network.send('venue', 'events', {
    type: 'event',
    event: { id: 'important' },
  });
  assert.deepEqual(
    f.delivered.map((entry) => entry.data.type),
    ['config', 'event'],
  );
  let consumed = 0;
  const complete = new Set<string>();
  for (let tick = 0; tick < 2000 && complete.size < assemblers.size; tick++) {
    f.tick();
    for (const entry of f.delivered.slice(consumed)) {
      const wrapped = entry.data.type === 'toController';
      const batch = wrapped ? entry.data.message : entry.data;
      if (batch.type === 'progressBatch') {
        const recipient = wrapped ? entry.data.target : 'venue';
        if (assemblers.get(recipient)!.receive(batch)) complete.add(recipient);
      }
    }
    consumed = f.delivered.length;
  }
  for (const assembler of assemblers.values())
    assert.deepEqual(assembler.view(), progress);
  assert.deepEqual(f.warnings, []);
});

void test('a congested open RTC channel retains history without spilling to relay, while control and events pass', (t) => {
  const f = fixture(t, 'rtc');
  const progress = ledger(1).view();
  f.ctrl().bufferedAmount = 70_000;
  const snapshots = f.network.peers
    .get('venue')!
    .channels.get('snapshot')! as unknown as { bufferedAmount: number };
  snapshots.bufferedAmount = 70_000;
  f.network.send('venue', 'snapshot', {
    type: 'snapshot',
    snapshot: { id: 1 },
  });
  for (const message of historyMessages(progress))
    f.network.send('venue', 'ctrl', message);
  f.tick(0);
  assert.equal(f.delivered.length, 0);
  f.network.send('venue', 'ctrl', { type: 'config', generation: 9 });
  f.network.send('venue', 'events', { type: 'event' });
  assert.deepEqual(
    f.delivered.map((entry) => [entry.route, entry.data.type]),
    [
      ['rtc', 'config'],
      ['rtc', 'event'],
    ],
  );
  const assembler = new ProgressAssembler();
  for (let i = 0; i < 20 && !assembler.view(); i++) {
    f.tick();
    for (const entry of f.delivered)
      if (entry.data.type === 'progressBatch') assembler.receive(entry.data);
  }
  assert.deepEqual(assembler.view(), progress);
  assert.equal(
    f.delivered.some((entry) => entry.route === 'relay'),
    false,
  );
});

void test('queued reports are immutable and newer revisions replace older pending chunks per logical recipient', (t) => {
  const f = fixture(t, 'rtc');
  const old = ledger(1).view();
  const latest = ledger(2).view();
  f.ctrl().bufferedAmount = 70_000;
  for (const message of historyMessages(old))
    f.network.send('venue', 'ctrl', {
      type: 'toController',
      target: players[0].id,
      message,
    });
  for (const message of historyMessages(latest)) {
    const wrapper = { type: 'toController', target: players[0].id, message };
    f.network.send('venue', 'ctrl', wrapper);
    wrapper.target = players[1].id;
    message.payload = 'caller mutation';
  }
  for (const message of historyMessages(old))
    f.network.send('venue', 'ctrl', {
      type: 'toController',
      target: players[0].id,
      message,
    });
  const assembler = new ProgressAssembler();
  for (let i = 0; i < 20 && !assembler.view(); i++) {
    f.tick(65536);
    for (const entry of f.delivered) {
      assert.equal(entry.data.target, players[0].id);
      assert.equal(entry.data.message.revision, latest.revision);
      assembler.receive(entry.data.message);
    }
  }
  assert.deepEqual(assembler.view(), latest);
  // A reloaded receiver can request the same revision again after its previous send drained.
  const before = f.delivered.length;
  for (const message of historyMessages(latest))
    f.network.send('venue', 'ctrl', {
      type: 'toController',
      target: players[0].id,
      message,
    });
  f.tick(65536);
  assert.ok(f.delivered.length > before);
});

void test('roster removal discards queued controller targets without discarding connected targets', (t) => {
  const f = fixture(t);
  f.socket().bufferedAmount = 70_000;
  const progress = ledger(1).view();
  for (const player of players.slice(0, 2))
    for (const message of historyMessages(progress))
      f.network.send('venue', 'ctrl', {
        type: 'toController',
        target: player.id,
        message,
      });
  f.roster.players[0].connected = false;
  f.socket().server({ type: 'roster', ...f.roster });
  f.tick(100_000);
  assert.ok(f.delivered.length > 0);
  assert.ok(f.delivered.every((entry) => entry.data.target === players[1].id));
});

void test('reconnect, session end, and explicit close discard queued report lifetimes', (t) => {
  const f = fixture(t, 'relay', 'display');
  const messages = historyMessages(ledger(1).view());
  f.socket().bufferedAmount = 70_000;
  for (const message of messages)
    f.network.send(players[0].id, 'ctrl', message);
  f.socket().close();
  t.mock.timers.tick(500);
  f.welcome(f.socket());
  f.tick(100_000);
  assert.equal(f.delivered.length, 0);
  for (const message of messages)
    f.network.send(players[0].id, 'ctrl', message);
  f.socket().server({ type: 'ended', reason: 'Host left' });
  f.tick(100_000);
  assert.equal(f.delivered.length, 0);
  f.network.close();
  f.tick(100_000);
  assert.equal(f.delivered.length, 0);
});

void test('the aggregate history cap is explicit and closing cancels a blocked queue', (t) => {
  const f = fixture(t);
  f.socket().bufferedAmount = 70_000;
  const payload = '界'.repeat(8192);
  for (const player of players)
    for (let index = 0; index < 512; index++) {
      f.network.send('venue', 'ctrl', {
        type: 'toController',
        target: player.id,
        message: {
          type: 'progressBatch',
          revision: 1,
          count: 512,
          index,
          payload,
        },
      });
    }
  assert.ok(
    f.warnings.some((warning) => /report delivery is full/.test(warning)),
  );
  f.network.send('venue', 'ctrl', { type: 'config', generation: 10 });
  assert.equal(f.delivered.at(-1)?.data.type, 'config');
  f.network.close();
  f.tick(100_000);
  assert.equal(
    f.delivered.some((entry) => entry.data.type === 'toController'),
    false,
  );
});
