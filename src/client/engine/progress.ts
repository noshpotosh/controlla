import type {
  CompactProgress,
  Completion,
  Outcome,
  Player,
  Progress,
  RoundRecord,
} from '../api/index.ts';

let fallbackSequence = 0;
const utf8 = new TextEncoder();

function sessionId(): string {
  return (
    globalThis.crypto?.randomUUID?.() ??
    `session-${Date.now().toString(36)}-${++fallbackSequence}-${Math.random().toString(36).slice(2)}`
  );
}

export function dataRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/** Canonical, detached statistics. Empty statistics and omitted statistics agree. */
function normalizeStats(value: unknown): Record<string, number> | null {
  if (!dataRecord(value)) return null;
  const entries = Object.entries(value);
  if (
    entries.length > 16 ||
    entries.some(
      ([key, number]) =>
        key.length === 0 ||
        key.length > 64 ||
        typeof number !== 'number' ||
        !Number.isFinite(number),
    )
  )
    return null;
  const stats = Object.fromEntries(
    entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
  ) as Record<string, number>;
  if (utf8.encode(JSON.stringify(stats)).byteLength > 1024) return null;
  return stats;
}

/** Return outcomes in the fixed eligibility order, never aliases to game data. */
export function normalizeOutcomes(
  value: unknown,
  roster: readonly string[],
): Outcome[] | null {
  if (!Array.isArray(value) || value.length !== roster.length) return null;
  const eligible = new Set(roster);
  const byPlayer = new Map<string, Outcome>();
  for (const outcome of value) {
    if (
      !dataRecord(outcome) ||
      typeof outcome.playerId !== 'string' ||
      !eligible.has(outcome.playerId) ||
      byPlayer.has(outcome.playerId) ||
      typeof outcome.score !== 'number' ||
      !Number.isFinite(outcome.score) ||
      typeof outcome.placement !== 'number' ||
      !Number.isInteger(outcome.placement) ||
      outcome.placement < 1 ||
      outcome.placement > roster.length
    )
      return null;
    const stats =
      outcome.stats === undefined ? {} : normalizeStats(outcome.stats);
    if (!stats) return null;
    byPlayer.set(outcome.playerId, {
      playerId: outcome.playerId,
      placement: outcome.placement,
      score: outcome.score,
      ...(Object.keys(stats).length ? { stats } : {}),
    });
  }
  return roster.map((id) => byPlayer.get(id)!);
}

/** Fixed-round names and colors are report data; device capabilities are not. */
export function reportPlayers(players: readonly Player[]): Player[] {
  return players.map((player) => ({
    id: player.id,
    venueId: player.venueId,
    seat: player.seat,
    name: player.name,
    color: player.color,
    connected: player.connected,
    ...(player.disconnectedAt === undefined
      ? {}
      : { disconnectedAt: player.disconnectedAt }),
  }));
}

export class SessionProgress {
  private readonly id = sessionId();
  private nextRound = 0;
  private version = 0;
  private readonly totals = new Map<string, number>();
  private readonly rounds: RoundRecord[] = [];

  get revision(): number {
    return this.version;
  }

