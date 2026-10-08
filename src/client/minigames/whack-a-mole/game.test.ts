import { whackAMole } from './index.ts';
import assert from 'node:assert/strict';
import test from 'node:test';
import type { Action, GameInput, Player, Point } from '../../api/index.ts';
import { WhackAMole, isWhackState } from './game.ts';
import {
  FIELD,
  WHACK,
  boundsOverlap,
  createRandom,
  groundDistance,
  holeBounds,
  holeCount,
  holeLayout,
  contact,
  hammerRadius,
  strike,
  touchedHole,
  makeHole,
  molePose,
  hittable,
  type Mole,
  type WhackState,
} from './model.ts';

const START = 3000;
const END = START + WHACK.duration;
const players = (count = 1): Player[] =>
  Array.from({ length: count }, (_, seat) => ({
    id: `p${seat}`,
    venueId: 'venue',
    seat,
    name: `Player ${seat}`,
    color: '#ffffff',
    connected: true,
  }));
const assignments = (roster: Player[]) =>
  roster.map((player) => ({
    playerId: player.id,
    role: 'default',
    controls: whackAMole.controls,
  }));
function fixture(count = 1, disableSpawn = true) {
  const game = new WhackAMole();
  game.load();
  game.start({
    mode: 'standard',
    players: players(count),
    seed: START,
    assignments: assignments(players(count)),
    startAt: START,
    endAt: END,
  });
  if (disableSpawn) Reflect.set(game, 'nextSpawnAt', Infinity);
  // Scenario setup stays in the test; the author API exposes only cloned snapshots.
  const state = Reflect.get(game, 'state') as WhackState;
  const tick = (
    time: number,
    actions: Action[] = [],
    phase: GameInput['phase'] = 'running',
    delay = 0,
  ) =>
    game.tick({
      phase,
      time,
      dt: 16,
      presentationDelay: delay,
      values: {},
      actions,
    }).events;
  return { game, state, tick };
}
const whack = (time: number, aim: Point, playerId = 'p0'): Action => ({
  playerId,
  name: 'whack',
  time,
  aim,
});
const mole = (
  state: WhackState,
  hole: number,
  kind: Mole['kind'] = 'normal',
  upAt = START + 100,
  downAt = upAt + 1200,
): Mole => {
  const item: Mole = { id: state.moles.length + 1, hole, kind, upAt, downAt };
  state.moles.push(item);
  return item;
};
const at = (state: WhackState, hole: number): Point => ({
  x: state.holes[hole].x,
  y: state.holes[hole].y,
});

void test('Whack-a-Mole requires readiness, isolates snapshots and ties equal scores', () => {
  const unloaded = new WhackAMole();
  assert.equal(unloaded.ready(), false);
  assert.throws(() =>
    unloaded.start({
      mode: 'standard',
      players: players(),
      seed: START,
      assignments: assignments(players()),
      startAt: START,
      endAt: END,
    }),
  );
  const { game, state } = fixture(3);
  state.scores.p0 = 40;
  state.scores.p1 = 40;
  state.scores.p2 = 10;
  const snapshot = game.snapshot();
  snapshot.scores.p0 = 1000;
  assert.equal(game.snapshot().scores.p0, 40);
  const outcomes = game.finalize();
  assert.deepEqual(
    outcomes.map(({ placement }) => placement),
    [1, 1, 3],
  );
  assert.deepEqual(outcomes[0].stats, {
    hits: 0,
    golden: 0,
    bombs: 0,
    misses: 0,
    bestStreak: 0,
  });
  outcomes[0].score = 999;
  assert.equal(game.finalize()[0].score, 40);
  assert.ok(isWhackState(game.snapshot()));
  game.dispose();
  assert.equal(game.ready(), false);
});

