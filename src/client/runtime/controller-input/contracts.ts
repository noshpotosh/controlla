import type { Press, WidgetValueMessage } from '../../engine/reliable-input.ts';

export interface InputEnvironment {
  localTime(): number;
  authorityTime(): number;
  /** Current screen rotation in degrees relative to the device's natural orientation. */
  screenAngle?(): number;
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
}
