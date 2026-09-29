import { clamp, type Point } from '../../../core/types.ts';

/** The part of the screen a pointer stays inside, in normalized coordinates. */
export interface PointerBounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}
export const FULL_SCREEN: PointerBounds = {
  left: 0,
  top: 0,
  right: 1,
  bottom: 1,
};
/** Accepts sane bounds at least a tenth of the screen in each direction. */
export function pointerBounds(value: unknown): PointerBounds {
  if (!value || typeof value !== 'object') return FULL_SCREEN;
  const { left, top, right, bottom } = value as Record<string, unknown>;
  const edges = [left, top, right, bottom];
  if (!edges.every((v) => typeof v === 'number' && Number.isFinite(v)))
    return FULL_SCREEN;
  const [l, t, r, b] = (edges as number[]).map((v) => clamp(v));
  return r - l >= 0.1 && b - t >= 0.1
    ? { left: l, top: t, right: r, bottom: b }
    : FULL_SCREEN;
}

/** How a hold ends once the motion that caused it has died down. */
export interface Settle {
  /** Calm means turning slower than this (rad/s, any axis)... */
  rate: number;
  /** ...for this long (ms). */
  calmMs: number;
  /** The hold lasts at least `minMs` and at most `maxMs` from when settling starts. */
  minMs: number;
  maxMs: number;
}

// Screen widths per radian of turn at a curve multiplier of 1. Playtests found
// 1.9 too twitchy for aiming at small targets; players can still raise it.
export const DEFAULT_GAIN = 1.35,
  MIN_GAIN = 0.6,
  MAX_GAIN = 6;
export const clampGain = (gain: number) =>
  Number.isFinite(gain) ? clamp(gain, MIN_GAIN, MAX_GAIN) : DEFAULT_GAIN;

const DEG = Math.PI / 180;
/** Tuning for mouse-style gyro pointing; adjust from playtests. */
export const GYRO = {
  // Soft dead zone: below `deadzoneStart` nothing moves, full speed from `deadzoneFull`.
  deadzoneStart: 0.6 * DEG,
  deadzoneFull: 2 * DEG,
  // Acceleration curve: `slowMultiplier` at or below `slowSpeed`, `fastMultiplier` at or above `fastSpeed`.
  slowSpeed: 5 * DEG,
  fastSpeed: 60 * DEG,
  slowMultiplier: 0.7,
  fastMultiplier: 1.6,
  // A tap jolts the phone: aim at where the cursor was `pressLookbackMs` earlier, then hold it.
  pressLookbackMs: 50,
  pressHoldMs: 120,
  // Long enough to rewind past a hammer swing to where the player was aiming.
  historyMs: 600,
  // The canonical play area is 16:9; equal turn angles cover equal pixels on both axes.
  aspect: 16 / 9,
};

/**
 * Relative ("air mouse") pointing: the cursor moves by how fast the phone
 * turns, not where it is aimed, and stops at the screen edges. Pushing past an
 * edge re-anchors it, so orientation drift never accumulates into an offset.
 */
export class GyroPointer {
  private point: Point = { x: 0.5, y: 0.5 };
  private history: { at: number; x: number; y: number }[] = [];
  private holdUntil = -Infinity;
  /** A settling hold ends early once calm, but not before this. */
  private settleAfter: number | null = null;
  private settle: Settle | null = null;
  private calmSince: number | null = null;
  private bounds = FULL_SCREEN;
  gain = DEFAULT_GAIN;

  /**
   * @param rate angular velocity in the device frame (rad/s), bias-corrected
   * @param up world-up expressed in the device frame (unit vector)
   * @param dt seconds since the previous motion sample
   * @param at sample time (ms, same clock as `holdForPress`)
   */
  update(rate: number[], up: number[], dt: number, at: number): Point {
    if (!this.held(rate, at) && dt > 0) {
      // Player space: turning is about world vertical regardless of grip or
      // roll; tilting is about the phone's right edge. Roll is ignored.
      let yaw = rate[0] * up[0] + rate[1] * up[1] + rate[2] * up[2],
        pitch = rate[0];
      const speed = Math.hypot(yaw, pitch),
        pass = clamp(
          (speed - GYRO.deadzoneStart) /
            (GYRO.deadzoneFull - GYRO.deadzoneStart),
        ),
        curve = clamp(
          (speed - GYRO.slowSpeed) / (GYRO.fastSpeed - GYRO.slowSpeed),
        ),
        multiplier =
          GYRO.slowMultiplier +
          (GYRO.fastMultiplier - GYRO.slowMultiplier) * curve;
      yaw *= pass;
      pitch *= pass;
      this.point = this.inBounds({
        x: this.point.x - yaw * this.gain * multiplier * dt,
        y: this.point.y - pitch * this.gain * GYRO.aspect * multiplier * dt,
      });
    }
    this.history.push({ at, ...this.point });
    while (this.history.length && at - this.history[0].at > GYRO.historyMs)
      this.history.shift();
    return { ...this.point };
  }

