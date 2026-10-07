import assert from 'node:assert/strict';
import test from 'node:test';
import type {
  Action,
  GameInput,
  Player,
  Point,
  ValueSample,
} from '../../api/index.ts';
import { NeonHarvest, isNeonHarvestState } from './game.ts';
import {
  HARVEST,
  harvestPosition,
  harvestMultiplier,
  sweepDistance,
  type HarvestNode,
  type NeonHarvestState,
} from './model.ts';

const START = 3000;
const END = START + HARVEST.duration;
const players = (count = 1): Player[] =>
  Array.from({ length: count }, (_, seat) => ({
    id: `p${seat}`,
    venueId: 'venue',
    seat,
    name: `Player ${seat}`,
    color: '#ffffff',
    connected: true,
  }));
function fixture(count = 1, disableSpawn = true) {
  const game = new NeonHarvest();
  game.load();
  game.start({
    mode: 'standard',
    players: players(count),
    startAt: START,
    endAt: END,
  });
  if (disableSpawn) Reflect.set(game, 'nextWave', Infinity);
  // Scenario setup stays in the test; the author API exposes only cloned snapshots.
  const state = Reflect.get(game, 'state') as NeonHarvestState;
  const tick = (
    time: number,
    values: GameInput['values'] = {},
    actions: Action[] = [],
    phase: GameInput['phase'] = 'running',
    delay = 0,
  ) =>
    game.tick({
      phase,
      time,
      dt: 16,
      presentationDelay: delay,
      values,
      actions,
    }).events;
  return { game, state, tick };
}
const sample = (
  value: Point,
  time: number,
  observedAt?: number,
): ValueSample => ({
  value,
  time,
  ...(observedAt === undefined ? {} : { observedAt }),
});
const aim = (value: Point, time: number, observedAt?: number) => ({
  p0: { aim: sample(value, time, observedAt) },
});
const pulse = (
  time: number,
  position: Point = { x: 0.5, y: 0.5 },
  playerId = 'p0',
): Action => ({ playerId, name: 'pulse', time, aim: position });
const node = (
  id: number,
  kind: HarvestNode['kind'] = 'spark',
  position: Point = { x: 0.5, y: 0.5 },
  bornAt = START,
): HarvestNode => ({ id, kind, ...position, bornAt, expiresAt: bornAt + 9000 });
const put = (state: NeonHarvestState, item: HarvestNode) => {
  state.nodes.push(item);
  return item;
};