  reserveRoundId(): string {
    const roundId = `${this.id}:${++this.nextRound}`;
    this.reserved.add(roundId);
    return roundId;
  }
  private readonly reserved = new Set<string>();
  releaseRoundId(roundId: string): void {
    this.reserved.delete(roundId);
  }
  open(
    gameId: string,
    playerIds: readonly string[],
    options?: { mode: string; players: Player[]; roundId?: string },
  ): {
    roundId: string;
    complete(outcomes: Outcome[]): Completion;
    abort(): boolean;
  } {
    if (typeof gameId !== 'string' || !gameId.trim())
      throw new Error('A round requires a game ID');
    if (
      !Array.isArray(playerIds) ||
      playerIds.length === 0 ||
      playerIds.some((id) => typeof id !== 'string' || !id.trim()) ||
      new Set(playerIds).size !== playerIds.length
    )
      throw new Error('A round requires unique, non-empty player IDs');
    const roster = [...playerIds];
    const supplied = options?.players;
    if (
      options &&
      (typeof options.mode !== 'string' ||
        !Array.isArray(supplied) ||
        supplied.length !== roster.length ||
        new Set(supplied.map((p) => p.id)).size !== roster.length ||
        supplied.some((p) => !roster.includes(p.id)))
    )
      throw new Error('Round metadata must match its eligible players');
    const players = supplied
      ? reportPlayers(roster.map((id) => supplied.find((p) => p.id === id)!))
      : roster.map((id, seat) => ({
          id,
          venueId: '',
          seat,
          name: id,
          color: '#ffffff',
          connected: true,
        }));
    const mode = options?.mode ?? '';
    const roundId = options?.roundId ?? this.reserveRoundId();
    if (!this.reserved.delete(roundId))
      throw new Error('Unknown or consumed round reservation.');
    let added = false;
    for (const id of roster)
      if (!this.totals.has(id)) {
        this.totals.set(id, 0);
        added = true;
      }
    if (added) this.version++;
    let status: 'open' | 'completed' | 'aborted' = 'open';
    let accepted: Outcome[] = [];
    return {
      roundId,
      complete: (outcomes) => {
        if (status === 'aborted') return 'closed';
        const normalized = normalizeOutcomes(outcomes, roster);
        if (status === 'completed')
          return normalized &&
            JSON.stringify(accepted) === JSON.stringify(normalized)
            ? 'duplicate'
            : 'closed';
        if (!normalized) return 'invalid';
        const awards = Object.fromEntries(
          normalized.map((outcome) => [
            outcome.playerId,
            normalized.filter(
              (opponent) => opponent.placement > outcome.placement,
            ).length,
          ]),
        );
        if (
          Object.entries(awards).some(
            ([id, points]) =>
              !Number.isSafeInteger(this.totals.get(id)! + points),
          )
        )
          return 'invalid';
        accepted = normalized;
        status = 'completed';
        for (const [id, points] of Object.entries(awards))
          this.totals.set(id, this.totals.get(id)! + points);
        this.record({
          roundId,
          gameId,
          mode,
          players,
          status,
          outcomes: accepted,
          awards,
        });
        return 'accepted';
      },
      abort: () => {
        if (status !== 'open') return false;
        status = 'aborted';
        this.record({
          roundId,
          gameId,
          mode,
          players,
          status,
          outcomes: [],
          awards: {},
        });
        return true;
      },
    };
  }

  view(): Progress {
    return {
      revision: this.version,
      totals: Object.fromEntries(this.totals),
      rounds: structuredClone(this.rounds),
    };
  }

  compact(
    playerIds: readonly string[],
    roundId?: string | null,
  ): CompactProgress {
    const round = roundId
      ? this.rounds.find((candidate) => candidate.roundId === roundId)
      : undefined;
    return {
      revision: this.version,
      totals: Object.fromEntries(
        [...new Set(playerIds)].map((id) => [id, this.totals.get(id) ?? 0]),
      ),
      awards: round ? { ...round.awards } : {},
    };
  }

  private record(round: RoundRecord): void {
    this.rounds.push(round);
    if (this.rounds.length > 50) this.rounds.shift();
    this.version++;
  }
}

/** Retain the existing downloaded report fields alongside new round metadata. */
export function completedResults(progress: Progress) {
  return progress.rounds
    .filter((round) => round.status === 'completed')
    .map((round) => ({
      roundId: round.roundId,
      gameId: round.gameId,
      mode: round.mode,
      players: reportPlayers(round.players),
      awards: { ...round.awards },
      results: round.outcomes.map((outcome) => ({
        playerId: outcome.playerId,
        rank: outcome.placement,
        score: outcome.score,
        stats: { ...outcome.stats },
      })),
    }));
}
