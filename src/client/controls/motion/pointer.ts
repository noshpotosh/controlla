import { clamp, type Point } from '../../../core/types.ts';

// Screen widths per radian of turn at a curve multiplier of 1.
export const DEFAULT_GAIN = 1.9,
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
  gain = DEFAULT_GAIN;

  /**
   * @param rate angular velocity in the device frame (rad/s), bias-corrected
   * @param up world-up expressed in the device frame (unit vector)
   * @param dt seconds since the previous motion sample
   * @param at sample time (ms, same clock as `holdForPress`)
   */
  update(rate: number[], up: number[], dt: number, at: number): Point {
    if (at >= this.holdUntil && dt > 0) {
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
      this.point = {
        x: clamp(this.point.x - yaw * this.gain * multiplier * dt),
        y: clamp(
          this.point.y - pitch * this.gain * GYRO.aspect * multiplier * dt,
        ),
      };
    }
    this.history.push({ at, ...this.point });
    while (this.history.length && at - this.history[0].at > GYRO.historyMs)
      this.history.shift();
    return { ...this.point };
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
    this.point = { x: held.x, y: held.y };
    this.holdUntil = until;
    return { ...this.point };
  }

  /** Ends a hold early, once the motion that caused it has settled. */
  release(at: number) {
    this.holdUntil = Math.min(this.holdUntil, at);
  }

  /** Retire pre-suspension history while preserving the last displayed aim. */
  resumeAt(point: Point) {
    this.point = { x: clamp(point.x), y: clamp(point.y) };
    this.history = [];
    this.holdUntil = -Infinity;
  }

  recenter() {
    this.resumeAt({ x: 0.5, y: 0.5 });
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
