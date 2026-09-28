import { games } from '../src/client/minigames/catalog.ts';
import type { GameDescriptor } from '../src/client/api/index.ts';
import {
  pointerManifest,
  steeringManifest,
  buttonProbe,
  type ProbeState,
} from './fixtures/games.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  encodeInput,
  decodeInput,
  INPUT_BYTES,
  TIME_WRAP_MS,
  SequenceWindow,
  newer,
} from '../src/core/protocol.ts';
import {
  ClockSync,
  Equalizer,
  Samples,
  ContinuousBuffer,
} from '../src/core/timing.ts';
import {
  SnapshotTimeline,
  SnapshotEncoder,
  type SnapshotPolicy,
} from '../src/core/snapshots.ts';
import { defaultCapabilities, resolveConfig } from '../src/core/config.ts';
import { SessionAuthority } from '../src/core/session.ts';
import type { RoundSnapshot } from '../src/client/api/index.ts';
import type {
  InputFrame,
  Player,
  Snapshot,
  Message,
  ControllerConfig,
  WireSnapshot,
} from '../src/core/types.ts';
const frame = (time = 1000): InputFrame => ({
  seq: 65535,
  time,
  generation: 5,
  x: 0.3,
  y: 0.8,
  vx: 1,
  vy: -2,
  buttons: 1,
  edges: [1, 0, 0, 0],
  edgeTimes: [time - 5, 0, 0, 0],
  confidence: 0.8,
});
const players: Player[] = [
  {
    id: 'a',
    venueId: 'host',
    seat: 0,
    name: 'Ada',
    color: 'green',
    connected: true,
  },
  {
    id: 'b',
    venueId: 'remote',
    seat: 1,
    name: 'Ben',
    color: 'blue',
    connected: true,
  },
];
const almost = (a: number, b: number, eps = 1e-5) =>
  assert.ok(Math.abs(a - b) < eps, `${a} differs from ${b}`);
