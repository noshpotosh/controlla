import type { Progress, ReadonlyDeep, RoundProgress } from './api/index.ts';

/** Preserve nonparticipants' known totals without revealing a future ledger revision. */
export function standingsForPresentation(
  progress: ReadonlyDeep<Pick<Progress, 'revision' | 'totals'>>,
  sampled: ReadonlyDeep<RoundProgress> | null,
  phase: string,
): Readonly<Record<string, number>> {
  const ledgerIsVisible = sampled
    ? progress.revision <= sampled.revision
    : phase === 'lobby';
  return Object.freeze({
    ...(ledgerIsVisible ? progress.totals : {}),
    ...sampled?.totals,
  });
}
