import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { SessionAuthority } from '../src/client/engine/session.ts';
import { games, findGame } from '../src/client/minigames/catalog.ts';
import { catalogSnapshotPolicy } from '../src/client/engine/snapshots.ts';
import { ProgressAssembler } from '../src/client/engine/history.ts';
import { SnapshotTimeline } from '../src/client/engine/replication.ts';
import type {
  RoundSnapshot,
  PresentationEvent,
} from '../src/client/api/index.ts';
import type { ControllerConfig } from '../src/client/controls/api.ts';
import type { Message } from '../src/client/engine/messages.ts';
import type { WireSnapshot } from '../src/client/engine/replication.ts';
import type { Player } from '../src/shared/room.ts';
import {
  harvestPosition,
  type NeonHarvestState,
} from '../src/client/minigames/neon-harvest/game.ts';
import { buttonProbe } from './fixtures/games.ts';
import type { GameDescriptor } from '../src/client/api/index.ts';

function room(t: TestContext) {
  let time = 0;
  t.mock.method(performance, 'now', () => time);
  const players: Player[] = ['a', 'b'].map((id, seat) => ({
    id,
    seat,
    name: id,
    color: '#b6ff65',
    venueId: seat ? 'remote' : 'host',
    connected: true,
  }));
  const roster = {
    players,
    venues: ['host', 'remote'].map((id) => ({ id, name: id, connected: true })),
  };
  const configs: Record<string, ControllerConfig> = {};
  const host = new SnapshotTimeline(catalogSnapshotPolicy(games));
  const remote = new SnapshotTimeline(catalogSnapshotPolicy(games));
  const hydration = new ProgressAssembler();
  const deliveries: { at: number; wire: WireSnapshot<RoundSnapshot> }[] = [];
  const events: (PresentationEvent & { roundId: string })[] = [];
  const phases: Message[] = [];
  const warnings: string[] = [];
  const authority = new SessionAuthority('host', {
    toPlayer(id, message) {
      if (message.type === 'config') configs[id] = message.config;
    },
    toVenue(id, message) {
      if (id === 'remote' && message.type === 'progressBatch')
        hydration.receive(message);
      if (id === 'host' && message.type === 'phase')
        phases.push(structuredClone(message));
    },
    snapshot(id, message) {
      if (id === 'host') {
        assert.equal(host.receive(message.snapshot), true);
        authority.control(id, { type: 'snapshotAck', id: message.snapshot.id });
      } else
        deliveries.push({
          at: time + 80,
          wire: structuredClone(message.snapshot),
        });
    },
    event(id, event) {
      if (id === 'host') events.push(event);
    },
    warning(message) {
      warnings.push(message);
    },
  });
  authority.setRoster(roster);
  t.after(() => authority.dispose());
  const at = (next: number) => {
    time = next;
    authority.tick();
    for (const delivery of deliveries.filter((d) => d.at <= time)) {
      assert.equal(remote.receive(delivery.wire), true);
      authority.control('remote', {
        type: 'snapshotAck',
        id: delivery.wire.id,
      });
    }
    for (let i = deliveries.length - 1; i >= 0; i--)
      if (deliveries[i].at <= time) deliveries.splice(i, 1);
  };
  const begin = (id: string, mode = findGame(id)!.defaultMode) => {
    authority.start(id, mode);
    for (const player of players.filter((p) => p.connected))
      authority.control(player.id, {
        type: 'ready',
        generation: configs[player.id].generation,
      });
    at(time + 20);
    return host.frames.at(-1)!.state;
  };
  const fire = (
    playerId: string,
    x: number,
    y: number,
    when = time,
    counter = 1,
  ) => {
    authority.control(playerId, {
      type: 'press',
      press: {
        generation: configs[playerId].generation,
        time: when,
        button: 0,
        counter,
        x,
        y,
      },
    });
  };
  return {
    authority,
    players,
    roster,
    configs,
    host,
    remote,
    hydration,
    events,
    phases,
    warnings,
    at,
    begin,
    fire,
    time: () => time,
  };
}

/** Each shipped game's statistics keys, sorted. */
const statKeys: Record<string, string[]> = {
  'double-dash': [],
  'neon-harvest': ['bestChain', 'collected', 'mineHits'],
  'whack-a-mole': ['bestStreak', 'bombs', 'golden', 'hits', 'misses'],
};

void test('live catalog runs every mode through the generic host/remote boundary and retains game statistics', (t) => {
  const r = room(t);
  for (const game of games) {
    for (const mode of game.modes) {
      const opening = r.begin(game.id, mode.id);
      r.at(opening.startAt + 40);
      r.at(opening.endAt);
      assert.equal(r.host.frames.at(-1)!.state.phase, 'settling');
      r.at(opening.endAt + 200);
      r.at(opening.endAt + 400);
      const host = r.host.sample(r.time() - 160)!;
      const remote = r.remote.sample(r.time() - 160)!;
      assert.deepEqual(remote, host);
      assert.equal(host.gameId, game.id);
      assert.equal(host.mode, mode.id);
      assert.equal(host.phase, 'results');
      assert.deepEqual(
        host.outcomes.map((o) => o.placement),
        [1, 1],
      );
      assert.deepEqual(host.progress.awards, { a: 0, b: 0 });
      assert.equal(
        'rounds' in host.progress,
        false,
        'snapshots do not carry report history',
      );
      for (const result of r.authority.summary().completed.at(-1)!.results)
        assert.deepEqual(Object.keys(result.stats).sort(), statKeys[game.id]);
    }
  }
  assert.equal(
    r.authority.summary().completed.length,
    games.reduce((total, game) => total + game.modes.length, 0),
  );
  assert.deepEqual(r.hydration.view(), r.authority.summary().progress);
  assert.deepEqual(r.warnings, []);
});

