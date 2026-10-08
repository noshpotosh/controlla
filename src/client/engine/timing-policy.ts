import type { RoundTiming } from '../api/index.ts';
/** Every presentation policy has a finite authority deadline. */
export function validRoundTiming(value: unknown): value is RoundTiming {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const timing = value as Record<string, unknown>;
  const key =
    timing.kind === 'timed'
      ? 'durationMs'
      : timing.kind === 'untimed'
        ? 'safetyDurationMs'
        : null;
  if (
    !key ||
    Object.keys(timing).some((field) => field !== 'kind' && field !== key)
  )
    return false;
  const duration = timing[key];
  return (
    typeof duration === 'number' &&
    Number.isSafeInteger(duration) &&
    duration > 0 &&
    duration <= 24 * 60 * 60 * 1000
  );
}
export function timingDuration(timing: RoundTiming): number {
  if (!validRoundTiming(timing))
    throw new Error('Invalid round timing policy.');
  return timing.kind === 'timed' ? timing.durationMs : timing.safetyDurationMs;
}
