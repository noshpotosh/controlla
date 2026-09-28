import test from 'node:test';
import assert from 'node:assert/strict';
import { DisplayPlayback } from '../src/client/runtime/playback/display-playback.ts';
import type {
  PresentationEvent,
  RoundSnapshot,
} from '../src/client/api/index.ts';
import type { SnapshotPolicy } from '../src/client/engine/replication.ts';

function state(roundId = 'a'): RoundSnapshot<object> {
  return {
    schemaVersion: 1,
    roundId,
    gameId: 'fixture',
    mode: 'standard',
    phase: 'running',
    startAt: 0,
    endAt: 2000,
    players: [],
    state: { value: 1 },
    cursors: {},
    events: [
      {
        id: 'marker',
        time: 900,
        clock: 'presentation',
        kind: 'prompt',
        measure: true,
      },
    ],
    outcomes: [],
    progress: { revision: 0, totals: {}, awards: {} },
    error: null,
  };
}
function fixture() {
  const effects: unknown[][] = [];
  let interpolations = 0;
  const policy: SnapshotPolicy<RoundSnapshot<object>> = {
    valid: (value): value is RoundSnapshot<object> =>
      !!value &&
      typeof value === 'object' &&
      (value as RoundSnapshot).schemaVersion === 1 &&
      typeof (value as RoundSnapshot).roundId === 'string',
    interpolate: (before) => {
      interpolations++;
      return before;
    },
  };
  const playback = new DisplayPlayback(
    policy,
    (game, mode) => game === 'fixture' && mode === 'standard',
    {
      acknowledge: (id) => effects.push(['ack', id]),
      resync: () => effects.push(['resync']),
      venueStats: (delay) => effects.push(['stats', delay]),
      presented: (...args) => effects.push(['presented', ...args]),
      recoveryWarning: (active) => effects.push(['warning', active]),
      playEvent: (event) => effects.push(['event', event.id]),
    },
  );
  const full = (snapshot = state(), id = 1, time = 800, ready = true) =>
    playback.acceptSnapshot(
      { id, time, base: null, patch: snapshot },
      100,
      'venue',
      1000,
      ready,
    );
  const event = (
    id: string,
    clock: PresentationEvent['clock'] = 'presentation',
    time = 950,
    roundId = 'a',
  ) => playback.acceptEvent({ id, clock, time, roundId, kind: 'hit' });
  return {
    playback,
    effects,
    full,
    event,
    interpolations: () => interpolations,
  };
}

void test('playback samples once, freezes detached frames, and preserves delayed results and metrics', () => {
  const f = fixture();
  f.full();
  f.playback.acceptSnapshot(
    {
      id: 2,
      time: 1000,
      base: 1,
      patch: {
        phase: 'results',
        progress: { revision: 1, totals: { a: 2 }, awards: { a: 2 } },
      },
    },
    100,
    'venue',
    1000,
    true,
  );
  const cursors = { a: { x: 0.3, y: 0.4 } };
  const frame = f.playback.advanceFrame(1000, cursors);
  assert.equal(f.interpolations(), 1);
  assert.equal(frame.snapshot?.phase, 'running');
  assert.equal(frame.snapshot?.progress.revision, 0);
  assert.equal(frame.presentationTime, 900);
  assert.ok(Object.isFrozen(frame.snapshot?.state));
  assert.ok(Object.isFrozen(frame.localCursors.a));
  cursors.a.x = 0.8;
  assert.equal(frame.localCursors.a.x, 0.3);
  assert.equal(f.playback.advanceFrame(1100, {}).snapshot?.phase, 'results');
  assert.equal(
    f.playback.advanceFrame(1300, {}).snapshot?.progress.totals.a,
    2,
  );
  assert.equal(f.playback.metrics().starvations, 1);
  assert.ok(f.playback.metrics().lastBytes > 0);
  assert.ok(f.playback.metrics().deltaRatio! < 1);
  assert.deepEqual(
    f.effects.filter((e) => e[0] === 'stats'),
    [
      ['stats', 200],
      ['stats', 0],
    ],
  );
});

void test('malformed snapshots retain the frame; resync coalesces until reconnect or a full snapshot', () => {
  const f = fixture();
  f.full(state(), 1, 800, false);
  assert.equal(f.effects.filter((e) => e[0] === 'stats').length, 0);
  const missing = { id: 5, time: 850, base: 4, patch: {} };
  f.playback.acceptSnapshot(null, 200, null, 1000, true);
  f.playback.acceptSnapshot(missing, 200, null, 1000, true);
  assert.equal(f.playback.advanceFrame(1000, {}).snapshot?.roundId, 'a');
  assert.equal(f.playback.delay, 100);
  assert.equal(f.playback.limitingVenue, 'venue');
  assert.equal(f.effects.filter((e) => e[0] === 'resync').length, 1);
  f.playback.reconnect();
  f.playback.acceptSnapshot(missing, 200, null, 1000, true);
  assert.equal(f.effects.filter((e) => e[0] === 'resync').length, 2);
  f.full(state(), 6);
  assert.deepEqual(f.effects.at(-3), ['warning', false]);
  f.playback.acceptSnapshot(
    { id: 7, time: NaN, base: null, patch: state() },
    0,
    null,
    1000,
    true,
  );
  assert.equal(f.effects.filter((e) => e[0] === 'resync').length, 3);
});