void test('hole layouts are scattered, seeded, in bounds and never overlap', () => {
  for (const count of [holeCount(1), holeCount(8)]) {
    for (let seed = 0; seed < 150; seed++) {
      const holes = holeLayout(count, createRandom(seed * 7919 + 13));
      assert.equal(holes.length, count);
      assert.deepEqual(
        holeLayout(count, createRandom(seed * 7919 + 13)),
        holes,
      );
      for (const [i, hole] of holes.entries()) {
        const box = holeBounds(hole);
        assert.ok(
          box.left >= FIELD.left * 1600 && box.right <= FIELD.right * 1600,
        );
        assert.ok(box.top >= 0.2 * 900 && box.bottom <= 0.87 * 900);
        for (const other of holes.slice(i + 1)) {
          assert.equal(boundsOverlap(hole, other, 0), false);
          assert.ok(groundDistance(hole, other) >= 2.3);
        }
      }
      // Not a grid: holes don't line up in a few shared rows or columns.
      const rows = new Set(
        holes.map((hole) => Math.round((hole.y * 900) / 24)),
      );
      const columns = new Set(
        holes.map((hole) => Math.round((hole.x * 1600) / 40)),
      );
      assert.ok(
        rows.size >= Math.ceil(count / 2),
        `rows ${rows.size} for seed ${seed}`,
      );
      assert.ok(
        columns.size >= Math.ceil(count / 2),
        `columns ${columns.size} for seed ${seed}`,
      );
    }
  }
  // The hand-placed fallback, used when sampling keeps failing, obeys the same rules.
  for (const count of [8, 11]) {
    const curated = holeLayout(count, () => 0.5);
    for (const [i, hole] of curated.entries())
      for (const other of curated.slice(i + 1))
        assert.equal(boundsOverlap(hole, other, 0), false);
  }
  assert.equal(holeCount(3), 8);
  assert.equal(holeCount(4), 11);
  // Different rounds get different layouts.
  const a = fixture(2).state.holes;
  const other = new WhackAMole();
  other.load();
  other.start({
    mode: 'standard',
    players: players(2),
    seed: START + 1,
    assignments: assignments(players(2)),
    startAt: START + 1,
    endAt: END + 1,
  });
  assert.notDeepEqual(other.snapshot().holes, a);
});

void test('any part of the hammer head touching the mole or its hole counts', () => {
  const hole = makeHole(0.5, 0.6),
    at = (dx: number, dy: number) => ({
      x: 0.5 + dx / 1600,
      y: 0.6 + dy / 900,
    });
  const radius = hammerRadius(at(0, 0));
  assert.ok(contact(at(0, 0), hole, 1) <= 1, 'dead centre');
  assert.ok(contact(at(0, -hole.reach * 0.9), hole, 1) <= 1, 'on the head');
  // The head's edge reaching past the rim still lands.
  const rim = hole.rx * 1.15;
  assert.ok(
    contact(at(rim + radius * 0.9, 0), hole, 1) <= 1,
    'edge of the head',
  );
  assert.ok(contact(at(rim + radius * 1.2, 0), hole, 1) > 1, 'clear of it');
  // A half-risen mole is shorter: swinging where its head will be misses.
  const high = at(0, -hole.reach * 1.1);
  assert.ok(contact(high, hole, 1) <= 1);
  assert.ok(contact(high, hole, 0.3) > 1);
  assert.ok(contact(at(0, hole.ry * 3), hole, 1) > 1, 'well below the hole');
  const holes = [makeHole(0.3, 0.5), makeHole(0.7, 0.5)];
  assert.equal(touchedHole({ x: 0.3, y: 0.5 }, holes), 0);
  assert.equal(touchedHole({ x: 0.7, y: 0.5 }, holes), 1);
  assert.equal(touchedHole({ x: 0.5, y: 0.5 }, holes), -1);
});

void test('strike picks the closest hittable mole the head touches', () => {
  const holes = [makeHole(0.4, 0.5), makeHole(0.5, 0.5)];
  const up = (id: number, hole: number): Mole => ({
    id,
    hole,
    kind: 'normal',
    upAt: 0,
    downAt: 5000,
  });
  const moles = [up(1, 0), up(2, 1)];
  // Between the two holes but nearer the second: both touched, closer wins.
  const aim = { x: 0.46, y: 0.5 };
  assert.ok(contact(aim, holes[0], 1) <= 1 && contact(aim, holes[1], 1) <= 1);
  assert.equal(strike(aim, holes, moles, 1000)?.id, 2);
  // A bonked or not-yet-risen mole can't be struck.
  assert.equal(
    strike(
      aim,
      holes,
      [up(1, 0), { ...up(2, 1), hitAt: 900, hitBy: 'p0' }],
      1000,
    )?.id,
    1,
  );
  assert.equal(
    strike(aim, holes, [{ ...up(3, 1), upAt: 990 }], 1000),
    undefined,
  );
});

