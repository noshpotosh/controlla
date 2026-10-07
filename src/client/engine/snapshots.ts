import { isJsonValue } from './json.ts';
export { isJsonValue } from './json.ts';
import { validAssignments, validSeed } from './round-setup.ts';
import { validRoundTiming, timingDuration } from './timing-policy.ts';
import type { SnapshotPolicy } from './replication.ts';
import type { GameDescriptor, RoundSnapshot } from '../api/index.ts';

export const MAX_ROUND_SNAPSHOT_BYTES = 47 * 1024;
const phases = [
  'countdown',
  'running',
  'settling',
  'results',
  'aborted',
  'error',
];
const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown, max = 160): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= max;
const finite = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);
const point = (value: unknown) =>
  record(value) && finite(value.x) && finite(value.y);
const counters = (value: unknown) =>
  record(value) &&
  Object.keys(value).length <= 8 &&
  Object.values(value).every(
    (n) => finite(n) && Number.isSafeInteger(n) && n >= 0,
  );

/** Known schema envelopes can be retained even when this display lacks the game. */
export function validRoundSnapshot(value: unknown): value is RoundSnapshot {
  if (!record(value) || !isJsonValue(value)) return false;
  const s = value;
  if (!Array.isArray(s.players)) return false;
  const players = s.players as unknown[];
  const playerIds = new Set(players.filter(record).map((p) => p.id));
  if (
    s.schemaVersion !== 2 ||
    !validRoundTiming(s.timing) ||
    !validSeed(s.seed) ||
    !validAssignments(
      s.assignments,
      players.filter(record) as { id: string }[],
    ) ||
    !text(s.gameId) ||
    !text(s.roundId) ||
    !text(s.mode) ||
    !phases.includes(s.phase as string) ||
    !finite(s.startAt) ||
    !finite(s.endAt) ||
    s.endAt < s.startAt ||
    s.endAt >
      s.startAt +
        timingDuration(s.timing as import('../api/index.ts').RoundTiming) ||
    !Array.isArray(s.players) ||
    s.players.length < 1 ||
    s.players.length > 8 ||
    !s.players.every(
      (p) =>
        record(p) &&
        text(p.id) &&
        text(p.name) &&
        text(p.venueId) &&
        text(p.color) &&
        Number.isInteger(p.seat) &&
        (p.seat as number) >= 0 &&
        (p.seat as number) <= 7 &&
        typeof p.connected === 'boolean',
    ) ||
    new Set(s.players.map((p) => p.id)).size !== s.players.length ||
    !record(s.cursors) ||
    Object.keys(s.cursors).some((id) => !playerIds.has(id)) ||
    !Object.values(s.cursors).every(point) ||
    !Array.isArray(s.events) ||
    s.events.length > 128 ||
    !s.events.every(
      (e) =>
        record(e) &&
        text(e.id) &&
        finite(e.time) &&
        text(e.kind) &&
        ['authority', 'presentation'].includes(e.clock as string) &&
        (e.measure === undefined || typeof e.measure === 'boolean') &&
        (e.playerId === undefined || playerIds.has(e.playerId)),
    ) ||
    new Set(s.events.map((e) => e.id)).size !== s.events.length ||
    !Array.isArray(s.outcomes) ||
    s.outcomes.length > s.players.length ||
    !s.outcomes.every(
      (o) =>
        record(o) &&
        playerIds.has(o.playerId) &&
        finite(o.score) &&
        Number.isInteger(o.placement) &&
        (o.placement as number) >= 1 &&
        (o.placement as number) <= players.length &&
        (o.stats === undefined ||
          (record(o.stats) &&
            Object.keys(o.stats).length <= 16 &&
            Object.entries(o.stats).every(
              ([key, value]) =>
                key.length > 0 && key.length <= 64 && finite(value),
            ) &&
            isJsonValue(o.stats, 1024))),
    ) ||
    new Set(s.outcomes.map((o) => o.playerId)).size !== s.outcomes.length ||
    !record(s.progress) ||
    !Number.isSafeInteger(s.progress.revision) ||
    (s.progress.revision as number) < 0 ||
    !counters(s.progress.totals) ||
    !counters(s.progress.awards) ||
    Object.keys(s.progress.totals as object).some((id) => !playerIds.has(id)) ||
    Object.keys(s.progress.awards as object).some((id) => !playerIds.has(id)) ||
    !(
      s.error === null ||
      (typeof s.error === 'string' && s.error.length <= 2000)
    )
  )
    return false;
  if (s.phase === 'results' && s.outcomes.length !== s.players.length)
    return false;
  if (s.phase !== 'results' && s.outcomes.length !== 0) return false;
  if (s.state === null) return s.phase === 'error' || s.phase === 'aborted';
  return record(s.state) && isJsonValue(s.state, 40 * 1024);
}

export function snapshotPolicy<S extends object>(
  game: GameDescriptor<S>,
): SnapshotPolicy<RoundSnapshot<S>> {
  return {
    valid(value): value is RoundSnapshot<S> {
      if (
        !validRoundSnapshot(value) ||
        value.gameId !== game.id ||
        !validRoundTiming(game.timing) ||
        value.timing.kind !== game.timing.kind ||
        timingDuration(value.timing) !== timingDuration(game.timing) ||
        !game.modes.some((mode) => mode.id === value.mode) ||
        value.players.length < game.players.min ||
        value.players.length > game.players.max
      )
        return false;
      if (value.state === null) return true;
      try {
        return game.isState(value.state);
      } catch {
        return false;
      }
    },
    interpolate(before, after, ratio) {
      if (
        before.roundId !== after.roundId ||
        before.gameId !== after.gameId ||
        before.mode !== after.mode ||
        before.phase !== after.phase
      )
        return before;
      if (before.state && after.state && game.interpolate) {
        try {
          const state = game.interpolate(
            structuredClone(before.state),
            structuredClone(after.state),
            ratio,
          );
          if (isJsonValue(state, 40 * 1024) && game.isState(state))
            before.state = state;
        } catch {
          /* A broken display interpolator cannot stop the authority or display loop. */
        }
      }
      return before;
    },
  };
}

export function catalogSnapshotPolicy(
  catalog: readonly GameDescriptor[],
): SnapshotPolicy<RoundSnapshot<object>> {
  const policies = new Map(
    catalog.map((game) => [game.id, snapshotPolicy(game)]),
  );
  return {
    valid(value): value is RoundSnapshot<object> {
      if (!validRoundSnapshot(value)) return false;
      const game = catalog.find((descriptor) => descriptor.id === value.gameId);
      return (
        !game ||
        !game.modes.some((mode) => mode.id === value.mode) ||
        policies.get(value.gameId)!.valid(value)
      );
    },
    interpolate(before, after, ratio) {
      if (
        before.gameId !== after.gameId ||
        before.mode !== after.mode ||
        before.roundId !== after.roundId ||
        before.phase !== after.phase
      )
        return before;
      const game = catalog.find(
        (descriptor) => descriptor.id === before.gameId,
      );
      if (!game || !game.modes.some((mode) => mode.id === before.mode))
        return before;
      return (
        policies.get(before.gameId)?.interpolate(before, after, ratio) ?? before
      );
    },
  };
}
