export const ARBITRATION_MS = 200;

/** A game's own window, bounded by the shared one that settling relies on. */
export const arbitrationWindow = (requested?: number) =>
  requested !== undefined && Number.isFinite(requested)
    ? Math.min(ARBITRATION_MS, Math.max(0, requested))
    : ARBITRATION_MS;

/** Shared bounded arbitration window. Timestamp ordering remains game-owned. */
export function partitionMatureActions<T extends { time: number }>(
  actions: readonly T[],
  time: number,
  window = ARBITRATION_MS,
): { mature: T[]; pending: T[] } {
  return {
    mature: actions.filter((action) => action.time <= time - window),
    pending: actions.filter((action) => action.time > time - window),
  };
}
