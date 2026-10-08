import type { PresentationEvent } from '../../api/index.ts';

export interface PlaybackPhaseInput {
  phase?: unknown;
  roundId?: unknown;
  gameId?: unknown;
  mode?: unknown;
  error?: unknown;
}
export interface PlaybackPhase {
  phase: string;
  roundId: string | null;
  gameId: string | null;
  mode: string | null;
  roundError: string | null;
}
export interface PlaybackEffects {
  acknowledge(id: number): void;
  resync(): void;
  venueStats(delay: number): void;
  presented(roundId: string, eventId: string, at: number): void;
  recoveryWarning(active: boolean): void;
  playEvent(event: PresentationEvent, gameId: string): void;
}
