import type { PresentationEvent } from '../../api/index.ts';
export interface BrowserEnvironment {
  hidden(): boolean;
  listen(
    target: 'document' | 'window',
    event: string,
    listener: EventListener,
  ): () => void;
  createAudio(): AudioContext;
  requestWake(): Promise<WakeLockSentinel> | null;
}
export interface BrowserEffects {
  lifecycle(suspended: boolean, warnHost: boolean): void;
  shouldWarnBeforeUnload(): boolean;
  wakeChanged(held: boolean): void;
}
export interface BrowserResourcePort {
  readonly suspended: boolean;
  start(): void;
  unlock(): Promise<void>;
  acquireWake(): Promise<void>;
  playEvent(event: PresentationEvent): void;
  dispose(): void;
}