void test('phase gates and incompatible snapshots preserve screen statuses without exposing old rounds', () => {
  const f = fixture();
  f.full();
  assert.equal(f.playback.acceptPhase({ phase: 'invented' }), null);
  f.playback.acceptPhase({ phase: 'loading', roundId: 'b' });
  assert.equal(f.playback.advanceFrame(1000, {}).status, 'loading');
  assert.equal(f.playback.advanceFrame(1000, {}).snapshot, null);
  f.playback.acceptPhase({ phase: 'aborted' });
  assert.equal(f.playback.advanceFrame(1000, {}).status, 'aborted');
  f.playback.acceptPhase({ phase: 'error', error: 'Load failed' });
  assert.equal(f.playback.advanceFrame(1000, {}).message, 'Load failed');
  f.playback.acceptPhase({ phase: 'running', roundId: 'a' });
  f.playback.acceptSnapshot(
    { id: 2, time: 900, base: null, patch: { schemaVersion: 2 } },
    0,
    null,
    1000,
    true,
  );
  assert.equal(f.playback.advanceFrame(1000, {}).status, 'unsupported');
  f.full({ ...state(), mode: 'unknown' }, 3);
  assert.equal(f.playback.advanceFrame(1000, {}).status, 'unsupported');
  f.full(state(), 4);
  assert.equal(f.playback.advanceFrame(1000, {}).status, 'ready');
});

void test('cue clocks, duplicate IDs, stale cues, disconnect and retired rounds remain isolated', () => {
  const f = fixture();
  f.full();
  f.playback.acceptPhase({ phase: 'running', roundId: 'a' });
  f.event('presentation');
  f.event('presentation');
  f.event('authority', 'authority');
  f.event('old', 'authority', -100);
  f.event('invalid', 'authority', NaN);
  f.playback.advanceFrame(1000, {});
  assert.deepEqual(
    f.effects.filter((e) => e[0] === 'event'),
    [['event', 'authority']],
  );
  f.playback.advanceFrame(1050, {});
  f.playback.advanceFrame(1100, {});
  assert.deepEqual(
    f.effects.filter((e) => e[0] === 'event'),
    [
      ['event', 'authority'],
      ['event', 'presentation'],
    ],
  );
  f.event('disconnect');
  f.playback.disconnect();
  f.playback.reconnect();
  f.playback.advanceFrame(1100, {});
  f.playback.acceptPhase({ phase: 'loading', roundId: 'b' });
  f.event('retired', 'authority', 1000, 'a');
  f.full(state('b'), 2);
  f.playback.acceptPhase({ phase: 'running', roundId: 'b' });
  f.event('next', 'authority', 1000, 'b');
  f.playback.advanceFrame(1100, {});
  assert.deepEqual(
    f.effects.filter((e) => e[0] === 'event'),
    [
      ['event', 'authority'],
      ['event', 'presentation'],
      ['event', 'next'],
    ],
  );
});

void test('marker acknowledgement is sampled, round scoped, deduplicated and disabled during loading', () => {
  const f = fixture();
  f.full();
  f.playback.presented('a', ['marker'], 1000);
  assert.equal(f.effects.filter((e) => e[0] === 'presented').length, 0);
  f.playback.advanceFrame(1000, {});
  f.playback.presented('wrong', ['marker'], 1000);
  f.playback.presented('a', ['unknown', 'marker', 'marker'], 1000);
  f.playback.presented('a', ['marker'], 1001);
  assert.deepEqual(
    f.effects.filter((e) => e[0] === 'presented'),
    [['presented', 'a', 'marker', 1000]],
  );
  f.playback.acceptPhase({ phase: 'loading', roundId: 'b' });
  f.full(state('b'), 2);
  f.playback.advanceFrame(1100, {});
  f.playback.presented('b', ['marker'], 1100);
  assert.equal(f.effects.filter((e) => e[0] === 'presented').length, 1);
  f.playback.acceptPhase({ phase: 'running', roundId: 'b' });
  f.playback.advanceFrame(1100, {});
  f.playback.presented('b', ['marker'], 1100);
  assert.equal(f.effects.filter((e) => e[0] === 'presented').length, 2);
});

void test('end and repeated disposal retain diagnostics but prevent every late playback effect', () => {
  for (const stop of ['end', 'dispose'] as const) {
    const f = fixture();
    f.full();
    f.event('pending');
    f.playback.advanceFrame(900, {});
    const metrics = f.playback.metrics();
    f.playback[stop]();
    f.playback[stop]();
    const before = structuredClone(f.effects);
    f.full(state(), 2);
    f.playback.acceptSnapshot(null, 0, null, 1200, true);
    f.event('late');
    f.playback.reconnect();
    assert.equal(
      f.playback.acceptPhase({ phase: 'running', roundId: 'b' }),
      null,
    );
    f.playback.presented('a', ['marker'], 1200);
    assert.equal(f.playback.advanceFrame(1000, {}).status, 'ended');
    assert.deepEqual(f.effects, before);
    assert.deepEqual(f.playback.metrics(), metrics);
  }
});

void test('cue backlog stays bounded and future round cues wait for the matching snapshot', () => {
  const f = fixture();
  f.full();
  for (let i = 0; i < 300; i++) f.event(`cue-${i}`, 'authority', 1000);
  f.playback.advanceFrame(1000, {});
  const cues = f.effects.filter((e) => e[0] === 'event');
  assert.equal(cues.length, 256);
  assert.equal(cues[0][1], 'cue-44');
  f.event('future', 'authority', 1000, 'b');
  f.playback.advanceFrame(1000, {});
  assert.equal(f.effects.filter((e) => e[0] === 'event').length, 256);
  f.playback.acceptPhase({ phase: 'running', roundId: 'b' });
  f.full(state('b'), 2);
  f.playback.advanceFrame(1000, {});
  assert.deepEqual(f.effects.at(-1), ['event', 'future']);
});