void test('moles pose analytically: warn, rise, stay, hide and bonk', () => {
  const item: Mole = {
    id: 1,
    hole: 0,
    kind: 'normal',
    upAt: 1000,
    downAt: 2000,
  };
  assert.equal(molePose(item, 1000 - WHACK.warn - 1).phase, 'gone');
  assert.deepEqual(molePose(item, 1000 - WHACK.warn / 2), {
    height: 0,
    phase: 'warning',
    elapsed: WHACK.warn / 2000,
  });
  assert.equal(hittable(item, 999), false, 'a rumbling hole has no target yet');
  assert.equal(molePose(item, 1050).phase, 'rising');
  assert.deepEqual(molePose(item, 1500), {
    height: 1,
    phase: 'up',
    elapsed: 0.5,
  });
  assert.equal(molePose(item, 2100).phase, 'hiding');
  assert.equal(molePose(item, 2000 + WHACK.hide).phase, 'gone');
  const hit = { ...item, hitAt: 1500, hitBy: 'p0' };
  assert.equal(molePose(hit, 1500).phase, 'bonked');
  assert.ok(
    molePose(hit, 1500).height > 0.5,
    'impact first: flattened at the rim',
  );
  assert.equal(molePose(hit, 1500 + WHACK.bonk).phase, 'gone');
});

void test('whacks score by kind, and frenzy doubles points', () => {
  const { state, tick } = fixture(1);
  const normal = mole(state, 0, 'normal');
  const golden = mole(state, 1, 'golden');
  const late = mole(state, 2, 'normal', END - 5000, END - 3000);
  const events = tick(START + 400, [whack(START + 300, at(state, 0))]);
  assert.deepEqual(
    events.map((event) => event.kind),
    ['bonk'],
  );
  assert.equal(state.scores.p0, 10);
  assert.equal(normal.hitBy, 'p0');
  assert.equal(normal.hitAt, START + 400, 'bonks play from host processing');
  assert.deepEqual(state.effects.at(-1)!.kind, 'bonk');
  tick(START + 1000, [whack(START + 800, at(state, 1))]);
  assert.equal(golden.hitBy, 'p0');
  assert.equal(state.scores.p0, 40);
  assert.equal(state.players.p0.golden, 1);
  assert.deepEqual(state.effects.at(-1)!.kind, 'gold');
  state.moles.push(late);
  tick(END - 4000, [whack(END - 4200, at(state, 2))]);
  assert.equal(state.scores.p0, 60);
  assert.equal(state.effects.at(-1)!.points, 20);
  assert.equal(state.players.p0.streak, 3);
  assert.equal(state.players.p0.bestStreak, 3);
});

void test('each mole is whacked once: the earliest whack wins and exact ties use roster order', () => {
  const { state, tick } = fixture(3);
  mole(state, 0);
  mole(state, 1);
  // Arrival order differs from timestamp order.
  tick(START + 600, [
    whack(START + 320, at(state, 0), 'p2'),
    whack(START + 310, at(state, 0), 'p1'),
  ]);
  assert.equal(state.moles[0].hitBy, 'p1');
  assert.equal(state.scores.p1, 10);
  assert.equal(state.scores.p2, 0);
  assert.equal(
    state.players.p2.misses,
    1,
    'the later whack finds an empty hole',
  );
  tick(START + 900, [
    whack(START + 700, at(state, 1), 'p2'),
    whack(START + 700, at(state, 1), 'p0'),
  ]);
  assert.equal(state.moles[1].hitBy, 'p0');
  // A late whack for an already bonked mole never scores.
  tick(START + 1000, [whack(START + 650, at(state, 1), 'p1')]);
  assert.equal(state.scores.p1, 10);
});

