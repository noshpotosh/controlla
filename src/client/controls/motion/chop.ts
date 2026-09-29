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
  // No second whack until this long has passed and the phone has calmed.
  refractoryMs: 250,
  // Aim comes from just before the thumb pressed the button and jolted the phone.
  touchLookbackMs: 50,
  // Releasing mid-swing keeps the aim still until the phone has been calm for
  // `settleMs` (at least `minHoldMs` after the whack, at most `maxHoldMs`).
  settleRate: 1,
  settleMs: 60,
  minHoldMs: 120,
  maxHoldMs: 700,
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
  private calmSince: number | null = null;

  reset() {
    this.onsetAt = null;
    this.firedAt = -Infinity;
    this.armed = true;
    this.calmSince = null;
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
    if (spin < CHOP.settleRate && jolt < CHOP.onsetJolt) this.calmSince ??= at;
    else this.calmSince = null;
    if (!this.armed) {
      // The follow-through and rebound never count as another whack.
      if (at - this.firedAt < CHOP.refractoryMs || moving) return null;
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
    this.calmSince = null;
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

  /** Whether the phone has settled after the last whack. */
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
