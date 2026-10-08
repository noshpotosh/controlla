import assert from 'node:assert/strict';
import test from 'node:test';
import {
  GameHarness,
  simulatedPlayers,
} from '../src/client/devtools/game-harness/harness.ts';
import { driveSimulatedPlayers } from '../src/client/devtools/game-harness/simulation.ts';
import { SessionProgress } from '../src/client/engine/progress.ts';
import { SessionAuthority } from '../src/client/engine/session.ts';
import { games } from '../src/client/minigames/catalog.ts';
import { buttonProbe } from './fixtures/games.ts';
import type { ControllerConfig } from '../src/client/controls/api.ts';

void test('fixed identity, seed, roster and clock reproduce complete authority snapshots and outcomes', async () => {
  for (const descriptor of games) {
    const replay = async () => {
      const harness = new GameHarness(descriptor, {
        sessionId: 'replay-session',
        seed: 73,
        initialTime: 100.25,
        players: structuredClone(simulatedPlayers),
      });
      try {
        await harness.load();
        const snapshots = [harness.authoritativeSnapshot()];
        while (!['results', 'error'].includes(harness.phase)) {
          harness.advance(1000, driveSimulatedPlayers);
          snapshots.push(harness.authoritativeSnapshot());
        }
        assert.equal(harness.error, null);
        return { snapshots, progress: harness.progressView() };
      } finally {
        harness.dispose();
      }
    };
    assert.deepEqual(await replay(), await replay(), descriptor.id);
  }
});

void test('authority inspection is detached and precedes the separate delayed display samples', async () => {
  const harness = new GameHarness(buttonProbe, { sessionId: 'inspect' });
  try {
    await harness.load();
    harness.advance(3200);
    harness.press('ada', 'fire');
    harness.advance(200);
    const current = harness.authoritativeSnapshot()!;
    assert.equal(current.state!.scores.ada, 1);
    assert.equal(harness.display('host')!.state!.scores.ada, 0);
    assert.deepEqual(harness.display('host'), harness.display('remote'));
    current.state!.scores.ada = 999;
    current.players[0].name = 'tampered';
    current.assignments[0].role = 'tampered';
    assert.equal(harness.authoritativeSnapshot()!.state!.scores.ada, 1);
    assert.equal(harness.authoritativeSnapshot()!.players[0].name, 'Ada');
    assert.equal(
      harness.authoritativeSnapshot()!.assignments[0].role,
      'default',
    );
    harness.advance(200);
    assert.equal(harness.display('host')!.state!.scores.ada, 1);
  } finally {
    harness.dispose();
  }
});

void test('identity injection is bounded, called once and preserves monotonic round identity', () => {
  let calls = 0;
  const progress = new SessionProgress(() => {
    calls++;
    return 'fixed';
  });
  assert.equal(progress.reserveRoundId(), 'fixed:1');
  assert.equal(progress.reserveRoundId(), 'fixed:2');
  assert.equal(calls, 1);
  for (const id of ['', ' ', 'x'.repeat(129)]) {
    assert.throws(() => new SessionProgress(() => id), /session identity/);
    assert.throws(
      () => new GameHarness(buttonProbe, { sessionId: id }),
      /session identity/,
    );
  }
  for (const initialTime of [-1, NaN, Infinity])
    assert.throws(
      () => new GameHarness(buttonProbe, { initialTime }),
      /harness clock/,
    );
  assert.throws(
    () => new GameHarness(buttonProbe, { progress, sessionId: 'other' }),
    /not both/,
  );
});

void test('production authority dependencies replay configurations and wire snapshots without global clock mocks', () => {
  const replay = () => {
    let time = 100;
    const configs: Record<string, ControllerConfig> = {},
      messages: unknown[] = [];
    const authority = new SessionAuthority(
      'host',
      {
        toPlayer(id, msg) {
          if (msg.type === 'config') configs[id] = msg.config;
          messages.push(structuredClone(msg));
        },
        toVenue(_id, msg) {
          messages.push(structuredClone(msg));
        },
        snapshot(_id, msg) {
          messages.push(structuredClone(msg));
        },
        event(_id, msg) {
          messages.push(structuredClone(msg));
        },
        warning() {},
      },
      { now: () => time, sessionId: () => 'authority-replay', seed: () => 73 },
    );
    try {
      authority.setRoster({
        players: structuredClone(simulatedPlayers),
        venues: [{ id: 'host', name: 'Host', connected: true }],
      });
      authority.start(games[0].id, games[0].defaultMode);
      for (const p of simulatedPlayers)
        authority.control(p.id, {
          type: 'ready',
          generation: configs[p.id].generation,
        });
      for (; time < 4200; time += 20) authority.tick();
      return messages;
    } finally {
      authority.dispose();
    }
  };
  assert.deepEqual(replay(), replay());
});
