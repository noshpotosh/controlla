import type { PlayerFeedback } from '../api/index.ts';
import { isJsonValue } from './json.ts';
export interface FeedbackState {
  status: string;
  enabled: boolean;
}
export interface FeedbackMessage extends FeedbackState {
  type: 'feedback';
  roundId: string;
  generation: number;
  revision: number;
  hapticMs?: number;
}
const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const status = (value: unknown): value is string =>
  typeof value === 'string' && Array.from(value).length <= 120;
const pulse = (value: unknown): value is number =>
  typeof value === 'number' &&
  Number.isInteger(value) &&
  value > 0 &&
  value <= 100;
export function validFeedback(
  value: unknown,
  players: readonly { id: string }[],
): value is readonly PlayerFeedback[] {
  return (
    Array.isArray(value) &&
    value.length <= 8 &&
    value.length <= players.length &&
    isJsonValue(value, 8 * 1024) &&
    new Set(value.map((item) => (record(item) ? item.playerId : null))).size ===
      value.length &&
    value.every(
      (item) =>
        record(item) &&
        players.some((p) => p.id === item.playerId) &&
        (item.status === undefined || status(item.status)) &&
        (item.enabled === undefined || typeof item.enabled === 'boolean') &&
        (item.hapticMs === undefined || pulse(item.hapticMs)),
    )
  );
}
export function validFeedbackMessage(value: unknown): value is FeedbackMessage {
  return (
    record(value) &&
    isJsonValue(value, 2 * 1024) &&
    value.type === 'feedback' &&
    typeof value.roundId === 'string' &&
    value.roundId.length > 0 &&
    value.roundId.length <= 160 &&
    typeof value.generation === 'number' &&
    Number.isInteger(value.generation) &&
    value.generation >= 0 &&
    value.generation < 65536 &&
    typeof value.revision === 'number' &&
    Number.isSafeInteger(value.revision) &&
    value.revision > 0 &&
    status(value.status) &&
    typeof value.enabled === 'boolean' &&
    (value.hapticMs === undefined || pulse(value.hapticMs))
  );
}
