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
  centerCalibration,
  gainOf,
  DEFAULT_GAIN,
  MIN_GAIN,
  MAX_GAIN,
  fitHomography,
  project,
  recenter,
  tangent,
  axisAngle,
  multiply,
  identity,
  aimAt,
} from '../src/core/calibration.ts';
import {
  ClockSync,
  Equalizer,
  Samples,
  ContinuousBuffer,
} from '../src/core/timing.ts';
import { SnapshotBuffer, SnapshotEncoder } from '../src/core/snapshots.ts';
import {
  defaultCapabilities,
  labManifest,
  raceManifest,
  resolveConfig,
} from '../src/core/config.ts';
import { PartyGame } from '../src/games/engine.ts';
import { SessionAuthority } from '../src/core/session.ts';
import type {
  InputFrame,
  Player,
  Quaternion,
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
void test('off-axis homography maps all corners precisely without clamping', () => {
  const ps = [
      { x: -0.8, y: -0.4 },
      { x: 0.2, y: -0.3 },
      { x: 0.3, y: 0.5 },
      { x: -0.6, y: 0.8 },
    ],
    h = fitHomography(ps);
  ps.forEach((p, i) => {
    const expected = [
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 1],
      ][i],
      v = project(h, p);
    almost(v.x, expected[0]);
    almost(v.y, expected[1]);
  });
  assert.ok(project(h, { x: 2, y: 0 }).x > 1);
});
void test('degenerate, crossed, and nearly coincident calibration is rejected', () => {
  assert.throws(() => fitHomography(Array(4).fill({ x: 0, y: 0 })));
  assert.throws(() =>
    fitHomography([
      { x: 0, y: 0 },
      { x: 1, y: 1 },
      { x: 0, y: 1 },
      { x: 1, y: 0 },
    ]),
  );
});
const aim = (x: number, y: number): Quaternion => aimAt({ x, y });
void test('remote grip: yaw steers horizontally and pitch vertically', () => {
  // Phone flat, top edge toward the screen. Turning right is a clockwise
  // (negative) rotation about the face normal; tilting the top edge up is a
  // positive rotation about the right edge.
  const right = tangent(identity, axisAngle(0, 0, 1, -0.3)),
    up = tangent(identity, axisAngle(1, 0, 0, 0.3));
  assert.ok(right.x > 0.25);
  almost(right.y, 0);
  assert.ok(up.y < -0.25);
  almost(up.x, 0);
  const p = tangent(identity, aim(0.4, -0.2));
  almost(p.x, 0.4);
  almost(p.y, -0.2);
});
void test('center calibration maps the captured pose to center and scales with gain', () => {
  const ref = aim(0.3, -0.1),
    cal = centerCalibration(ref, 2),
    at = (q: Quaternion) => project(cal.h, tangent(ref, q));
  const center = at(ref);
  almost(center.x, 0.5);
  almost(center.y, 0.5);
  // Yaw right by θ relative to the captured pose moves x by gain·tan θ.
  const right = at(multiply(ref, axisAngle(0, 0, 1, -0.2)));
  almost(right.x, 0.5 + 2 * Math.tan(0.2));
  almost(right.y, 0.5);
  // Pitch up moves y up, scaled by 16:9 so both axes match in pixels.
  const up = at(multiply(ref, axisAngle(1, 0, 0, 0.1)));
  almost(up.x, 0.5);
  almost(up.y, 0.5 - ((2 * 16) / 9) * Math.tan(0.1));
  // Doubling the gain doubles the displacement.
  const doubled = project(
    centerCalibration(ref, 4).h,
    tangent(ref, multiply(ref, axisAngle(0, 0, 1, -0.2))),
  );
  almost(doubled.x - 0.5, 2 * (right.x - 0.5));
  assert.equal(gainOf(cal), 2);
  assert.equal(gainOf(centerCalibration(ref, 100)), MAX_GAIN);
  assert.equal(gainOf(centerCalibration(ref, 0)), MIN_GAIN);
  assert.equal(gainOf(null), DEFAULT_GAIN);
});
void test('center calibration and recenter preserve H and put current pose at exact center', () => {
  const cal = centerCalibration(identity, DEFAULT_GAIN),
    current = multiply(axisAngle(0, 0, 1, 0.22), identity),
    out = recenter(cal, current);
  assert.equal(out.h, cal.h);
  assert.equal(out.recenters, 1);
  const p = project(out.h, tangent(out.ref, current));
  almost(p.x, 0.5);
  almost(p.y, 0.5);
});
void test('recenter handles a hand-fitted H whose tangent origin is not the exact center', () => {
  const h = fitHomography([
    { x: -0.45, y: -0.3 },
    { x: 0.55, y: -0.3 },
    { x: 0.55, y: 0.3 },
    { x: -0.45, y: 0.3 },
  ]);
  const cal = { ref: identity, h, at: 0, count: 1, recenters: 0, roll: 0 };
  const current = axisAngle(0, 1, 0, 0.6),
    out = recenter(cal, current),
    p = project(h, tangent(out.ref, current));
  almost(p.x, 0.5);
  almost(p.y, 0.5);
});
void test('permission denial chooses stick per player, never a dead pointer', () => {
  const c = defaultCapabilities();
  c.sensors.gyro = { present: true, permission: 'denied' };
  const config = resolveConfig(labManifest, c, 4);
  assert.equal(config.sensors.pointer.enabled, false);
  assert.equal(config.widgets[0].type, 'stick');
  assert.equal(config.widgets[0].space, 'normalized');
  assert.equal(resolveConfig(raceManifest, c, 5).widgets[0].space, 'signed');
  assert.equal(config.substitutions.length, 1);
  c.sensors.gyro.permission = 'granted';
  c.sensors.accel = { present: true, permission: 'granted' };
  assert.equal(resolveConfig(labManifest, c, 5).sensors.pointer.enabled, true);
  assert.equal(
    resolveConfig(raceManifest, c, 6).sensors.pointer.enabled,
    false,
  );
  assert.equal(resolveConfig(raceManifest, c, 6).sensors.tilt.enabled, true);
});
void test('required motion without fallback gives an actionable failure', () => {
  assert.throws(
    () =>
      resolveConfig(
        {
          ...labManifest,
          inputs: { aim: { required: true, prefer: 'pointer' } },
        },
        defaultCapabilities(),
        1,
      ),
    /Motion access is off/,
  );
});
const snapshot = (id: number, time: number, x: number): Snapshot => {
  const g = new PartyGame('latency-lab');
  g.configure(players);
  g.start(0, 'tracking');
  g.state.phase = 'running';
  g.state.cursors.a = { x, y: 0.5 };
  g.state.scores.a = id * 10;
  return { id, time, state: g.snapshot() };
};
void test('delta compression uses only acknowledged bases and recovers missing bases', () => {
  const enc = new SnapshotEncoder(),
    buf = new SnapshotBuffer(),
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
  assert.equal(new SnapshotBuffer().receive(delta), false);
  assert.equal(buf.receive(delta), true);
  assert.equal(buf.history.get(2)!.state.cursors.a.x, 0.4);
});
void test('snapshot interpolation blends positions, not scores, and never exposes the future', () => {
  const buf = new SnapshotBuffer();
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
  const buf = new SnapshotBuffer();
  for (const s of [snapshot(2, 200, 0.8), snapshot(1, 100, 0.2)])
    buf.receive({ id: s.id, time: s.time, base: null, patch: s.state });
  almost(buf.sample(150)!.cursors.a.x, 0.5);
});
void test('reaction scoring depends on action timestamp, not packet arrival', () => {
  const game = new PartyGame('latency-lab');
  game.configure(players);
  game.start(0, 'fairness');
  game.frame({}, [], 4100, 16, 100);
  const target = game.state.targetAt;
  game.frame(
    {},
    [
      {
        playerId: 'b',
        generation: 1,
        button: 0,
        counter: 1,
        time: target + 300,
        x: 0.5,
        y: 0.5,
      },
      {
        playerId: 'a',
        generation: 1,
        button: 0,
        counter: 1,
        time: target + 250,
        x: 0.5,
        y: 0.5,
      },
    ],
    target + 600,
    16,
    100,
  );
  assert.equal(game.state.scores.a, 750);
  assert.equal(game.state.scores.b, 700);
});
void test('game round ends with bounded, structured-clone-able results', () => {
  const game = new PartyGame('tilt-rally');
  game.configure(players);
  game.start(0, 'rally');
  game.frame({}, [], 34000, 16, 0);
  assert.equal(game.state.phase, 'results');
  assert.equal(game.state.results.length, 2);
  assert.deepEqual(structuredClone(game.snapshot()), game.snapshot());
});
void test('session gates start on configuration ACK and rejects stale generation', () => {
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
  session.start('latency-lab', 'reaction');
  assert.throws(() => session.start('tilt-rally', 'rally'));
  const generation = configs.at(-1)!.config.generation;
  assert.equal(generation, 1);
  session.input('a', encodeInput(frame()));
  assert.equal(session.playerMetrics.size, 0);
  for (const p of players) session.control(p.id, { type: 'ready', generation });
  session.tick();
  assert.doesNotThrow(() => structuredClone(session.summary()));
});
void test('lost input frames recover an edge once and preserve its original timestamp', (t) => {
  let clock = 0;
  t.mock.method(performance, 'now', () => clock);
  const configs: Record<string, ControllerConfig> = {},
    snapshots: WireSnapshot[] = [];
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
  session.start('latency-lab', 'strobe');
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
  assert.equal(snapshots.at(-1)!.patch.flash, true);
  clock = 4300;
  session.input('a', encodeInput({ ...f, seq: 3, time: 4300 }));
  session.tick();
  assert.equal(snapshots.at(-1)!.patch.flash, true);
});
void test('pause policy shifts the timeline and ends with partial results after grace', () => {
  const game = new PartyGame('latency-lab', 'pause');
  game.load();
  assert.equal(game.ready(), true);
  game.configure(players);
  game.start(0, 'reaction');
  game.frame({}, [], 4000, 16, 0);
  const end = game.state.endAt;
  game.onPlayerDropped('a', 4000);
  game.frame({}, [], 4016, 16, 0);
  assert.equal(game.state.endAt, end + 16);
  game.frame({}, [], 64001, 16, 0);
  assert.equal(game.state.phase, 'results');
  assert.equal(game.state.results.length, 2);
});
void test('substitute policy moves a disconnected avatar and stops on return', () => {
  const game = new PartyGame('tilt-rally', 'substitute');
  game.configure(players);
  game.start(0, 'rally');
  game.onPlayerDropped('a', 3000);
  for (let time = 4000; time < 5600; time += 16)
    game.frame({}, [], time, 16, 0);
  assert.ok(game.state.scores.a > 0);
  const score = game.state.scores.a;
  game.onPlayerReturned('a');
  game.frame({}, [], 5616, 16, 0);
  assert.equal(game.state.scores.a, score);
});
