import type { Press, WidgetValueMessage } from '../../engine/reliable-input.ts';

export interface InputEnvironment {
  localTime(): number;
  authorityTime(): number;
  /** Schedule asynchronously; return cancellation. Retired callbacks are guarded too. */
  schedule(callback: () => void, delay: number): () => void;
}
export interface InputEffects {
  frame(data: ArrayBuffer): void;
  reliable(
    message:
      | WidgetValueMessage
      | { type: 'press'; press: Omit<Press, 'playerId'> },
  ): void;
  haptic(ms: number): void;
  settingsChanged?(values: Readonly<Record<string, number>>): void;
}
