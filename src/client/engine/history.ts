import type { Player, Progress, RoundRecord } from '../api/index.ts';
import type { Message } from './messages.ts';
import { dataRecord, normalizeOutcomes, reportPlayers } from './progress.ts';

/** Leave room below the signaling server's 64 KiB WebSocket limit. */
export const MAX_MESSAGE_BYTES = 48 * 1024;
export const MAX_PROGRESS_BYTES = 4 * 1024 * 1024;
const CHUNK_CHARACTERS = 8192;
const MAX_BATCHES = 1024;
const utf8 = new TextEncoder();
const identityAllowance = 'x'.repeat(64);

/** Measure the actual JSON relay envelope, including both routing IDs. */
export function messageFits(
  message: unknown,
  from = identityAllowance,
  to = identityAllowance,
  channel = 'ctrl',
): boolean {
  try {
    const serialized = JSON.stringify({
      type: 'relay',
      from,
      to,
      channel,
      data: message,
      binary: false,
    });
    return utf8.encode(serialized).byteLength <= MAX_MESSAGE_BYTES;
  } catch {
    return false;
  }
}

function text(
  value: unknown,
  limit: number,
  allowEmpty = false,
): value is string {
  return (
    typeof value === 'string' &&
    value.length <= limit &&
    (allowEmpty || value.length > 0)
  );
}
function nonnegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}
function player(value: unknown): value is Player {
  if (!dataRecord(value)) return false;
  return (
    text(value.id, 256) &&
    text(value.venueId, 256, true) &&
    text(value.name, 256, true) &&
    text(value.color, 64) &&
    nonnegativeInteger(value.seat) &&
    value.seat < 8 &&
    typeof value.connected === 'boolean' &&
    (value.disconnectedAt === undefined ||
      (typeof value.disconnectedAt === 'number' &&
        Number.isFinite(value.disconnectedAt)))
  );
}

/** Validate reports before allocation into the durable client-side ledger. */
function normalizeProgress(value: unknown, revision: number): Progress | null {
  if (
    !dataRecord(value) ||
    value.revision !== revision ||
    !dataRecord(value.totals) ||
    !Array.isArray(value.rounds) ||
    value.rounds.length > 50
  )
    return null;
  const totalsEntries = Object.entries(value.totals);
  if (
    totalsEntries.length > 100000 ||
    totalsEntries.some(
      ([id, total]) => !text(id, 256) || !nonnegativeInteger(total),
    )
  )
    return null;
  const totals = Object.fromEntries(totalsEntries) as Record<string, number>;
  const rounds: RoundRecord[] = [];
  const roundIds = new Set<string>();
  for (const source of value.rounds) {
    if (
      !dataRecord(source) ||
      !text(source.roundId, 256) ||
      roundIds.has(source.roundId) ||
      !text(source.gameId, 128) ||
      !text(source.mode, 128, true) ||
      !Array.isArray(source.players) ||
      source.players.length < 1 ||
      source.players.length > 8 ||
      !source.players.every(player) ||
      !Array.isArray(source.outcomes) ||
      !dataRecord(source.awards) ||
      (source.status !== 'completed' && source.status !== 'aborted')
    )
      return null;
    const players = reportPlayers(source.players);
    const ids = players.map((p) => p.id);
    if (
      new Set(ids).size !== ids.length ||
      ids.some((id) => !Object.hasOwn(totals, id))
    )
      return null;
    const outcomes =
      source.status === 'completed'
        ? normalizeOutcomes(source.outcomes, ids)
        : [];
    if (!outcomes || (source.status === 'aborted' && source.outcomes.length))
      return null;
    const awards =
      source.status === 'completed'
        ? Object.fromEntries(
            outcomes.map((outcome) => [
              outcome.playerId,
              outcomes.filter((other) => other.placement > outcome.placement)
                .length,
            ]),
          )
        : {};
    const suppliedAwards = source.awards;
    if (
      Object.keys(suppliedAwards).length !== Object.keys(awards).length ||
      Object.entries(awards).some(
        ([id, award]) =>
          !Object.hasOwn(suppliedAwards, id) ||
          suppliedAwards[id] !== award ||
          totals[id] < award,
      )
    )
      return null;
    rounds.push({
      roundId: source.roundId,
      gameId: source.gameId,
      mode: source.mode,
      players,
      status: source.status,
      outcomes,
      awards,
    });
    roundIds.add(source.roundId);
  }
  return { revision, totals, rounds };
}

