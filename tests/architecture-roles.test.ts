import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import type {
  GameContext,
  GameDescriptor,
  GameInput,
  ParticipantAssignment,
  RoundSetupContext,
  RoundSnapshot,
} from '../src/client/api/index.ts';
import type {
  Capabilities,
  ControllerConfig,
  ControllerRequirements,
} from '../src/client/controls/api.ts';
import { defaultCapabilities } from '../src/client/controls/resolve.ts';
import { RoundRunner } from '../src/client/engine/round.ts';
import { SessionProgress } from '../src/client/engine/progress.ts';
import { SessionAuthority } from '../src/client/engine/session.ts';
import { prepareAssignments } from '../src/client/engine/round-setup.ts';
import { snapshotPolicy } from '../src/client/engine/snapshots.ts';
import { SnapshotTimeline } from '../src/client/engine/replication.ts';
import {
  GameHarness,
  simulatedPlayers,
} from '../src/client/devtools/game-harness/harness.ts';
import { games } from '../src/client/minigames/catalog.ts';
import { buttonProbe } from './fixtures/games.ts';
const players = structuredClone(simulatedPlayers.slice(0, 2));
const granted = (): Capabilities => {
  const c = defaultCapabilities();
  c.sensors.accel = c.sensors.gyro = { present: true, permission: 'granted' };
  return c;
};
function fixture(strict = false) {
  const setups: RoundSetupContext[] = [],
    contexts: GameContext[] = [],
    ticks: GameInput[] = [];
  const pilot: ControllerRequirements = {
    inputs: {
      steer: {
        required: true,
        prefer: 'tilt',
        ...(strict ? {} : { fallback: 'dpad' as const }),
      },
    },
  };
  const gunner: ControllerRequirements = {
    inputs: { fire: { required: true, prefer: 'button' } },
  };
  const descriptor: GameDescriptor = {
    ...buttonProbe,
    id: strict ? 'strict-roles-probe' : 'roles-probe',
    timing: { kind: 'timed', durationMs: 1000 },
    setup(context) {
      setups.push(context);
      return context.players.map((player, i) => ({
        playerId: player.id,
        role: i === 0 ? 'pilot' : 'gunner',
        controls: i === 0 ? pilot : gunner,
      }));
    },
    create(options) {
      const game = buttonProbe.create(options);
      return {
        ...game,
        start(context) {
          contexts.push(context);
          game.start(context);
        },
        tick(input) {
          ticks.push(structuredClone(input));
          return game.tick(input);
        },
      };
    },
  };
  return { descriptor, setups, contexts, ticks, pilot, gunner };
}
function room(t: TestContext, f: ReturnType<typeof fixture>) {
  (games as GameDescriptor[]).push(f.descriptor);
  t.after(() =>
    (games as GameDescriptor[]).splice(games.indexOf(f.descriptor), 1),
  );
  let clock = 0;
  t.mock.method(performance, 'now', () => clock);
  const configs: Record<
    string,
    { config: ControllerConfig; role: string | null; roundId: string | null }
  > = {};
  const errors: string[] = [];
  const phases: string[] = [];
  const display = new SnapshotTimeline<RoundSnapshot>(
    snapshotPolicy(f.descriptor),
  );
  const authority = new SessionAuthority(
    'host',
    {
      toPlayer(id, msg) {
        if (msg.type === 'config') configs[id] = structuredClone(msg) as never;
        if (msg.type === 'error') errors.push(msg.message);
      },
      toVenue(_id, msg) {
        if (msg.type === 'phase') phases.push(msg.phase);
      },
      snapshot(_id, msg) {
        assert.equal(display.receive(msg.snapshot), true);
      },
      event() {},
      warning() {},
    },
    { seed: () => 42 },
  );
  t.after(() => authority.dispose());
  const roster = {
    players: structuredClone(players),
    venues: [{ id: 'host', name: 'Host', connected: true }],
  };
  authority.setRoster(roster);
  const ready = (id: string, generation = configs[id].config.generation) =>
    authority.control(id, { type: 'ready', generation });
  const capability = (id: string, capabilities: Capabilities) =>
    authority.control(id, { type: 'capabilities', capabilities });
  const at = (time: number) => {
    clock = time;
    authority.tick();
  };
  const fire = (
    id: string,
    generation = configs[id].config.generation,
    time = clock,
  ) =>
    authority.control(id, {
      type: 'press',
      press: {
        playerId: id,
        generation,
        button: 0,
        counter: time % 256,
        time,
        x: 0.5,
        y: 0.5,
      },
    });
  const steer = (generation = configs.ada.config.generation) =>
    authority.control('ada', {
      type: 'widget',
      action: 'steer',
      generation,
      seq: clock,
      time: clock,
      value: { x: 1, y: 0 },
    });
  return {
    authority,
    configs,
    errors,
    phases,
    display,
    roster,
    ready,
    capability,
    at,
    fire,
    steer,
  };
}

