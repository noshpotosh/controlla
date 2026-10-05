/**
 * Raw motion recordings: exactly what the browser reported, before any
 * interpretation, so pointer algorithms can be replayed and tuned offline.
 */

export type Vec3 = [number, number, number];

/** One `devicemotion` event, as reported. */
export interface RawMotionSample {
  /** `event.timeStamp` (ms, same clock as `performance.now()`). */
  t: number;
  /** `performance.now()` when the handler ran; what `Motion.sample` uses. */
  at: number;
  /** `event.interval` (ms) as reported, or null. */
  interval: number | null;
  /** Screen rotation when sampled; absent in older recordings. */
  screenAngle?: number;
  /** `event.acceleration`: the phone's own gravity-removed estimate (m/s²). */
  accel: Vec3 | null;
  /** `event.accelerationIncludingGravity` (m/s²). */
  accelG: Vec3 | null;
  /** `event.rotationRate` in the order reported: [alpha, beta, gamma]. */
  rate: Vec3 | null;
  /** The latest orientation event since the previous sample, if any. */
  orientation?: RawOrientationSample;
}

/** One `deviceorientation` / `deviceorientationabsolute` event, as reported. */
export interface RawOrientationSample {
  t: number;
  at: number;
  /** Euler angles (degrees); `alpha` is north-referenced only when `absolute`. */
  alpha: number | null;
  beta: number | null;
  gamma: number | null;
  absolute: boolean;
  /** iOS `webkitCompassHeading`: degrees clockwise from magnetic north. */
  heading: number | null;
  /** iOS `webkitCompassAccuracy` (degrees); negative means unreliable. */
  accuracy: number | null;
}

/** A labelled stretch of a recording, e.g. "move-right" or "still". */
export interface TraceSegment {
  label: string;
  /** Instruction shown to the player while recording this segment. */
  prompt: string;
  /** Start and end, in sample `t` (ms). */
  start: number;
  end: number;
  /** Screen taps during the segment (ms, same clock as `t`). */
  taps?: number[];
  /** Presses held to lock aim for a swing: [down, up] (ms, same clock as `t`). */
  holds?: [number, number][];
}

export interface MotionTrace {
  version: 1;
  name: string;
  recordedAt: string;
  device: {
    userAgent: string;
    screen: { w: number; h: number; dpr: number };
  };
  samples: RawMotionSample[];
  segments: TraceSegment[];
}

/** Structural subset of `DeviceMotionEvent`, so this stays DOM-free. */
export interface MotionEventLike {
  timeStamp: number;
  interval?: number | null;
  acceleration?: {
    x: number | null;
    y: number | null;
    z: number | null;
  } | null;
  accelerationIncludingGravity?: {
    x: number | null;
    y: number | null;
    z: number | null;
  } | null;
  rotationRate?: {
    alpha: number | null;
    beta: number | null;
    gamma: number | null;
  } | null;
}

/** Structural subset of `DeviceOrientationEvent`, including WebKit's compass. */
export interface OrientationEventLike {
  timeStamp: number;
  alpha?: number | null;
  beta?: number | null;
  gamma?: number | null;
  absolute?: boolean;
  webkitCompassHeading?: number | null;
  webkitCompassAccuracy?: number | null;
}

const finite = (n: unknown): number | null =>
  typeof n === 'number' && Number.isFinite(n) ? n : null;

export function toRawOrientation(
  e: OrientationEventLike,
  at: number,
): RawOrientationSample {
  return {
    t: e.timeStamp,
    at,
    alpha: finite(e.alpha),
    beta: finite(e.beta),
    gamma: finite(e.gamma),
    absolute: e.absolute === true,
    heading: finite(e.webkitCompassHeading),
    accuracy: finite(e.webkitCompassAccuracy),
  };
}

const xyz = (
  v:
    | { x: number | null; y: number | null; z: number | null }
    | null
    | undefined,
): Vec3 | null =>
  v && [v.x, v.y, v.z].every((n) => typeof n === 'number' && Number.isFinite(n))
    ? [v.x!, v.y!, v.z!]
    : null;

export function toRawSample(e: MotionEventLike, at: number): RawMotionSample {
  const r = e.rotationRate;
  return {
    t: e.timeStamp,
    at,
    interval: typeof e.interval === 'number' ? e.interval : null,
    accel: xyz(e.acceleration),
    accelG: xyz(e.accelerationIncludingGravity),
    rate:
      r &&
      [r.alpha!, r.beta!, r.gamma!].every(
        (n) => typeof n === 'number' && Number.isFinite(n),
      )
        ? [r.alpha!, r.beta!, r.gamma!]
        : null,
  };
}

/** Fixed-capacity buffer that keeps the most recent items. */
export class RingBuffer<T> {
  private items: T[] = [];
  private next = 0;

  constructor(readonly capacity: number) {}

  push(item: T) {
    if (this.items.length < this.capacity) this.items.push(item);
    else this.items[this.next] = item;
    this.next = (this.next + 1) % this.capacity;
  }

  /** Oldest first. */
  toArray(): T[] {
    return this.items.length < this.capacity
      ? [...this.items]
      : [...this.items.slice(this.next), ...this.items.slice(0, this.next)];
  }

  clear() {
    this.items = [];
    this.next = 0;
  }

  get size() {
    return this.items.length;
  }
}

/** Minimal shape check for uploaded traces. */
export function isMotionTrace(value: unknown): value is MotionTrace {
  const t = value as MotionTrace;
  return (
    !!t &&
    t.version === 1 &&
    typeof t.name === 'string' &&
    Array.isArray(t.samples) &&
    Array.isArray(t.segments) &&
    t.samples.every(
      (s) => typeof s?.t === 'number' && typeof s?.at === 'number',
    ) &&
    t.segments.every(
      (s) =>
        typeof s?.label === 'string' &&
        typeof s?.start === 'number' &&
        typeof s?.end === 'number',
    )
  );
}