/** Internal transport fragmentation; callers still send one complete ledger view. */
export function historyMessages(progress: Progress): Message[] {
  const normalized = nonnegativeInteger(progress.revision)
    ? normalizeProgress(progress, progress.revision)
    : null;
  if (!normalized) throw new Error('Cannot transfer invalid progress');
  const serialized = JSON.stringify(normalized);
  if (utf8.encode(serialized).byteLength > MAX_PROGRESS_BYTES)
    throw new Error('Session report exceeds the history transfer limit');
  const count = Math.ceil(serialized.length / CHUNK_CHARACTERS);
  if (count > MAX_BATCHES)
    throw new Error('Session report has too many history batches');
  return Array.from({ length: count }, (_, index) => {
    const message: Message = {
      type: 'progressBatch',
      revision: progress.revision,
      index,
      count,
      payload: serialized.slice(
        index * CHUNK_CHARACTERS,
        (index + 1) * CHUNK_CHARACTERS,
      ),
    };
    if (!messageFits(message))
      throw new Error('Session report batch exceeds the transport limit');
    return message;
  });
}

interface Pending {
  count: number;
  bytes: number;
  chunks: Map<number, string>;
}

/** Partial or reordered hydration never replaces the last complete report. */
export class ProgressAssembler {
  private current: Progress | null = null;
  private readonly pending = new Map<number, Pending>();

  view(): Progress | null {
    return this.current ? structuredClone(this.current) : null;
  }

  receive(message: unknown): Progress | null {
    if (
      !dataRecord(message) ||
      message.type !== 'progressBatch' ||
      !nonnegativeInteger(message.revision) ||
      !nonnegativeInteger(message.index) ||
      !nonnegativeInteger(message.count) ||
      message.count < 1 ||
      message.count > MAX_BATCHES ||
      message.index >= message.count ||
      typeof message.payload !== 'string' ||
      message.payload.length === 0 ||
      message.payload.length > CHUNK_CHARACTERS ||
      !messageFits(message)
    )
      return null;
    const { revision, index, count, payload } = message;
    if (this.current && revision <= this.current.revision) return null;
    let pending = this.pending.get(revision);
    if (pending && pending.count !== count) {
      this.pending.delete(revision);
      return null;
    }
    if (!pending) {
      pending = { count, bytes: 0, chunks: new Map() };
      this.pending.set(revision, pending);
      if (this.pending.size > 2) {
        const oldest = Math.min(...this.pending.keys());
        this.pending.delete(oldest);
        if (oldest === revision) return null;
      }
    }
    const previous = pending.chunks.get(index);
    if (previous !== undefined) {
      if (previous !== payload) this.pending.delete(revision);
      return null;
    }
    pending.bytes += utf8.encode(payload).byteLength;
    if (pending.bytes > MAX_PROGRESS_BYTES) {
      this.pending.delete(revision);
      return null;
    }
    pending.chunks.set(index, payload);
    if (pending.chunks.size !== count) return null;
    this.pending.delete(revision);
    try {
      const serialized = Array.from({ length: count }, (_, i) =>
        pending.chunks.get(i)!,
      ).join('');
      const progress = normalizeProgress(JSON.parse(serialized), revision);
      if (!progress) return null;
      this.current = progress;
      for (const version of this.pending.keys())
        if (version <= revision) this.pending.delete(version);
      return structuredClone(progress);
    } catch {
      return null;
    }
  }
}