void test('setup runs once with frozen ordered context and round input uses detached per-player requirements', () => {
  const f = fixture();
  const runner = new RoundRunner(f.descriptor, new SessionProgress());
  runner.prepare(players, 42);
  assert.ok(Object.isFrozen(f.setups[0]));
  assert.ok(Object.isFrozen(f.setups[0].players[0]));
  assert.equal(f.setups[0].seed, 42);
  assert.deepEqual(
    f.setups[0].players.map((p) => p.id),
    ['ada', 'bea'],
  );
  f.pilot.inputs.steer.label = 'changed after setup';
  assert.equal(runner.requirementsFor('ada')!.inputs.steer.label, undefined);
  assert.ok(Object.isFrozen(runner.requirementsFor('ada')!.inputs.steer));
  const assignments = runner.getAssignments();
  assignments[0].role = 'tampered';
  assert.equal(runner.roleFor('ada'), 'pilot');
  void runner.load();
  runner.begin(players, 0);
  assert.equal(f.setups.length, 1);
  assert.equal(f.contexts[0].seed, 42);
  assert.ok(Object.isFrozen(f.contexts[0].assignments[0].controls.inputs));
  assert.equal(
    runner.input(
      { playerId: 'ada', name: 'fire', time: 3050, aim: { x: 0, y: 0 } },
      3050,
    ),
    false,
  );
  assert.equal(
    runner.input(
      { playerId: 'bea', name: 'fire', time: 3050, aim: { x: 0, y: 0 } },
      3050,
    ),
    true,
  );
  runner.tick(
    3300,
    50,
    {
      ada: {
        steer: { time: 3050, value: { x: 0, y: 0 } },
        fire: { time: 3050, value: true },
      },
      bea: { steer: { time: 3050, value: { x: 0, y: 0 } } },
    },
    0,
  );
  assert.deepEqual(Object.keys(f.ticks.at(-1)!.values.ada), ['steer']);
  assert.deepEqual(f.ticks.at(-1)!.values.bea, {});
  const snapshot = runner.snapshot()!;
  assert.equal(snapshot.seed, 42);
  assert.equal(snapshot.assignments[0].role, 'pilot');
  assert.ok(snapshotPolicy(f.descriptor).valid(snapshot));
  for (const patch of [
    { seed: -1 },
    { assignments: [] },
    { assignments: [...snapshot.assignments, snapshot.assignments[0]] },
    { assignments: snapshot.assignments.map((a) => ({ ...a, role: '' })) },
  ])
    assert.equal(
      snapshotPolicy(f.descriptor).valid({ ...snapshot, ...patch }),
      false,
    );
  runner.dispose();
});

void test('invalid, duplicate or incomplete setup assignments and unresolvable layouts fail before configuration replacement', (t) => {
  const f = fixture();
  const r = room(t, f);
  const previous = structuredClone(r.configs);
  const valid = players.map((p, i) => ({
    playerId: p.id,
    role: 'role',
    controls: i === 0 ? f.pilot : f.gunner,
  }));
  for (const assignments of [
    [],
    [valid[0], valid[0]],
    [...valid, { ...valid[0], playerId: 'extra' }],
    valid.map((a) => ({ ...a, role: ' '.repeat(2) })),
    valid.map((a) => ({ ...a, role: 'x'.repeat(65) })),
    valid.map((a) => ({
      ...a,
      controls: { inputs: { fire: { required: true, prefer: 'slider' } } },
    })),
    valid.map((a) => ({
      ...a,
      controls: { ...a.controls, controller: { layout: 'does-not-exist' } },
    })),
  ]) {
    f.descriptor.setup = () => assignments as ParticipantAssignment[];
    assert.throws(() => r.authority.start(f.descriptor.id, 'standard'));
    assert.deepEqual(r.configs, previous);
  }
  assert.throws(
    () => prepareAssignments(f.descriptor, 'standard', players, 0x100000000),
    /setup/,
  );
  assert.equal(r.authority.summary().completed.length, 0);
});

void test('harness resolves mixed per-player capabilities from the same deterministic assignment seam', async () => {
  const f = fixture();
  const harness = new GameHarness(f.descriptor, {
    players,
    seed: 42,
    capabilities: { ada: granted(), bea: defaultCapabilities() },
  });
  assert.equal(harness.configs.ada.widgets[0].type, 'tilt');
  assert.equal(harness.configs.bea.widgets[0].type, 'button');
  await harness.load();
  harness.advance(3200);
  harness.press('ada', 'fire'); // The other role's action has no configured widget.
  harness.press('bea', 'fire');
  harness.advance(200);
  assert.deepEqual(
    f.ticks.flatMap((tick) => tick.actions).map((action) => action.playerId),
    ['bea'],
  );
  assert.equal(f.setups.length, 1);
  harness.dispose();
});