void test('swing recovery and bomb stun ignore whacks; bombs cost points but never go negative', () => {
  const { state, tick } = fixture(1);
  mole(state, 0);
  const bomb = mole(state, 1, 'bomb');
  const target = mole(state, 2, 'normal', START + 100, START + 3000);
  tick(START + 400, [
    whack(START + 300, at(state, 0)),
    whack(START + 300 + WHACK.recovery - 1, at(state, 2)),
  ]);
  assert.equal(target.hitAt, undefined, 'inside swing recovery');
  assert.equal(state.scores.p0, 10);
  const events = tick(START + 900, [whack(START + 800, at(state, 1))]);
  assert.deepEqual(
    events.map((event) => event.kind),
    ['boom'],
  );
  assert.equal(bomb.hitBy, 'p0');
  assert.equal(state.scores.p0, 0);
  assert.equal(state.players.p0.bombs, 1);
  assert.equal(state.players.p0.streak, 0);
  assert.equal(state.players.p0.stunnedUntil, START + 900 + WHACK.stun);
  assert.equal(state.effects.at(-1)!.points, -10);
  tick(START + 1500, [whack(START + 1400, at(state, 2))]);
  assert.equal(target.hitAt, undefined, 'dizzy players cannot whack');
  tick(START + 2200, [whack(START + 2150, at(state, 2))]);
  assert.equal(target.hitBy, 'p0');
});

void test('misses reset the streak without costing points', () => {
  const { state, tick } = fixture(1);
  mole(state, 0);
  tick(START + 400, [whack(START + 300, at(state, 0))]);
  const events = tick(START + 800, [whack(START + 700, { x: 0.01, y: 0.99 })]);
  assert.deepEqual(
    events.map((event) => event.kind),
    ['whiff'],
  );
  assert.equal(state.scores.p0, 10);
  assert.equal(state.players.p0.misses, 1);
  assert.equal(state.players.p0.streak, 0);
  assert.equal(state.effects.at(-1)!.hole, -1);
  tick(START + 1200, [whack(START + 1100, at(state, 3))]);
  assert.equal(
    state.effects.at(-1)!.hole,
    3,
    'an empty hole records where it landed',
  );
});

void test('whacks are judged at what a delayed display showed, with a small grace', () => {
  const { state, tick } = fixture(1);
  const seen = mole(state, 0, 'normal', START + 100, START + 600);
  // The mole had hidden on the host, but the delayed display still showed it.
  tick(START + 1000, [whack(START + 800, at(state, 0))], 'running', 150);
  assert.equal(seen.hitBy, 'p0');
  const gone = mole(state, 1, 'normal', START + 100, START + 600);
  tick(START + 1400, [whack(START + 1200, at(state, 1))], 'running', 0);
  assert.equal(gone.hitAt, undefined);
  const early = mole(state, 2, 'normal', START + 2000, START + 3000);
  tick(START + 2100, [whack(START + 2010, at(state, 2))]);
  assert.equal(early.hitAt, undefined, 'too early in the rise');
});

void test('settling keeps the cutoff scene and judges only whacks before the end', () => {
  const { state, tick } = fixture(1);
  mole(state, 0, 'normal', END - 1000, END - 200);
  mole(state, 1, 'normal', END - 1000, END + 500);
  tick(END - 10, []);
  const events = tick(
    END + 200,
    [whack(END - 150, at(state, 0)), whack(END + 10, at(state, 1))],
    'settling',
  );
  assert.deepEqual(
    events.map((event) => event.kind),
    ['bonk'],
  );
  assert.equal(state.moles.length, 2, 'no expiry during settling');
  assert.equal(state.moles[1].hitAt, undefined);
  assert.equal(state.scores.p0, 20);
});

void test('disconnected players are frozen, and returning players resume', () => {
  const { game, state, tick } = fixture(2);
  mole(state, 0);
  game.disconnect('p1', START + 200);
  tick(START + 400, [whack(START + 300, at(state, 0), 'p1')]);
  assert.equal(state.moles[0].hitAt, undefined);
  game.reconnect('p1');
  tick(START + 500, [whack(START + 450, at(state, 0), 'p1')]);
  assert.equal(state.moles[0].hitBy, 'p1');
  game.reconnect('stranger');
  assert.equal(Object.hasOwn(state.players, 'stranger'), false);
});