void test('Neon Harvest awards once across rematches, holds disconnected outcomes and aborts without awards', (t) => {
  const r = room(t);
  for (let round = 0; round < 2; round++) {
    const opening = r.begin('neon-harvest');
    r.at(opening.startAt + 40);
    r.at(opening.startAt + 500);
    const node = (
      r.host.frames.at(-1)!.state.state as NeonHarvestState
    ).nodes.find((n) => n.kind !== 'mine')!;
    const point = harvestPosition(node, r.time());
    r.fire('a', point.x, point.y);
    r.fire('a', point.x, point.y);
    r.at(r.time() + 220);
    const collected = (r.host.frames.at(-1)!.state.state as NeonHarvestState)
      .players.a.collected;
    assert.ok(collected > 0);
    const score = (r.host.frames.at(-1)!.state.state as NeonHarvestState).scores
      .a;
    r.players[0].connected = false;
    r.authority.setRoster(r.roster);
    r.at(opening.endAt + 200);
    r.at(opening.endAt + 400);
    assert.equal(r.host.frames.at(-1)!.state.progress.totals.a, round + 1);
    assert.equal(
      r.host.frames.at(-1)!.state.outcomes.find((o) => o.playerId === 'a')!
        .score,
      score,
    );
    r.players[0].connected = true;
    r.authority.setRoster(r.roster);
  }
  const closed = r.authority.summary().progress;
  const opening = r.begin('neon-harvest');
  r.at(opening.endAt + 100);
  r.authority.abort();
  r.at(opening.endAt + 400);
  assert.equal(r.host.frames.at(-1)!.state.phase, 'aborted');
  assert.deepEqual(r.authority.summary().progress.totals, closed.totals);
  assert.equal(r.authority.summary().progress.rounds.at(-1)!.status, 'aborted');
  assert.equal(
    new Set(
      r.authority.summary().progress.rounds.map((record) => record.roundId),
    ).size,
    3,
  );
});

void test('unknown choices leave configuration intact; late players cannot enter a running round', (t) => {
  const r = room(t);
  const before = structuredClone(r.configs);
  assert.throws(() => r.authority.start('missing', 'standard'), /Unknown/);
  assert.throws(() => r.authority.start('neon-harvest', 'missing'), /mode/i);
  assert.deepEqual(r.configs, before);
  const opening = r.begin('neon-harvest');
  r.players.push({ ...r.players[0], id: 'late', name: 'Late', seat: 2 });
  r.authority.setRoster(r.roster);
  r.at(opening.startAt + 20);
  r.fire('late', 0.5, 0.5);
  r.at(r.time() + 250);
  assert.deepEqual(
    Object.keys(
      (r.host.frames.at(-1)!.state.state as NeonHarvestState).players,
    ),
    ['a', 'b'],
  );
  r.at(opening.endAt + 200);
  assert.equal(r.authority.summary().progress.totals.late, undefined);
});

void test('presentation telemetry accepts only current registered markers once per venue', (t) => {
  const descriptor: GameDescriptor = {
    ...buttonProbe,
    id: 'marker-probe',
    create() {
      const game = buttonProbe.create();
      let emitted = false;
      return {
        ...game,
        tick(input) {
          const events = [...game.tick(input)];
          if (!emitted) {
            emitted = true;
            events.push({
              id: 'prompt',
              kind: 'prompt',
              time: input.time,
              clock: 'authority',
              measure: true,
            });
          }
          return events;
        },
      };
    },
  };
  (games as GameDescriptor[]).push(descriptor);
  t.after(() =>
    (games as GameDescriptor[]).splice(games.indexOf(descriptor), 1),
  );
  const r = room(t);
  const opening = r.begin(descriptor.id);
  r.at(opening.startAt + 1040);
  const prompt = r.events.find((event) => event.measure)!;
  assert.equal(prompt.clock, 'authority');
  r.at(prompt.time + 100);
  r.authority.control('host', {
    type: 'presented',
    roundId: opening.roundId,
    eventId: 'unknown',
    at: r.time(),
  });
  r.authority.control('host', {
    type: 'presented',
    roundId: opening.roundId,
    eventId: prompt.id,
    at: prompt.time + 5,
  });
  r.authority.control('remote', {
    type: 'presented',
    roundId: opening.roundId,
    eventId: prompt.id,
    at: prompt.time + 15,
  });
  r.authority.control('host', {
    type: 'presented',
    roundId: opening.roundId,
    eventId: prompt.id,
    at: prompt.time + 80,
  });
  // The public report carries measured spread, without any dependency on game fields.
  assert.equal(r.authority.summary().presentationSpreadMs, 10);
});

void test('Neon Harvest permits a solo live round with outcomes and no opponent award', (t) => {
  const r = room(t);
  r.players.splice(1);
  r.authority.setRoster(r.roster);
  const opening = r.begin('neon-harvest');
  r.at(opening.startAt + 40);
  r.at(opening.endAt + 200);
  r.at(opening.endAt + 400);
  const result = r.host.frames.at(-1)!.state;
  assert.equal(result.phase, 'results');
  assert.equal(result.outcomes.length, 1);
  assert.equal(result.outcomes[0].playerId, 'a');
  assert.deepEqual(result.progress.awards, { a: 0 });
  assert.equal(result.progress.totals.a, 0);
});