void test('preparation freezes participants through late arrival, disconnect and stale reconnect ACK', (t) => {
  const f = fixture();
  const r = room(t, f);
  r.capability('ada', granted());
  r.authority.start(f.descriptor.id, 'standard');
  const roundId = r.configs.ada.roundId;
  assert.equal(r.configs.ada.role, 'pilot');
  assert.equal(r.configs.bea.role, 'gunner');
  assert.equal(r.configs.bea.roundId, roundId);
  r.ready('ada');
  const oldBea = r.configs.bea.config.generation;
  r.roster.players.push({ ...players[1], id: 'late', name: 'Late', seat: 2 });
  r.roster.players[1].connected = false;
  r.authority.setRoster(r.roster);
  r.ready('late');
  r.at(100);
  assert.equal(f.contexts.length, 0);
  assert.equal(r.configs.late.role, null);
  r.roster.players[1].connected = true;
  r.authority.setRoster(r.roster);
  r.ready('bea', oldBea);
  r.at(200);
  assert.equal(f.contexts.length, 0);
  r.ready('bea');
  r.at(300);
  assert.deepEqual(
    f.contexts[0].players.map((p) => p.id),
    ['ada', 'bea'],
  );
  assert.equal(f.setups.length, 1);
  assert.equal(r.configs.bea.role, 'gunner');
  assert.equal(r.configs.bea.roundId, roundId);
  r.at(3500);
  r.fire('late');
  r.fire('bea');
  r.at(3720);
  assert.deepEqual(
    f.ticks.flatMap((tick) => tick.actions).map((action) => action.playerId),
    ['bea'],
  );
});

void test('capability failure retires old readiness, then recovers without reassigning roles', (t) => {
  const f = fixture(true);
  const r = room(t, f);
  const prior = structuredClone(r.configs);
  assert.throws(
    () => r.authority.start(f.descriptor.id, 'standard'),
    /Motion access/,
  );
  assert.deepEqual(r.configs, prior);
  r.capability('ada', granted());
  r.authority.start(f.descriptor.id, 'standard');
  r.ready('ada');
  r.ready('bea');
  r.at(0);
  r.at(3100);
  const old = r.configs.ada.config.generation;
  const roundId = r.configs.ada.roundId;
  r.steer();
  r.at(3120);
  assert.ok(f.ticks.at(-1)!.values.ada.steer);
  r.capability('ada', defaultCapabilities());
  r.ready('ada', old);
  r.steer(old);
  r.at(3140);
  assert.equal(f.ticks.at(-1)!.values.ada?.steer, undefined);
  assert.match(r.errors.at(-1)!, /Motion access/);
  r.capability('ada', granted());
  assert.notEqual(r.configs.ada.config.generation, old);
  assert.equal(r.configs.ada.roundId, roundId);
  assert.equal(r.configs.ada.role, 'pilot');
  r.ready('ada', old);
  r.steer();
  r.at(3160);
  assert.equal(f.ticks.at(-1)!.values.ada?.steer, undefined);
  r.ready('ada');
  r.steer();
  r.at(3180);
  assert.ok(f.ticks.at(-1)!.values.ada.steer);
  assert.equal(f.setups.length, 2); // One rejected candidate and the accepted round, never a capability rerun.
});

void test('capability substitution preserves role and requires acknowledgment of its replacement', (t) => {
  const f = fixture();
  const r = room(t, f);
  r.capability('ada', granted());
  r.authority.start(f.descriptor.id, 'standard');
  r.ready('ada');
  r.ready('bea');
  r.at(0);
  r.at(3100);
  const before = structuredClone(r.configs.ada);
  r.steer();
  r.at(3120);
  r.capability('ada', defaultCapabilities());
  assert.equal(r.configs.ada.config.widgets[0].type, 'dpad');
  assert.equal(r.configs.ada.role, before.role);
  assert.equal(r.configs.ada.roundId, before.roundId);
  r.ready('ada', before.config.generation);
  r.steer(before.config.generation);
  r.at(3140);
  assert.equal(f.ticks.at(-1)!.values.ada?.steer, undefined);
  r.ready('ada');
  r.steer();
  r.at(3160);
  assert.ok(f.ticks.at(-1)!.values.ada.steer);
  assert.equal(f.setups.length, 1);
});

void test('required capability withdrawal during preparation blocks start until a new acknowledgment', (t) => {
  const f = fixture(true);
  const r = room(t, f);
  r.capability('ada', granted());
  r.authority.start(f.descriptor.id, 'standard');
  const old = r.configs.ada.config.generation;
  r.ready('ada');
  r.ready('bea');
  r.capability('ada', defaultCapabilities());
  r.at(100);
  assert.equal(f.contexts.length, 0);
  r.capability('ada', granted());
  r.ready('ada', old);
  r.at(200);
  assert.equal(f.contexts.length, 0);
  r.ready('ada');
  r.at(300);
  assert.equal(f.contexts.length, 1);
  assert.equal(f.setups.length, 1);
});

void test('a missing prepared participant times out without shrinking roles or awarding points', (t) => {
  const f = fixture();
  const r = room(t, f);
  r.authority.start(f.descriptor.id, 'standard');
  r.ready('ada');
  r.roster.players = r.roster.players.filter((p) => p.id !== 'bea');
  r.authority.setRoster(r.roster);
  r.at(14980);
  assert.equal(f.contexts.length, 0);
  r.at(15000);
  assert.equal(r.phases.at(-1), 'aborted');
  assert.equal(r.authority.summary().completed.length, 0);
});