void test('binary input is under 60 bytes and round trips off-screen positions', () => {
  const f = frame();
  f.x = -0.4;
  const data = encodeInput(f);
  assert.equal(data.byteLength, INPUT_BYTES);
  assert.ok(data.byteLength < 60);
  const out = decodeInput(data, 1000);
  almost(out.x, f.x);
  assert.equal(out.seq, 65535);
  assert.equal(out.edgeTimes[0], 995);
  assert.equal(out.generation, 5);
});
void test('u32 microseconds unwrap across 71-minute boundary', () => {
  const f = frame(TIME_WRAP_MS * 3 + 10);
  const out = decodeInput(encodeInput(f), f.time + 8);
  almost(out.time, f.time, 0.001);
  almost(out.edgeTimes[0], f.edgeTimes[0], 0.001);
});
void test('malformed and non-finite input is rejected', () => {
  assert.throws(() => decodeInput(new ArrayBuffer(4), 0));
  const b = encodeInput(frame());
  new DataView(b).setFloat32(9, NaN, true);
  assert.throws(() => decodeInput(b, 0));
});
void test('sequence ordering wraps and reordered frames repair loss without replay', () => {
  const w = new SequenceWindow();
  assert.equal(w.accept(65534), true);
  assert.equal(w.accept(0), true);
  assert.equal(w.lost, 1);
  assert.equal(w.accept(65535), false);
  assert.equal(w.lost, 0);
  assert.equal(w.accept(0), false);
  assert.equal(newer(1, 65535), true);
});
void test('minimum-RTT clock sample wins on join and drift correction is slow', () => {
  const c = new ClockSync();
  c.observe(0, 110, 110, 20);
  almost(c.offset, 100);
  c.observe(100, 230, 230, 140);
  almost(c.offset, 100);
  for (let i = 0; i < 8; i++) c.observe(0, 110, 110, 20);
  c.observe(0, 115, 115, 20);
  assert.ok(c.offset > 100 && c.offset < 105);
});
void test('common presentation timeline includes interpolation once; single venue target is zero', () => {
  const e = new Equalizer(),
    host = new Samples(),
    remote = new Samples();
  host.add(0);
  remote.add(50);
  e.update(
    new Map([
      ['host', host],
      ['remote', remote],
    ]),
  );
  assert.equal(e.target, 140);
  assert.equal(e.limitingVenue, 'remote');
  e.tick(100);
  assert.equal(e.current, 5);
  e.update(new Map([['host', host]]));
  assert.equal(e.target, 0);
  e.tick(100);
  assert.equal(e.current, 0);
});
void test('continuous buffer bounds extrapolation even after a stall', () => {
  const b = new ContinuousBuffer<InputFrame>();
  b.push(frame(100), 110);
  const f = b.sample(1000)!;
  assert.equal(b.horizon, 30);
  almost(f.x, 0.33);
  assert.ok(b.depth <= 20);
});
void test('permission denial chooses stick per player, never a dead pointer', () => {
  const c = defaultCapabilities();
  c.sensors.gyro = { present: true, permission: 'denied' };
  const config = resolveConfig(pointerManifest, c, 4);
  assert.equal(config.sensors.pointer.enabled, false);
  assert.equal(config.widgets[0].type, 'stick');
  assert.equal(config.widgets[0].space, 'normalized');
  assert.equal(
    resolveConfig(steeringManifest, c, 5).widgets[0].space,
    'signed',
  );
  assert.equal(config.substitutions.length, 1);
  c.sensors.gyro.permission = 'granted';
  c.sensors.accel = { present: true, permission: 'granted' };
  assert.equal(
    resolveConfig(pointerManifest, c, 5).sensors.pointer.enabled,
    true,
  );
  assert.equal(
    resolveConfig(steeringManifest, c, 6).sensors.pointer.enabled,
    false,
  );
  assert.equal(
    resolveConfig(steeringManifest, c, 6).sensors.tilt.enabled,
    true,
  );
});
void test('required motion without fallback gives an actionable failure', () => {
  assert.throws(
    () =>
      resolveConfig(
        {
          ...pointerManifest,
          // No layout, so no touch control can stand in for the pointer.
          controller: undefined,
          inputs: { aim: { required: true, prefer: 'pointer' } },
        },
        defaultCapabilities(),
        1,
      ),
    /Motion access is off/,
  );
});
const probePolicy: SnapshotPolicy<ProbeState> = {
  valid: (value): value is ProbeState => buttonProbe.isState(value),
  interpolate(before, after, ratio) {
    for (const id in before.cursors)
      if (after.cursors[id])
        before.cursors[id] = {
          x:
            before.cursors[id].x +
            (after.cursors[id].x - before.cursors[id].x) * ratio,
          y: before.cursors[id].y,
        };
    return before;
  },
};
const snapshot = (
  id: number,
  time: number,
  x: number,
): Snapshot<ProbeState> => ({
  id,
  time,
  state: {
    scores: { a: id * 10 },
    cursors: { a: { x, y: 0.5 } },
    actions: [],
    elapsed: time,
    flag: false,
  },
});
void test('delta compression uses only acknowledged bases and recovers missing bases', () => {
  const enc = new SnapshotEncoder<ProbeState>(),
    buf = new SnapshotTimeline(probePolicy),
    a = snapshot(1, 100, 0.2),
    b = snapshot(2, 140, 0.4);
  enc.add(a);
  const first = enc.forPeer('v', a);
  assert.equal(first.base, null);
  assert.equal(buf.receive(first), true);
  enc.ack('v', 1);
  enc.add(b);
  const delta = enc.forPeer('v', b);
  assert.equal(delta.base, 1);
  assert.equal(new SnapshotTimeline(probePolicy).receive(delta), false);
  assert.equal(buf.receive(delta), true);
  assert.equal(buf.history.get(2)!.state.cursors.a.x, 0.4);
});
void test('snapshot interpolation blends positions, not scores, and never exposes the future', () => {
  const buf = new SnapshotTimeline(probePolicy);
  for (const s of [snapshot(1, 100, 0.2), snapshot(2, 200, 0.8)])
    buf.receive({ id: s.id, time: s.time, base: null, patch: s.state });
  assert.equal(buf.sample(99), null);
  const middle = buf.sample(150)!;
  almost(middle.cursors.a.x, 0.5);
  assert.equal(middle.scores.a, 10);
  middle.cursors.a.x = 999;
  assert.equal(buf.history.get(1)!.state.cursors.a.x, 0.2);
});
void test('reordered snapshots do not regress presentation', () => {
  const buf = new SnapshotTimeline(probePolicy);
  for (const s of [snapshot(2, 200, 0.8), snapshot(1, 100, 0.2)])
    buf.receive({ id: s.id, time: s.time, base: null, patch: s.state });
  almost(buf.sample(150)!.cursors.a.x, 0.5);
});
void test('session gates start on configuration ACK and rejects stale generation', (t) => {
  (games as GameDescriptor[]).push(buttonProbe);
  t.after(() =>
    (games as GameDescriptor[]).splice(games.indexOf(buttonProbe), 1),
  );
  const configs: Message[] = [];
  const session = new SessionAuthority('host', {
    toPlayer: (id, m) => {
      if (m.type === 'config') configs.push({ id, ...m });
    },
    toVenue: () => {},
    snapshot: () => {},
    event: () => {},
    warning: () => {},
  });
  session.setRoster({
    players,
    venues: [
      { id: 'host', name: 'Host', connected: true },
      { id: 'remote', name: 'Remote', connected: true },
    ],
  });
  session.start(buttonProbe.id, 'standard');
  assert.throws(() => session.start(buttonProbe.id, 'standard'));
  const generation = configs.filter((m) => m.id === 'a').at(-1)!
    .config.generation;
  assert.ok(generation > configs[0].config.generation);
  session.input('a', encodeInput({ ...frame(performance.now()), generation }));
  assert.equal(session.playerMetrics.size, 0);
  for (const p of players)
    session.control(p.id, {
      type: 'ready',
      generation: configs.filter((m) => m.id === p.id).at(-1)!.config
        .generation,
    });
  session.input(
    'a',
    encodeInput({
      ...frame(performance.now()),
      generation: configs[0].config.generation,
    }),
  );
  assert.equal(session.playerMetrics.size, 0);
  session.input('a', encodeInput({ ...frame(performance.now()), generation }));
  assert.equal(session.playerMetrics.size, 1);
  session.tick();
  assert.doesNotThrow(() => structuredClone(session.summary()));
});
void test('lost input frames recover an edge once and preserve its original timestamp', (t) => {
  (games as GameDescriptor[]).push(buttonProbe);
  t.after(() =>
    (games as GameDescriptor[]).splice(games.indexOf(buttonProbe), 1),
  );
  let clock = 0;
  t.mock.method(performance, 'now', () => clock);
  const configs: Record<string, ControllerConfig> = {},
    snapshots: WireSnapshot<RoundSnapshot<ProbeState>>[] = [];
  const session = new SessionAuthority('host', {
    toPlayer: (id, m) => {
      if (m.type === 'config') configs[id] = m.config;
    },
    toVenue: () => {},
    snapshot: (_id, m) => snapshots.push(m.snapshot),
    event: () => {},
    warning: () => {},
  });
  session.setRoster({
    players,
    venues: [
      { id: 'host', name: 'Host', connected: true },
      { id: 'remote', name: 'Remote', connected: true },
    ],
  });
  session.start(buttonProbe.id, 'standard');
  for (const p of players)
    session.control(p.id, {
      type: 'ready',
      generation: configs[p.id].generation,
    });
  session.tick();
  clock = 4000;
  session.tick();
  const f = {
    ...frame(4000),
    generation: configs.a.generation,
    edges: [1, 0, 0, 0],
    edgeTimes: [3950, 0, 0, 0],
    seq: 2,
  };
  session.input('a', encodeInput(f));
  session.control('a', {
    type: 'press',
    press: {
      generation: f.generation,
      button: 0,
      counter: 1,
      time: 3950,
      x: 0.3,
      y: 0.8,
    },
  });
  clock = 4250;
  session.tick();
  assert.equal(snapshots.at(-1)!.patch.state?.flag, true);
  clock = 4300;
  session.input('a', encodeInput({ ...f, seq: 3, time: 4300 }));
  session.tick();
  assert.equal(snapshots.at(-1)!.patch.state?.flag, true);
});