  /** Whether the aim is frozen for this sample; a settling hold ends once calm. */
  private held(rate: number[], at: number) {
    if (at >= this.holdUntil) return false;
    if (Math.hypot(rate[0], rate[1], rate[2]) < (this.settle?.rate ?? 0))
      this.calmSince ??= at;
    else this.calmSince = null;
    if (
      this.settle &&
      this.settleAfter !== null &&
      at >= this.settleAfter &&
      this.calmSince !== null &&
      at - this.calmSince >= this.settle.calmMs
    ) {
      this.release(at);
      return false;
    }
    return true;
  }

  /** Freezes the cursor where it was just before a tap jolted the phone. */
  holdForPress(at: number): Point {
    // A gesture already restored the aim; don't rewind into its own motion.
    if (at < this.holdUntil) return { ...this.point };
    return this.holdAt(at - GYRO.pressLookbackMs, at + GYRO.pressHoldMs);
  }

  /** Restores the cursor to where it was at `captureAt` and holds it until `until`. */
  holdAt(captureAt: number, until: number): Point {
    let held = this.history[0] ?? { at: captureAt, ...this.point };
    for (const h of this.history) if (h.at <= captureAt) held = h;
    this.point = this.inBounds(held);
    this.holdUntil = until;
    this.settleAfter = this.settle = this.calmSince = null;
    return { ...this.point };
  }

  /**
   * Keeps a hold going only until the phone calms down, e.g. from a thumb
   * lifting off or a swing's rebound, so neither drags the aim away.
   */
  settleFrom(at: number, settle: Settle) {
    if (at >= this.holdUntil) return;
    this.holdUntil = Math.min(this.holdUntil, at + settle.maxMs);
    this.settleAfter = at + settle.minMs;
    this.settle = settle;
    this.calmSince = null;
  }

  /** Ends a hold now. */
  release(at: number) {
    this.holdUntil = Math.min(this.holdUntil, at);
    this.settleAfter = this.settle = this.calmSince = null;
  }

  /** Retire pre-suspension history while preserving the last displayed aim. */
  resumeAt(point: Point) {
    this.point = this.inBounds(point);
    this.history = [];
    this.holdUntil = -Infinity;
    this.settleAfter = this.settle = this.calmSince = null;
  }

  recenter() {
    const { left, top, right, bottom } = this.bounds;
    this.resumeAt({ x: (left + right) / 2, y: (top + bottom) / 2 });
  }

  /**
   * Keeps the cursor inside part of the screen, such as a game's play field,
   * so overshooting never wanders off it and pushing past its edge re-anchors.
   */
  setBounds(bounds: PointerBounds) {
    this.bounds = pointerBounds(bounds);
    this.point = this.inBounds(this.point);
  }

  private inBounds(point: Point): Point {
    const { left, top, right, bottom } = this.bounds;
    return {
      x: clamp(point.x, left, right),
      y: clamp(point.y, top, bottom),
    };
  }

  get current(): Point {
    return { ...this.point };
  }
}

/** Time-based filtering in normalized screen coordinates. */
export class PointerSmoother {
  private point: Point | null = null;
  private raw: Point | null = null;
  private at = 0;
  private velocity: Point = { x: 0, y: 0 };

  constructor(private readonly adaptive = true) {}

  reset() {
    this.point = this.raw = null;
    this.velocity = { x: 0, y: 0 };
    this.at = 0;
  }

  sample(input: Point, at: number): Point {
    if (
      !Number.isFinite(input.x) ||
      !Number.isFinite(input.y) ||
      !Number.isFinite(at)
    )
      return { ...(this.point ?? { x: 0.5, y: 0.5 }) };
    if (!this.point || !this.raw || at - this.at > 250) {
      this.point = { ...input };
      this.raw = { ...input };
      this.at = at;
      this.velocity = { x: 0, y: 0 };
      return { ...this.point };
    }
    if (at <= this.at) return { ...this.point };
    const dt = (at - this.at) / 1000;
    const velocityAlpha = 1 - Math.exp(-dt / 0.04);
    // Filter signed velocity so alternating tremor does not look like a sweep.
    this.velocity.x +=
      ((input.x - this.raw.x) / dt - this.velocity.x) * velocityAlpha;
    this.velocity.y +=
      ((input.y - this.raw.y) / dt - this.velocity.y) * velocityAlpha;
    const speed = Math.hypot(this.velocity.x, this.velocity.y);
    // Suppress hand tremor at rest; open up quickly for deliberate aiming.
    // Display-only gliding has a fixed 12 ms time constant and never overshoots.
    const tau = this.adaptive ? 0.008 + 0.037 / (1 + 8 * speed) : 0.012;
    const alpha = 1 - Math.exp(-dt / tau);
    this.point = {
      x: this.point.x + alpha * (input.x - this.point.x),
      y: this.point.y + alpha * (input.y - this.point.y),
    };
    this.raw = { ...input };
    this.at = at;
    return { ...this.point };
  }
}
