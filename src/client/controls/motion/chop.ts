import type { Swing } from './pointer.ts';

/**
 * Tuning for the hammer swing; adjust from recorded traces. A swing only counts
 * while the player holds the on-screen button, which also freezes their aim, so
 * detection can be forgiving: any sharp spin or jolt in any direction.
 */
export const CHOP = {
  // A swing starts once the phone spins this fast (rad/s) or jolts this hard (g)...
  onsetRate: 1.2,
  onsetJolt: 0.35,
  // ...and counts as a whack at this spin or jolt.
  fireRate: 3,
  fireJolt: 0.9,
  // A swing is dated no earlier than this before it is recognised.
  maxWindupMs: 150,
  // Strength reaches 1 at this spin or jolt.
  fullRate: 10,
  fullJolt: 2.5,
  // No second whack until this long has passed, and then only once the phone
  // has calmed or swung back the other way and turned around again, so
  // repeated whacks count without the follow-through counting too.
  refractoryMs: 250,
  // Aim comes from where the big screen showed the cursor when the thumb
  // pressed: about 50 ms back clears the press's own jolt, and about 50 more
  // covers the cursor's trip to the screen.
  touchLookbackMs: 100,
  // A swing already under way when the button is let go still counts if it
  // is recognised this soon after.
  releaseGraceMs: 150,
  // While the aim is locked, and while a swing's rebound lasts after letting
  // go, turning faster than 1.5 rad/s (86°/s) is the swing and never aims;
  // slower turning is the player aiming and always counts. Recorded aiming
  // mostly stays under that, and whacks peak at 5–25 rad/s.
  swing: {
    rate: 1.5,
    calmMs: 60,
    maxMs: 400,
  } satisfies Swing,
  // A whack is never dated more than this before it is sent.
  maxBackdateMs: 400,
};

export interface ChopEvent {
  /** Sample time the swing was recognised (ms, the motion sample clock). */
  at: number;
  /** When the swing began; the whack is dated to this moment. */
  onsetAt: number;
  /** 0–1 by how hard the phone was swung. */
  strength: number;
}

const G = 9.81;

/**
 * Recognises a sharp swing of the phone. Pure: fed one motion sample at a time
 * by the phone, or by replay in tests.
 */
export class ChopDetector {
  private onsetAt: number | null = null;
  private firedAt = -Infinity;
  private armed = true;
  /** Spin axis of the last whack (unit), or null when it was a jolt. */
  private firedAxis: number[] | null = null;
  private swungBack = false;

  reset() {
    this.onsetAt = null;
    this.firedAt = -Infinity;
    this.armed = true;
    this.firedAxis = null;
    this.swungBack = false;
  }

  /**
   * @param rate angular velocity in the device frame (rad/s), bias-corrected
   * @param gravity acceleration including gravity (m/s²), or null when stale
   * @param at sample time (ms)
   */
  sample(
    rate: readonly number[],
    gravity: readonly number[] | null,
    at: number,
  ): ChopEvent | null {
    const spin = Math.hypot(rate[0], rate[1], rate[2]),
      jolt = gravity
        ? Math.abs(Math.hypot(gravity[0], gravity[1], gravity[2]) - G) / G
        : 0;
    const moving = spin >= CHOP.onsetRate || jolt >= CHOP.onsetJolt;
    if (!this.armed) {
      // Spin along the last whack's direction: negative on the way back up.
      const along = this.firedAxis
        ? rate[0] * this.firedAxis[0] +
          rate[1] * this.firedAxis[1] +
          rate[2] * this.firedAxis[2]
        : 0;
      if (along <= -CHOP.onsetRate) this.swungBack = true;
      // The follow-through and rebound never count as another whack.
      if (
        at - this.firedAt < CHOP.refractoryMs ||
        (moving && !(this.swungBack && along >= 0))
      )
        return null;
      this.armed = true;
    }
    if (!moving) {
      this.onsetAt = null;
      return null;
    }
    this.onsetAt ??= at;
    if (spin < CHOP.fireRate && jolt < CHOP.fireJolt) return null;
    this.armed = false;
    this.firedAt = at;
    this.firedAxis =
      spin >= CHOP.onsetRate ? rate.map((component) => component / spin) : null;
    this.swungBack = false;
    const onsetAt = Math.max(this.onsetAt, at - CHOP.maxWindupMs);
    this.onsetAt = null;
    return {
      at,
      onsetAt,
      strength: Math.min(
        1,
        Math.max(spin / CHOP.fullRate, jolt / CHOP.fullJolt),
      ),
    };
  }
}
