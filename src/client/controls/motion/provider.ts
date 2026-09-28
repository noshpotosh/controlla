import type { Capabilities, Permission } from '../api.ts';
import type { MotionSnapshot, MotionStatus } from './contracts.ts';
import { MotionProcessor } from './processor.ts';
import {
  RingBuffer,
  toRawSample,
  type MotionEventLike,
  type RawMotionSample,
} from './trace.ts';

export const INITIAL_SAMPLE_MS = 1800;
export const FRESH_SAMPLE_MS = 500;
export const STOPPED_SAMPLE_MS = 2000;
/** Browser effects are injectable; processing and lifecycle use one monotonic clock. */
export interface MotionEnvironment {
  now(): number;
  supported(): boolean;
  requestPermission(): Promise<Permission>;
  capabilities(): Capabilities;
  listen(listener: (event: MotionEventLike) => void): () => void;
  schedule(callback: () => void, delay: number): () => void;
}
function browserEnvironment(): MotionEnvironment {
  return {
    now: () => performance.now(),
    supported: () => typeof DeviceMotionEvent !== 'undefined',
    requestPermission: async () => {
      const constructor = globalThis.DeviceMotionEvent as unknown as
        | { requestPermission?: () => Promise<Permission> }
        | undefined;
      return constructor
        ? constructor.requestPermission
          ? constructor.requestPermission()
          : 'granted'
        : 'unavailable';
    },
    capabilities: () => ({
      sensors: {
        gyro: { present: false, permission: 'unavailable' },
        accel: { present: false, permission: 'unavailable' },
      },
      maxTouchPoints: navigator.maxTouchPoints || 1,
      vibration: 'vibrate' in navigator,
      refreshRateHz: 60,
      devicePixelRatio: window.devicePixelRatio || 1,
      safeAreaInsets: { top: 0, bottom: 0, left: 0, right: 0 },
      viewport: { w: innerWidth, h: innerHeight },
    }),
    listen: (listener) => {
      const receive = (event: DeviceMotionEvent) => listener(event);
      window.addEventListener('devicemotion', receive);
      return () => window.removeEventListener('devicemotion', receive);
    },
    schedule: (callback, delay) => {
      const timer = setTimeout(callback, delay);
      return () => clearTimeout(timer);
    },
  };
}
function freeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.freeze(value);
    for (const child of Object.values(value)) freeze(child);
  }
  return value;
}
/** One owner for permission, sampling, suspension, availability and observation. */
export class Motion {
  private readonly processor = new MotionProcessor();
  private readonly samples = new RingBuffer<RawMotionSample>(6000);
  private sampleListeners = new Set<(sample: RawMotionSample) => void>();
  private listeners = new Set<() => void>();
  private permission: Permission;
  private suspended = false;
  private disposed = false;
  private pending: Promise<void> | null = null;
  private unlisten: (() => void) | null = null;
  private cancelTimer: (() => void) | null = null;
  private lifetime = 0;
  private startedAt = 0;
  private observed = 0;
  private accelAt: number | null = null;
  private gyroAt: number | null = null;
  private accelPresent = false;
  private gyroPresent = false;
  private sequence = 0;
  private epoch = 0;
  private lastKey = '';
  constructor(private readonly env: MotionEnvironment = browserEnvironment()) {
    this.permission = env.supported() ? 'prompt' : 'unavailable';
  }
  get capabilities(): Capabilities {
    const value = this.env.capabilities();
    value.sensors = {
      gyro: { present: this.gyroPresent, permission: this.permission },
      accel: { present: this.accelPresent, permission: this.permission },
    };
    return value;
  }
  private get status(): MotionStatus {
    if (this.disposed) return 'disposed';
    if (this.suspended) return 'suspended';
    if (this.pending) return 'requesting';
    if (this.permission === 'prompt') return 'prompt';
    if (this.permission !== 'granted') return 'unavailable';
    if (this.accelPresent || this.gyroPresent) return 'active';
    return this.unlisten && this.env.now() - this.startedAt < INITIAL_SAMPLE_MS
      ? 'waiting'
      : 'unavailable';
  }
  getSnapshot(): MotionSnapshot {
    const time = this.env.now();
    const accelFresh =
      !!this.unlisten &&
      this.accelPresent &&
      this.accelAt !== null &&
      time - this.accelAt < FRESH_SAMPLE_MS;
    const pointerFresh =
      accelFresh &&
      this.gyroPresent &&
      this.gyroAt !== null &&
      time - this.gyroAt < FRESH_SAMPLE_MS;
    return freeze({
      status: this.status,
      permission: this.permission,
      capabilities: this.capabilities,
      epoch: this.epoch,
      sequence: this.sequence,
      at: this.accelAt,
      accelFresh,
      pointerFresh,
      confidence: pointerFresh
        ? Math.max(
            0,
            1 -
              (time - Math.min(this.accelAt!, this.gyroAt!)) / FRESH_SAMPLE_MS,
          )
        : 0,
      rateHz: this.unlisten
        ? this.observed / Math.max(0.001, (time - this.startedAt) / 1000)
        : 0,
      rate: [...this.processor.rate],
      gravity: [...this.processor.gravity],
      up: this.processor.up,
      tilt: this.processor.tilt,
    });
  }
  get rateHz() {
    return this.getSnapshot().rateHz;
  }
  subscribe(listener: () => void) {
    if (!this.disposed) this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  private notify() {
    const key = `${this.status}:${this.permission}:${this.accelPresent}:${this.gyroPresent}`;
    if (key === this.lastKey) return;
    this.lastKey = key;
    for (const listener of this.listeners) listener();
  }
  enable(): Promise<void> {
    if (this.disposed) return Promise.resolve();
    if (this.pending) return this.pending;
    if (this.permission === 'granted') {
      this.start();
      return Promise.resolve();
    }
    // Invoke permission synchronously in the caller's user gesture.
    let request: Promise<Permission>;
    try {
      request = this.env.requestPermission();
    } catch {
      request = Promise.resolve('denied');
    }
    this.pending = Promise.resolve(request)
      .catch(() => 'denied' as const)
      .then((permission) => {
        if (this.disposed) return;
        this.permission = permission;
      })
      .finally(() => {
        this.pending = null;
        if (!this.disposed) {
          this.start();
          this.notify();
        }
      });
    this.notify();
    return this.pending;
  }
  /** Diagnostics/configuration may request sampling, but cannot override lifecycle. */
  start() {
    if (
      this.disposed ||
      this.suspended ||
      this.unlisten ||
      this.permission !== 'granted'
    )
      return;
    this.startedAt = this.env.now();
    this.observed = 0;
    const lifetime = ++this.lifetime;
    this.unlisten = this.env.listen((event) => {
      if (lifetime !== this.lifetime || this.disposed || this.suspended) return;
      this.sample(event);
    });
    this.schedule();
    this.notify();
  }
  suspend() {
    if (this.disposed || this.suspended) return;
    this.suspended = true;
    this.detach();
    this.notify();
  }
  resume() {
    if (this.disposed) return;
    this.suspended = false;
    this.start();
    this.notify();
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.detach();
    this.notify();
    this.listeners.clear();
    this.sampleListeners.clear();
  }
  private detach() {
    ++this.lifetime;
    this.unlisten?.();
    this.unlisten = null;
    this.cancelTimer?.();
    this.cancelTimer = null;
    this.accelAt = this.gyroAt = null;
    this.accelPresent = this.gyroPresent = false;
    this.processor.resetTiming();
    ++this.epoch;
  }
  private schedule() {
    this.cancelTimer?.();
    this.cancelTimer = null;
    if (!this.unlisten) return;
    const time = this.env.now();
    const deadlines = [
      this.startedAt + INITIAL_SAMPLE_MS,
      ...(this.accelPresent && this.accelAt !== null
        ? [this.accelAt + STOPPED_SAMPLE_MS]
        : []),
      ...(this.gyroPresent && this.gyroAt !== null
        ? [this.gyroAt + STOPPED_SAMPLE_MS]
        : []),
    ].filter((at) => at > time);
    if (!deadlines.length) return;
    const lifetime = this.lifetime;
    this.cancelTimer = this.env.schedule(
      () => {
        if (lifetime !== this.lifetime || !this.unlisten) return;
        const now = this.env.now();
        if (this.accelAt !== null && now - this.accelAt >= STOPPED_SAMPLE_MS)
          this.accelPresent = false;
        if (this.gyroAt !== null && now - this.gyroAt >= STOPPED_SAMPLE_MS)
          this.gyroPresent = false;
        this.notify();
        this.schedule();
      },
      Math.min(...deadlines) - time,
    );
  }
  private sample(event: MotionEventLike) {
    const time = this.env.now();
    const sample = toRawSample(event, time);
    if (
      this.accelAt === null ||
      this.gyroAt === null ||
      time - Math.min(this.accelAt, this.gyroAt) >= FRESH_SAMPLE_MS
    ) {
      this.processor.resetTiming();
      ++this.epoch;
    }
    this.accelPresent = sample.accelG !== null;
    this.gyroPresent = sample.rate !== null;
    this.accelAt = this.accelPresent ? time : null;
    this.gyroAt = this.gyroPresent ? time : null;
    this.processor.sample(sample);
    ++this.sequence;
    ++this.observed;
    this.samples.push(freeze(sample));
    this.schedule();
    this.notify();
    for (const listener of this.sampleListeners) {
      try {
        listener(structuredClone(sample));
      } catch {
        /* Observers cannot interrupt input. */
      }
    }
  }
  onSample(listener: (sample: RawMotionSample) => void) {
    if (!this.disposed) this.sampleListeners.add(listener);
    return () => {
      this.sampleListeners.delete(listener);
    };
  }
  recentSamples() {
    return structuredClone(this.samples.toArray());
  }
}
