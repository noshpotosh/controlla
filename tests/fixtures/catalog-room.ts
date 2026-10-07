import assert from 'node:assert/strict';
import type { TestContext } from 'node:test';
import { SessionAuthority } from '../../src/client/engine/session.ts';
import { games, findGame } from '../../src/client/minigames/catalog.ts';
import { catalogSnapshotPolicy } from '../../src/client/engine/snapshots.ts';
import { ProgressAssembler } from '../../src/client/engine/history.ts';
import { SnapshotTimeline } from '../../src/client/engine/replication.ts';
import type {
  RoundSnapshot,
  PresentationEvent,
} from '../../src/client/api/index.ts';
import type { ControllerConfig } from '../../src/client/controls/api.ts';
import type { Message } from '../../src/client/engine/messages.ts';
import type { WireSnapshot } from '../../src/client/engine/replication.ts';
import type { Player } from '../../src/shared/room.ts';

export function room(t: TestContext) {
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
