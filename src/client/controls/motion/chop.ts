/** Tuning for the downward hammer swing; adjust from recorded traces. Rates in rad/s. */
export const CHOP = {
  // The swing starts once the phone tips down this fast...
  onsetRate: 1.5,
  // ...and counts as a chop when it passes this rate within `windupMs`.
  fireRate: 4.5,
  windupMs: 300,
  // Strength reaches 1 at this rate.
  fullRate: 12,
  // No second chop until this long has passed and the downswing has ended.
  refractoryMs: 250,
  // Aim comes from just before the swing began.
  captureLeadMs: 30,
  // The cursor stays put until the phone has been calm for `settleMs`, at most `maxHoldMs`.
  settleRate: 1,
  settleMs: 60,
  minHoldMs: 120,
  maxHoldMs: 700,
};

export interface ChopEvent {
  /** Sample time the chop was recognised (ms, the motion sample clock). */
  at: number;
  /** When the downswing began; aim is captured just before this. */
  onsetAt: number;
  /** 0–1 by how hard the phone was swung. */
  strength: number;
}

/**
 * How fast the phone tips down, in rad/s (negative is down). This is rotation
 * about the phone's right edge levelled to the horizon, so it reads the same
 * whether the phone is held flat like a remote or upright like a hammer handle,
 * and tolerates a rolled wrist.
 *
 * @param rate angular velocity in the device frame (rad/s), bias-corrected
 * @param up world-up expressed in the device frame (unit vector)
 */
export function chopRate(rate: readonly number[], up: readonly number[]) {
  const axis = [1 - up[0] * up[0], -up[0] * up[1], -up[0] * up[2]],
    length = Math.hypot(axis[0], axis[1], axis[2]);
  // With the right edge pointing straight up there is no level axis; use the raw pitch.
  if (length < 0.3) return rate[0];
  return (rate[0] * axis[0] + rate[1] * axis[1] + rate[2] * axis[2]) / length;
}

/**
 * Recognises a quick downward swing, like bringing a hammer down. Pure: fed one
 * motion sample at a time by the phone, or by replay in tests.
 */
export class ChopDetector {
  private onsetAt: number | null = null;
  private firedAt = -Infinity;
  private armed = true;
  private calmSince: number | null = null;

  reset() {
    this.onsetAt = null;
    this.firedAt = -Infinity;
    this.armed = true;
    this.calmSince = null;
  }

  sample(
    rate: readonly number[],
    up: readonly number[],
    at: number,
  ): ChopEvent | null {
    const down = -chopRate(rate, up),
      speed = Math.hypot(rate[0], rate[1], rate[2]);
    if (speed < CHOP.settleRate) this.calmSince ??= at;
    else this.calmSince = null;
    if (!this.armed) {
      // The rebound and any wobble after a chop never count as another one.
      if (at - this.firedAt < CHOP.refractoryMs || down >= CHOP.onsetRate)
        return null;
      this.armed = true;
      this.onsetAt = null;
    }
    if (down < CHOP.onsetRate) {
      this.onsetAt = null;
      return null;
    }
    this.onsetAt ??= at;
    // A slow, deliberate downward aim that later speeds up is not a swing.
    if (down < CHOP.fireRate || at - this.onsetAt > CHOP.windupMs) return null;
    this.armed = false;
    this.firedAt = at;
    this.calmSince = null;
    return {
      at,
      onsetAt: this.onsetAt,
      strength: Math.min(1, Math.max(0, down / CHOP.fullRate)),
    };
  }

  /** Whether the swing has settled, so a cursor held for it can move again. */
  settled(at: number) {
    const since = at - this.firedAt;
    return (
      since >= CHOP.maxHoldMs ||
      (since >= CHOP.minHoldMs &&
        this.calmSince !== null &&
        at - this.calmSince >= CHOP.settleMs)
    );
  }
}