void test('spawning is seeded, respects free holes and ramps up, and a full 8-player round fits the snapshot budget', () => {
  const run = (count: number) => {
    const { game, state, tick } = fixture(count, false);
    const kinds = new Set<string>();
    let peak = 0,
      largest = 0,
      pops = 0;
    for (let time = START; time < END; time += 16) {
      const actions: Action[] = [];
      if ((time - START) % 96 === 0)
        for (const [index, player] of players(count).entries()) {
          const target = state.moles.find(
            (item) =>
              item.hitAt === undefined && molePose(item, time).phase === 'up',
          );
          if (target && ((time - START) / 16 + index) % 3 === 0)
            actions.push(whack(time - 20, at(state, target.hole), player.id));
        }
      pops += tick(time, actions).filter(
        (event) => event.kind === 'pop',
      ).length;
      const showing = state.moles.filter(
        (item) =>
          item.hitAt === undefined && molePose(item, time).phase !== 'gone',
      );
      peak = Math.max(peak, showing.length);
      for (const item of state.moles) kinds.add(item.kind);
      // Holes never host two moles at once.
      assert.equal(
        new Set(showing.map((item) => item.hole)).size,
        showing.length,
      );
      if ((time - START) % 1600 === 0)
        largest = Math.max(largest, JSON.stringify(game.snapshot()).length);
      assert.ok(state.moles.length <= WHACK.maxMoles);
      assert.ok(state.effects.length <= WHACK.maxEffects);
    }
    assert.ok(isWhackState(game.snapshot()));
    return { game, state, kinds, peak, largest, pops };
  };
  const solo = run(1);
  const party = run(8);
  assert.ok(
    solo.peak >= 3 && solo.peak <= holeCount(1) - 2,
    `solo peak ${solo.peak}`,
  );
  assert.ok(party.peak > solo.peak, 'more players, more moles');
  assert.ok(party.peak <= holeCount(8) - 2);
  assert.deepEqual([...party.kinds].sort(), ['bomb', 'golden', 'normal']);
  assert.ok(party.pops > 60, `pops ${party.pops}`);
  assert.ok(party.largest < 20 * 1024, `snapshot ${party.largest} bytes`);
  assert.ok(Object.values(party.state.scores).some((score) => score > 0));
  const replay = run(8);
  assert.deepEqual(replay.state.scores, party.state.scores, 'deterministic');
});

void test('state validation rejects malformed snapshots', () => {
  const { game, state } = fixture(2);
  mole(state, 0);
  const valid = game.snapshot();
  assert.ok(isWhackState(valid));
  const broken = (change: (copy: WhackState) => void) => {
    const copy = structuredClone(valid);
    change(copy);
    return isWhackState(copy);
  };
  assert.equal(
    broken((copy) => (copy.moles[0].hole = 99)),
    false,
  );
  assert.equal(
    broken((copy) => (copy.moles[0].hitAt = 5)),
    false,
    'hitAt without hitBy',
  );
  assert.equal(
    broken((copy) => (copy.moles[0].kind = 'mega' as never)),
    false,
  );
  assert.equal(
    broken((copy) => (copy.scores.p0 = -1)),
    false,
  );
  assert.equal(
    broken((copy) => (copy.holes[0].x = 2)),
    false,
  );
  assert.equal(
    broken((copy) => (copy.holes = [])),
    false,
  );
  assert.equal(
    broken((copy) => delete (copy.scores as Record<string, number>).p1),
    false,
  );
  assert.equal(
    broken((copy) =>
      copy.effects.push({
        id: 1,
        at: 1,
        kind: 'bonk',
        playerId: 'nobody',
        hole: 0,
        points: 10,
        x: 0.5,
        y: 0.5,
      }),
    ),
    false,
  );
  assert.equal(isWhackState(null), false);
});

void test('a hole rumbles before its mole pops, and the pop cue lands on the pop', () => {
  const { tick, state } = fixture(1, false);
  const events = tick(START + WHACK.firstSpawn);
  const [first] = state.moles;
  assert.equal(first.upAt, START + WHACK.firstSpawn + WHACK.warn);
  assert.equal(molePose(first, START + WHACK.firstSpawn).phase, 'warning');
  assert.deepEqual(
    events.filter((event) => event.kind === 'pop').map((event) => event.time),
    [first.upAt],
  );
});