void test('Neon Harvest requires readiness and returns isolated snapshots and tied outcomes with stats', () => {
  const unloaded = new NeonHarvest();
  assert.equal(unloaded.ready(), false);
  assert.throws(() =>
    unloaded.start({
      mode: 'standard',
      players: players(),
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
    collected: 0,
    bestChain: 0,
    mineHits: 0,
  });
  outcomes[0].score = 999;
  assert.equal(game.finalize()[0].score, 40);
  assert.doesNotThrow(() => structuredClone(game.snapshot()));
  game.dispose();
  assert.equal(game.ready(), false);
  assert.throws(() => game.finalize());
  assert.deepEqual(
    game.tick({
      phase: 'running',
      time: 4000,
      dt: 16,
      presentationDelay: 0,
      values: {},
      actions: [],
    }),
    { events: [] },
  );
});

void test('pickup sweep uses the scene aspect ratio and awards a crossed spark only once', () => {
  assert.equal(
    sweepDistance({ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0.5, y: 0.1 }),
    90,
  );
  const { game, state, tick } = fixture();
  put(state, node(1));
  tick(4000, aim({ x: 0.3, y: 0.5 }, 4000));
  const events = tick(4050, aim({ x: 0.7, y: 0.5 }, 4050));
  assert.equal(game.snapshot().scores.p0, 10);
  assert.equal(state.nodes.length, 0);
  assert.equal(events.length, 1);
  tick(4060, aim({ x: 0.3, y: 0.5 }, 4060));
  assert.equal(state.scores.p0, 10);
});

void test('closest sweep wins contested pickups and exact ties rotate between players', () => {
  const { state, tick } = fixture(2);
  put(state, node(1));
  put(state, node(2));
  const values = {
    p0: { aim: sample({ x: 0.5, y: 0.5 }, 4000) },
    p1: { aim: sample({ x: 0.5, y: 0.5 }, 4000) },
  };
  const events = tick(4000, values);
  assert.deepEqual(state.scores, { p0: 10, p1: 10 });
  assert.equal(events.length, 2);
  assert.equal(new Set(events.map(({ id }) => id)).size, 2);
});

void test('chain multiplier caps at five, expiry resets only the current chain, and rush doubles gold', () => {
  assert.equal(harvestMultiplier(5), 2);
  assert.equal(harvestMultiplier(200), 5);
  const { state, tick } = fixture();
  for (let i = 1; i <= 5; i++) put(state, node(i));
  const events = tick(4000, aim({ x: 0.5, y: 0.5 }, 4000));
  assert.equal(state.scores.p0, 60);
  assert.equal(state.players.p0.bestChain, 5);
  assert.equal(
    events.length,
    1,
    'multiple pickups produce at most one audio event per player/tick',
  );
  tick(6400);
  assert.equal(state.players.p0.chain, 5);
  tick(6401);
  assert.equal(state.players.p0.chain, 0);
  assert.equal(state.players.p0.bestChain, 5);
  put(state, node(6, 'gold', { x: 0.5, y: 0.5 }, 37000));
  tick(38000, aim({ x: 0.5, y: 0.5 }, 38000));
  assert.equal(state.scores.p0, 120);
});

void test('mine warning, penalty and stun take precedence over continuous pickups', () => {
  const { state, tick } = fixture();
  const mine = put(state, node(1, 'mine'));
  put(state, node(2, 'spark'));
  state.scores.p0 = 80;
  tick(4099, aim(harvestPosition(state.nodes[1], 4099), 4099));
  assert.equal(state.players.p0.mineHits, 0);
  put(state, node(3, 'gold'));
  tick(4100, aim(harvestPosition(mine, 4100), 4100));
  assert.equal(
    state.scores.p0,
    40,
    'the earlier spark stays awarded but the gold behind the mine does not',
  );
  assert.equal(state.players.p0.mineHits, 1);
  assert.equal(state.players.p0.stunnedUntil, 5100);
  assert.equal(state.players.p0.chain, 0);
  tick(5099, aim(harvestPosition(mine, 5099), 5099));
  assert.equal(state.players.p0.mineHits, 1);
  tick(5100, aim(harvestPosition(mine, 5100), 5100));
  assert.equal(state.scores.p0, 0);
  assert.equal(state.players.p0.mineHits, 2);
});

void test('held aim uses fresh observation time while stale, future and missing paths cannot sweep', () => {
  for (const invalid of ['stale', 'future', 'missing'] as const) {
    const { state, tick } = fixture();
    put(state, node(1));
    tick(4000, aim({ x: 0.3, y: 0.5 }, 4000));
    const values =
      invalid === 'missing'
        ? {}
        : aim({ x: 0.5, y: 0.5 }, invalid === 'stale' ? 3800 : 4151);
    tick(4050, values);
    tick(4100, aim({ x: 0.7, y: 0.5 }, 4100));
    assert.equal(state.scores.p0, 0, invalid);
  }
  const { state, tick } = fixture();
  put(state, node(1));
  tick(4000, aim({ x: 0.5, y: 0.5 }, START, 4000));
  assert.equal(
    state.scores.p0,
    10,
    'unchanged capture time is fresh when independently observed',
  );
  put(state, node(2));
  tick(4100, aim({ x: 0.5, y: 0.5 }, 4200));
  assert.equal(state.scores.p0, 20, 'future tolerance includes exactly 100ms');
});

void test('disconnect and reconnect retain scores without an abandoned sweep or disconnected pulse', () => {
  const { game, state, tick } = fixture();
  state.scores.p0 = 20;
  put(state, node(1));
  tick(4000, aim({ x: 0.3, y: 0.5 }, 4000));
  game.disconnect('p0', 4010);
  tick(4020, aim({ x: 0.5, y: 0.5 }, 4020), [pulse(4015)]);
  assert.equal(state.scores.p0, 20);
  game.reconnect('p0');
  tick(4050, aim({ x: 0.7, y: 0.5 }, 4050));
  assert.equal(state.scores.p0, 20);
  assert.equal(game.finalize()[0].score, 20);
});

void test('continuous collision uses delayed presentation position and warmup at both delay limits', () => {
  for (const delay of [0, 180]) {
    const { state, tick } = fixture();
    const target = put(state, node(1));
    tick(
      START + 249 + delay,
      aim(harvestPosition(target, START + 249), START + 249 + delay),
      [],
      'running',
      delay,
    );
    assert.equal(state.scores.p0, 0);
    tick(
      START + 250 + delay,
      aim(harvestPosition(target, START + 250), START + 250 + delay),
      [],
      'running',
      delay,
    );
    assert.equal(state.scores.p0, 10);
  }
});

void test('pulse uses captured aim/time, clears warning mines, and ignores replay/cooldown attempts', () => {
  const { state, tick } = fixture();
  put(state, node(1, 'mine'));
  put(state, node(2));
  put(state, node(3, 'gold'));
  tick(4000, {}, [pulse(3250)]);
  assert.equal(state.nodes.length, 0);
  assert.equal(state.scores.p0, 40);
  assert.equal(state.players.p0.pulseReadyAt, 9250);
  put(state, node(4));
  tick(4200, {}, [pulse(3250), pulse(4199)]);
  assert.equal(state.nodes.length, 1);
  tick(9250, {}, [pulse(9250)]);
  assert.equal(state.nodes.length, 0);
  assert.equal(state.players.p0.pulseReadyAt, 15250);
});

void test('pulse rush and stun use source timestamp without undoing a mine already adjudicated', () => {
  const { state, tick } = fixture();
  put(state, node(1, 'gold', { x: 0.5, y: 0.5 }, 37000));
  tick(38050, {}, [pulse(37999)]);
  assert.equal(
    state.scores.p0,
    30,
    'processing time does not grant rush early',
  );
  const mine = put(state, node(2, 'mine', { x: 0.5, y: 0.5 }, 38000));
  tick(39100, aim(harvestPosition(mine, 39100), 39100));
  const effects = state.effects.length;
  tick(39200, {}, [pulse(39099)]);
  assert.equal(state.players.p0.mineHits, 1);
  assert.equal(state.nodes.length, 1);
  assert.equal(
    state.effects.length,
    effects,
    'late pulse cannot erase the already adjudicated stun',
  );
});

void test('terminal batch is timestamp ordered, accepts final pulses without receipt-age rejection and rejects cutoff actions', () => {
  const { state, tick } = fixture(2);
  put(state, node(1, 'gold', { x: 0.5, y: 0.5 }, END - 2000));
  const events = tick(
    END + 200,
    {},
    [
      pulse(END - 1, undefined, 'p1'),
      pulse(END - 150, undefined, 'p0'),
      pulse(END, undefined, 'p1'),
    ],
    'settling',
  );
  assert.deepEqual(state.scores, { p0: 60, p1: 0 });
  assert.equal(events.length, 2);
  assert.equal(
    state.players.p0.pulseReadyAt,
    END - 150 + HARVEST.pulseCooldown,
  );
  assert.ok(
    events.every(
      (event) => event.clock === 'presentation' && event.time === END + 200,
    ),
  );
});

void test('cutoff does not spawn or expire the scene and settling does no continuous or autonomous timer work', () => {
  const { game, state, tick } = fixture();
  Reflect.set(game, 'nextWave', END);
  const target = put(state, {
    ...node(1, 'gold', { x: 0.5, y: 0.5 }, END - 9000),
    expiresAt: END,
  });
  state.players.p0.chain = 4;
  state.players.p0.bestChain = 4;
  state.players.p0.collected = 4;
  state.players.p0.lastPickupAt = END - 5000;
  state.effects.push({
    id: 100,
    at: END - 900,
    kind: 'pickup',
    playerId: 'p0',
    x: 0.5,
    y: 0.5,
    points: 10,
  });
  tick(END, aim({ x: 0, y: 0 }, END - 1));
  assert.equal(state.wave, 0);
  assert.equal(state.nodes.length, 1);
  assert.equal(state.effects.length, 1);
  assert.equal(state.players.p0.chain, 4);
  const frozen = structuredClone(state);
  tick(
    END + 100,
    aim(harvestPosition(target, END - 1), END + 100),
    [],
    'settling',
  );
  assert.deepEqual(state, frozen);
  tick(END + 200, {}, [pulse(END - 1)], 'settling');
  assert.equal(
    state.nodes.length,
    0,
    'a node expiring at cutoff can still be hit by a pre-cutoff pulse',
  );
  assert.equal(state.scores.p0, 60);
});

void test('pulse positions use the source clock after presentation delay and never collect not-yet-visible nodes', () => {
  for (const delay of [0, 180]) {
    const { state, tick } = fixture();
    const target = put(state, node(1));
    tick(
      4000,
      {},
      [pulse(START + delay + 249, harvestPosition(target, START + 249))],
      'running',
      delay,
    );
    assert.equal(state.scores.p0, 0);
    // A different player avoids turning this check into a cooldown assertion.
    const fresh = fixture();
    put(fresh.state, node(1));
    fresh.tick(
      4000,
      {},
      [pulse(START + delay + 250, harvestPosition(target, START + 250))],
      'running',
      delay,
    );
    assert.equal(fresh.state.scores.p0, 10);
  }
});

void test('eight-player whole rounds stay deterministic, bounded, cloneable and within the state budget', () => {
  const run = () => {
    const { game, tick } = fixture(8, false);
    let maxBytes = 0,
      maxNodes = 0,
      maxEffects = 0;
    const eventIds = new Set<string>();
    for (let time = START; time <= END; time += 50) {
      const values = Object.fromEntries(
        players(8).map((player) => [
          player.id,
          {
            aim: sample(
              {
                x: 0.5 + Math.sin(time / 800 + player.seat) * 0.35,
                y: 0.45 + Math.cos(time / 900 + player.seat) * 0.22,
              },
              START,
              time,
            ),
          },
        ]),
      );
      const actions =
        time % 1000 === 0
          ? players(8).map((player) =>
              pulse(time - 1, { x: 0.5, y: 0.5 }, player.id),
            )
          : [];
      const events = tick(time, values, actions);
      assert.ok(events.length <= 8);
      for (const event of events) {
        assert.equal(eventIds.has(event.id), false);
        eventIds.add(event.id);
      }
      const state = game.snapshot();
      assert.equal(isNeonHarvestState(state), true);
      maxBytes = Math.max(maxBytes, Buffer.byteLength(JSON.stringify(state)));
      maxNodes = Math.max(maxNodes, state.nodes.length);
      maxEffects = Math.max(maxEffects, state.effects.length);
      assert.ok(
        state.nodes.every((target) =>
          ['spark', 'gold', 'mine'].includes(target.kind),
        ),
      );
    }
    assert.ok(maxNodes <= HARVEST.maxNodes);
    assert.ok(maxEffects <= HARVEST.maxEffects);
    assert.ok(maxBytes < 30000, `state peaked at ${maxBytes} bytes`);
    return { snapshot: game.snapshot(), outcomes: game.finalize() };
  };
  assert.deepEqual(run(), run());
});

void test('game-owned snapshot validator rejects malformed counters, nodes and effects', () => {
  const { game, state } = fixture();
  put(state, node(1));
  const valid = game.snapshot();
  assert.equal(isNeonHarvestState(valid), true);
  for (const mutate of [
    (value: NeonHarvestState) => {
      value.scores.p0 = Infinity;
    },
    (value: NeonHarvestState) => {
      value.players.p0.chain = -1;
    },
    (value: NeonHarvestState) => {
      value.nodes.push({ ...value.nodes[0] });
    },
    (value: NeonHarvestState) => {
      value.nodes[0].expiresAt = value.nodes[0].bornAt;
    },
    (value: NeonHarvestState) => {
      value.nodes[0].x = NaN;
    },
    (value: NeonHarvestState) => {
      value.effects = Array.from({ length: 97 }, (_, i) => ({
        id: i + 1,
        at: 4000,
        kind: 'pulse',
        playerId: 'p0',
        x: 0.5,
        y: 0.5,
        points: 0,
      }));
    },
  ]) {
    const malformed = structuredClone(valid);
    mutate(malformed);
    assert.equal(isNeonHarvestState(malformed), false);
  }
  assert.equal(isNeonHarvestState([]), false);
});

void test('mine feedback matches the actual deduction when fewer than fifty points remain', () => {
  const { state, tick } = fixture();
  const mine = put(state, node(1, 'mine'));
  state.scores.p0 = 20;
  tick(4100, aim(harvestPosition(mine, 4100), 4100));
  assert.equal(state.scores.p0, 0);
  assert.equal(state.effects.at(-1)?.points, -20);
  tick(5100, aim(harvestPosition(mine, 5100), 5100));
  assert.equal(state.scores.p0, 0);
  assert.equal(state.effects.at(-1)?.points, 0);
  assert.equal(state.players.p0.mineHits, 2);
});

void test('prototype-like player IDs remain eligible own keys in snapshots and outcomes', () => {
  const game = new NeonHarvest();
  game.load();
  const roster = players(2);
  roster[0].id = '__proto__';
  roster[1].id = 'constructor';
  game.start({ mode: 'standard', players: roster, startAt: START, endAt: END });
  const state = Reflect.get(game, 'state') as NeonHarvestState;
  Reflect.set(game, 'nextWave', Infinity);
  put(state, node(1));
  game.tick({
    phase: 'running',
    time: 4000,
    dt: 16,
    presentationDelay: 0,
    values: {},
    actions: [pulse(3900, undefined, '__proto__')],
  });
  const snapshot = game.snapshot();
  assert.equal(isNeonHarvestState(snapshot), true);
  assert.equal(Object.hasOwn(snapshot.scores, '__proto__'), true);
  assert.equal(snapshot.scores['__proto__'], 10);
  assert.equal(snapshot.players['__proto__'].collected, 1);
  assert.equal(snapshot.scores['constructor'], 0);
  assert.deepEqual(
    game.finalize().map(({ playerId, score, placement }) => ({
      playerId,
      score,
      placement,
    })),
    [
      { playerId: '__proto__', score: 10, placement: 1 },
      { playerId: 'constructor', score: 0, placement: 2 },
    ],
  );
});
