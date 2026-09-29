import type { Point } from '../../../core/types.ts';
import { wrapAngle } from './calibration.ts';
import type { AimReference } from './contracts.ts';

const DEG = Math.PI / 180;
/** Tuning for winning back drift; adjust from recorded traces. */
export const ANCHOR = {
  // A step may stretch or shrink by up to this fraction to win drift back...
  repay: 0.25,
  // ...once the phone and cursor disagree by more than this (rad)...
  minDebt: 0.5 * DEG,
  // ...but by more than this, the player has re-gripped on purpose; that
  // mismatch is theirs to Recenter.
  forgive: 45 * DEG,
};

/** One direction of aim, in radians of turn toward the cursor's +x or +y. */
class Axis {
  /** Turn the cursor has shown. */
  shown = 0;
  /** Turn the phone has made, by the best reference available. */
  turned = 0;
  /** Reference and `turned` at the last trusted sample, bridging gaps in it. */
  private mark: { ref: number; turned: number } | null = null;

  constructor(private readonly circular: boolean) {}

  get debt() {
    return this.turned - this.shown;
  }

  /** Extra turn to show with a step that turns `turn`. */
  repay(turn: number) {
    const debt = this.debt;
    if (Math.abs(debt) > ANCHOR.forgive) {
      this.shown = this.turned;
      return 0;
    }
    if (Math.abs(debt) < ANCHOR.minDebt) return 0;
    return (
      Math.sign(debt) * Math.min(Math.abs(debt), ANCHOR.repay * Math.abs(turn))
    );
  }

  /**
   * @param ref where the reference says the phone points, or null when it can't tell
   * @param trusted whether changes in `ref` are real turns of the phone
   * @param fallback this sample's turn to count when the reference can't say
   * @param shown this sample's turn shown by the cursor
   */
  record(
    ref: number | null,
    trusted: boolean,
    fallback: number,
    shown: number,
  ) {
    this.shown += shown;
    if (!trusted) {
      this.turned += fallback;
      this.mark = null;
    } else if (ref === null) this.turned += fallback;
    else {
      this.turned = this.mark
        ? this.mark.turned +
          (this.circular ? wrapAngle(ref - this.mark.ref) : ref - this.mark.ref)
        : this.turned + fallback;
      this.mark = { ref, turned: this.turned };
    }
  }

  forget() {
    this.mark = null;
  }
}

/**
 * Keeps the cursor tied to where the phone really points. It tallies turns
 * the cursor did not show: aim held for a press or locked for a swing, the
 * swing's rebound, turns too slow to pass the dead zone, and gyro drift.
 * The tally is paid back only inside the player's own motion, so a still or
 * locked cursor never moves by itself.
 *
 * Heading comes from the gyro held to the compass, elevation from gravity.
 * Without a compass, only stretches where aim was held count sideways:
 * slow turns can't be told from gyro drift.
 */
export class AimLedger {
  private readonly x = new Axis(true);
  private readonly y = new Axis(false);
  private epoch: number | null = null;

  /** Extra turn (rad) to show with a step that turns `turn` (rad). */
  repay(turn: Point): Point {
    return { x: this.x.repay(turn.x), y: this.y.repay(turn.y) };
  }

  /**
   * After each sample.
   * @param gyro the phone's own turn this sample (rad)
   * @param shown the turn the cursor showed this sample (rad), including repayment
   * @param following whether the cursor followed the phone this sample
   */
  record(
    aim: AimReference | undefined,
    gyro: Point,
    shown: Point,
    following: boolean,
  ) {
    const epoch = aim?.epoch ?? null;
    if (epoch !== this.epoch) {
      this.epoch = epoch;
      this.x.forget();
      this.y.forget();
    }
    const held = !following;
    this.x.record(
      aim?.yaw ?? null,
      !!aim && (aim.anchored || held),
      held ? gyro.x : shown.x,
      shown.x,
    );
    this.y.record(
      aim && aim.pitch !== null ? -aim.pitch : null,
      !!aim,
      held ? gyro.y : shown.y,
      shown.y,
    );
  }

  /** How much turn the cursor still owes the phone (rad). */
  get debt(): Point {
    return { x: this.x.debt, y: this.y.debt };
  }

  /** The cursor's shown turn, to restore when aim is rewound. */
  get shown(): Point {
    return { x: this.x.shown, y: this.y.shown };
  }

  /** The cursor jumped back to where it was when it had shown `shown`. */
  rewind(shown: Point) {
    this.x.shown = shown.x;
    this.y.shown = shown.y;
  }

  reset() {
    this.x.shown = this.x.turned = this.y.shown = this.y.turned = 0;
    this.x.forget();
    this.y.forget();
    this.epoch = null;
  }
}
