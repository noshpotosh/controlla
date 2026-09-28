export const ARBITRATION_MS = 200;

/** Shared bounded arbitration window. Timestamp ordering remains game-owned. */
export function partitionMatureActions<T extends { time: number }>(
  actions: readonly T[],
  time: number,
): { mature: T[]; pending: T[] } {
  return {
    mature: actions.filter((action) => action.time <= time - ARBITRATION_MS),
    pending: actions.filter((action) => action.time > time - ARBITRATION_MS),
  };
}
