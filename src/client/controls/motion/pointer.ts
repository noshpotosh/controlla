import { clamp, type Point } from '../../../core/types.ts';
import { AimLedger } from './anchor.ts';
import type { AimReference } from './contracts.ts';

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

/**
 * Telling a hammer swing from aiming: the phone turning faster than `rate`
 * (rad/s, any axis) is the swing or its rebound.
 */
export interface Swing {
  rate: number;
  /** After unlocking, the rebound is over once slower for `calmMs`, or after `maxMs`. */
  calmMs: number;
  maxMs: number;
  /** Locking mid-swing rewinds to before it began, at most this far back (ms). */
  lookbackMs: number;
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
  /** Recent cursor positions, and how fast the phone was turning (rad/s). */
  private history: {
    at: number;
    x: number;
    y: number;
    spin: number;
    /** The ledger's shown turn then, when anchoring. */
    shown?: Point;
  }[] = [];
  /** Ties the cursor to where the phone points; only when anchoring. */
  private ledger: AimLedger | null = null;
  private holdUntil = -Infinity;
  /** Aim locked for a swing: nothing moves the cursor until unlocked. */
  private lock: Swing | null = null;
  /** Just unlocked: the swing's rebound is still ignored. */
  private rebound: {
    swing: Swing;
    until: number;
    calmSince: number | null;
  } | null = null;
  private bounds = FULL_SCREEN;
  gain = DEFAULT_GAIN;

  /**
   * Whether turns the cursor missed are won back from where the phone really
   * points (see `AimLedger`). Off, the cursor moves by turn speed alone.
   */
  get anchoring() {
    return this.ledger !== null;
  }
  set anchoring(on: boolean) {
    if (on !== this.anchoring) this.ledger = on ? new AimLedger() : null;
  }

  /** Turn (rad) the cursor still owes the phone, when anchoring. */
  get drift(): Point | null {
    return this.ledger?.debt ?? null;
  }

  /**
   * @param rate angular velocity in the device frame (rad/s), bias-corrected
   * @param up world-up expressed in the device frame (unit vector)
   * @param dt seconds since the previous motion sample
   * @param at sample time (ms, same clock as `holdForPress`)
   * @param aim where the phone points, for anchoring
   */
  update(
    rate: number[],
    up: number[],
    dt: number,
    at: number,
    aim?: AimReference,
  ): Point {
    const spin = Math.hypot(rate[0], rate[1], rate[2]);
    const following =
      dt > 0 && !this.lock && at >= this.holdUntil && !this.inRebound(spin, at);
    const ledger = this.ledger;
    let shown: Point = { x: 0, y: 0 };
    if (following) {
      const step = this.step(rate, up, dt);
      if (ledger) {
        // Win drift back only inside the player's own motion.
        const extra = ledger.repay(step.turn);
        step.x += extra.x * step.perTurn;
        step.y += extra.y * step.perTurn * GYRO.aspect;
        shown = { x: step.turn.x + extra.x, y: step.turn.y + extra.y };
      }
      this.point = this.inBounds({
        x: this.point.x + step.x,
        y: this.point.y + step.y,
      });
    }
    if (ledger)
      ledger.record(
        aim,
        { x: -this.yawRate(rate, up) * dt, y: -rate[0] * dt },
        shown,
        following,
      );
    this.history.push({
      at,
      ...this.point,
      spin,
      ...(ledger ? { shown: ledger.shown } : {}),
    });
    while (this.history.length && at - this.history[0].at > GYRO.historyMs)
      this.history.shift();
    return { ...this.point };
  }

  /** Turning about world vertical (rad/s), regardless of grip or roll. */
  private yawRate(rate: number[], up: number[]) {
    return rate[0] * up[0] + rate[1] * up[1] + rate[2] * up[2];
  }

