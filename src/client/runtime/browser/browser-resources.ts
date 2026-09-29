import type { PresentationEvent } from '../../api/index.ts';
import type {
  BrowserEffects,
  BrowserEnvironment,
  BrowserResourcePort,
} from './contracts.ts';
import { isSound, playSound } from './sounds.ts';

const browserEnvironment: BrowserEnvironment = {
  hidden: () => document.hidden,
  listen: (target, event, listener) => {
    const surface = target === 'document' ? document : window;
    surface.addEventListener(event, listener);
    return () => surface.removeEventListener(event, listener);
  },
  createAudio: () => new AudioContext(),
  requestWake: () =>
    'wakeLock' in navigator ? navigator.wakeLock.request('screen') : null,
};

/** Owns browser handles and listeners; session policy remains in composition. */
export class BrowserResources implements BrowserResourcePort {
  private disposed = false;
  private started = false;
  private pageSuspended = false;
  private audio: AudioContext | null = null;
  private wake: WakeLockSentinel | null = null;
  private wakePending = false;
  private cancels: (() => void)[] = [];
  constructor(
    private readonly effects: BrowserEffects,
    private readonly environment = browserEnvironment,
  ) {}
  get suspended() {
    return this.pageSuspended || this.environment.hidden();
  }
  start() {
    if (this.disposed || this.started) return;
    this.started = true;
    const listen = (
      target: 'document' | 'window',
      event: string,
      listener: EventListener,
    ) => {
      this.cancels.push(
        this.environment.listen(target, event, (e) => {
          if (!this.disposed) listener(e);
        }),
      );
    };
    listen('document', 'visibilitychange', () =>
      this.effects.lifecycle(this.suspended, true),
    );
    listen('window', 'pagehide', () => {
      this.pageSuspended = true;
      this.effects.lifecycle(true, false);
    });
    listen('window', 'pageshow', () => {
      this.pageSuspended = false;
      this.effects.lifecycle(this.suspended, true);
    });
    listen('window', 'beforeunload', (event) => {
      if (this.effects.shouldWarnBeforeUnload()) {
        event.preventDefault();
        // oxlint-disable-next-line typescript/no-deprecated -- legacy Safari beforeunload compatibility
        (event as BeforeUnloadEvent).returnValue = '';
      }
    });
  }
  async unlock() {
    if (this.disposed) return;
    try {
      this.audio ??= this.environment.createAudio();
      await this.audio.resume();
    } catch {
      /* Audio may be unavailable. */
    }
    if (!this.disposed) await this.acquireWake();
  }
  async acquireWake() {
    if (this.disposed || this.suspended || this.wakePending || this.wake)
      return;
    this.wakePending = true;
    try {
      const wake = await this.environment.requestWake();
      if (!wake) return;
      if (this.disposed || this.suspended) {
        await wake.release();
        return;
      }
      this.wake = wake;
      this.effects.wakeChanged(true);
      const released = () => {
        wake.removeEventListener('release', released);
        if (this.wake === wake) {
          this.wake = null;
          if (!this.disposed) this.effects.wakeChanged(false);
        }
      };
      wake.addEventListener('release', released);
    } catch {
      /* Wake lock is optional; keep playback and input running. */
    } finally {
      this.wakePending = false;
    }
  }
  playEvent(event: PresentationEvent) {
    if (this.disposed || !isSound(event.kind)) return;
    if (!this.audio || this.audio.state !== 'running') return;
    try {
      playSound(this.audio, event.kind);
    } catch {
      /* Closed audio context. */
    }
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    for (const cancel of this.cancels.splice(0)) cancel();
    const wake = this.wake;
    this.wake = null;
    if (wake) void wake.release().catch(() => {});
    this.effects.wakeChanged(false);
    if (this.audio && this.audio.state !== 'closed')
      void this.audio.close().catch(() => {});
  }
}
