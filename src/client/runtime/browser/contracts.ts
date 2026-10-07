import type { PresentationEvent, SoundLayer } from '../../api/index.ts';
export interface BrowserEnvironment {
  hidden(): boolean;
  listen(
    target: 'document' | 'window',
    event: string,
    listener: EventListener,
  ): () => void;
  createAudio(): AudioContext;
  requestWake(): Promise<WakeLockSentinel> | null;
  vibrate?(ms: number): void;
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
  pulse(ms: number): void;
  playEvent(
    event: PresentationEvent,
    sounds?: Readonly<Record<string, readonly SoundLayer[]>>,
  ): void;
  dispose(): void;
}