  /**
   * How far one sample of turning moves the cursor, the turn (rad) that
   * passed the dead zone, and cursor travel per radian at this speed.
   */
  private step(rate: number[], up: number[], dt: number) {
    // Player space: turning is about world vertical regardless of grip or
    // roll; tilting is about the phone's right edge. Roll is ignored.
    const yaw = this.yawRate(rate, up),
      pitch = rate[0];
    const speed = Math.hypot(yaw, pitch),
      pass = clamp(
        (speed - GYRO.deadzoneStart) / (GYRO.deadzoneFull - GYRO.deadzoneStart),
      ),
      curve = clamp(
        (speed - GYRO.slowSpeed) / (GYRO.fastSpeed - GYRO.slowSpeed),
      ),
      multiplier =
        GYRO.slowMultiplier +
        (GYRO.fastMultiplier - GYRO.slowMultiplier) * curve,
      scale = pass * this.gain * multiplier * dt;
    return {
      x: -yaw * scale,
      y: -pitch * scale * GYRO.aspect,
      turn: { x: -yaw * pass * dt, y: -pitch * pass * dt },
      perTurn: this.gain * multiplier,
    };
  }

  /** Whether this sample is part of a swing's rebound, which never aims. */
  private inRebound(spin: number, at: number) {
    const rebound = this.rebound;
    if (!rebound) return false;
    if (at >= rebound.until) {
      this.rebound = null;
      return false;
    }
    if (spin >= rebound.swing.rate) {
      rebound.calmSince = null;
      return true;
    }
    rebound.calmSince ??= at;
    if (at - rebound.calmSince >= rebound.swing.calmMs) this.rebound = null;
    return false;
  }

  /** Freezes the cursor where it was just before a tap jolted the phone. */
  holdForPress(at: number): Point {
    // A gesture already restored the aim; don't rewind into its own motion.
    if (this.lock || at < this.holdUntil) return { ...this.point };
    return this.holdAt(at - GYRO.pressLookbackMs, at + GYRO.pressHoldMs);
  }

  /** Restores the cursor to where it was at `captureAt` and holds it until `until`. */
  holdAt(captureAt: number, until: number): Point {
    this.point = this.inBounds(this.rewindTo(this.entryAt(captureAt)));
    this.holdUntil = until;
    this.lock = this.rebound = null;
    return { ...this.point };
  }

  /**
   * Locks the aim where the cursor was at `captureAt` for a hammer swing, or
   * from before the swing began if one was already under way then (turning
   * faster than `swing.rate`), so starting to swing as the thumb lands never
   * drags the aim. Nothing moves the cursor until `unlock`.
   */
  lockAt(captureAt: number, swing: Swing): Point {
    let index = -1;
    this.history.forEach((h, i) => {
      if (h.at <= captureAt) index = i;
    });
    while (
      index > 0 &&
      this.history[index].spin >= swing.rate &&
      captureAt - this.history[index - 1].at <= swing.lookbackMs
    )
      index--;
    const from = this.history[index] ?? this.history[0];
    this.point = this.inBounds(from ? this.rewindTo(from) : this.point);
    this.holdUntil = -Infinity;
    this.rebound = null;
    this.lock = swing;
    return { ...this.point };
  }

  /**
   * Lets the cursor move again at once from the locked aim. The swing's
   * rebound keeps being ignored until it dies down; slower aiming counts.
   */
  unlock(at: number): Point {
    const swing = this.lock;
    if (!swing) return { ...this.point };
    this.lock = null;
    this.rebound = { swing, until: at + swing.maxMs, calmSince: null };
    return { ...this.point };
  }

  private entryAt(at: number) {
    let held = this.history[0];
    for (const h of this.history) if (h.at <= at) held = h;
    return held;
  }

  /** Where the cursor was at a history entry; the ledger forgets what it showed since. */
  private rewindTo(entry: (typeof this.history)[number] | undefined): Point {
    if (!entry) return this.point;
    if (entry.shown) this.ledger?.rewind(entry.shown);
    return { x: entry.x, y: entry.y };
  }

  /** Ends any hold or lock now. */
  release(at: number) {
    this.holdUntil = Math.min(this.holdUntil, at);
    this.lock = this.rebound = null;
  }

  /** Retire pre-suspension history while preserving the last displayed aim. */
  resumeAt(point: Point) {
    this.point = this.inBounds(point);
    this.history = [];
    this.ledger?.reset();
    this.holdUntil = -Infinity;
    this.lock = this.rebound = null;
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
