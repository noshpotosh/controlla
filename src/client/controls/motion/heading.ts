import { wrapAngle } from './calibration.ts';
import type { RawOrientationSample } from './trace.ts';

const DEG = Math.PI / 180;

/**
 * Tuning for holding heading to the compass; adjust from recorded traces. The
 * compass is smoothed and noisy (a few degrees), so it never steers: it only
 * corrects the gyro's heading slowly, the way gravity corrects its tilt.
 */
export const COMPASS = {
  // iOS smooths its heading; compare it with where the gyro had the phone
  // this long before the reading arrived.
  lagMs: 250,
  // Close the gap to the compass over about this long (s)...
  settleSeconds: 3,
  // ...and only while turning slower than this (rad/s), with the top edge
  // closer to level than this (sine of its elevation): steeper, the heading
  // of the top edge is ill-defined.
  maxSpin: 1.5,
  maxElevation: 0.8,
  // Readings iOS rates as worse than this (degrees) are ignored.
  maxAccuracy: 30,
  // A reading this far off is a magnetic disturbance, not drift. If readings
  // keep disagreeing for `realignMs`, the gyro lost track instead: re-align.
  outlier: 20 * DEG,
  realignMs: 2000,
  // With no usable reading for this long, heading is no longer anchored.
  staleMs: 1500,
  historyMs: 1000,
};

/**
 * Compass heading of the phone's top edge (rad, clockwise from magnetic north)
 * from one orientation event, or null when it has none or it is unreliable.
 */
export function compassHeading(sample: RawOrientationSample): number | null {
  if (sample.heading !== null)
    return sample.accuracy !== null && sample.accuracy < 0
      ? null
      : sample.heading * DEG;
  if (!sample.absolute || sample.alpha === null || sample.beta === null)
    return null;
  // Absolute Euler angles (Z-X'-Y'') put the top edge at east −sinα·cosβ,
  // north cosα·cosβ. Nearly vertical, it has no heading.
  const alpha = sample.alpha * DEG,
    cosBeta = Math.cos(sample.beta * DEG);
  if (Math.abs(cosBeta) < 0.2) return null;
  return Math.atan2(-Math.sin(alpha) * cosBeta, Math.cos(alpha) * cosBeta);
}

/** The same heading in degrees (0–360), for people to read, or null. */
export function compassDegrees(sample: RawOrientationSample): number | null {
  const heading = compassHeading(sample);
  return heading === null ? null : (((heading / DEG) % 360) + 360) % 360;
}

/**
 * Holds the gyro's heading to the compass: tracks an offset between the two,
 * compared across the compass's lag and only while the phone turns slowly.
 * Pure: fed by the motion processor, live or in replay.
 */
export class HeadingFilter {
  /** Compass heading minus gyro heading (rad). */
  offset = 0;
  /** Changes whenever the offset jumps rather than settles. */
  epoch = 0;
  private aligned = false;
  private fixAt = -Infinity;
  private lastFixAt: number | null = null;
  private outlierSince: number | null = null;
  private history: { at: number; yaw: number }[] = [];

  reset() {
    this.aligned = false;
    this.fixAt = -Infinity;
    this.lastFixAt = null;
    this.outlierSince = null;
    this.history = [];
  }

  /** Records the gyro's heading of the top edge (rad, clockwise) at `at`. */
  track(at: number, yaw: number) {
    this.history.push({ at, yaw });
    while (this.history.length && at - this.history[0].at > COMPASS.historyMs)
      this.history.shift();
  }

  /**
   * One compass reading (rad, clockwise from north) taken at `at`.
   * @param accuracy degrees as the platform rates it, or null when unrated
   * @param calm the phone is turning slowly enough to trust a correction
   */
  fix(at: number, heading: number, accuracy: number | null, calm: boolean) {
    if (accuracy !== null && accuracy > COMPASS.maxAccuracy) return;
    const past = this.yawAt(at - COMPASS.lagMs);
    if (past === null) return;
    const error = wrapAngle(heading - past - this.offset);
    const dt =
      this.lastFixAt === null
        ? 0
        : Math.min(0.25, Math.max(0, (at - this.lastFixAt) / 1000));
    this.lastFixAt = at;
    if (!this.aligned || Math.abs(error) <= COMPASS.outlier)
      this.outlierSince = null;
    else {
      this.outlierSince ??= at;
      if (at - this.outlierSince < COMPASS.realignMs) return;
    }
    if (!this.aligned || this.outlierSince !== null) {
      // First reading, or the gyro lost track: take the compass as it is.
      this.offset = wrapAngle(this.offset + error);
      this.aligned = true;
      this.outlierSince = null;
      this.epoch++;
    } else if (calm)
      this.offset = wrapAngle(
        this.offset + error * Math.min(1, dt / COMPASS.settleSeconds),
      );
    this.fixAt = at;
  }

  /** Whether heading has been held to the compass recently. */
  anchored(at: number) {
    return this.aligned && at - this.fixAt < COMPASS.staleMs;
  }

  /** The gyro's heading at `at`, or null before tracking reaches back that far. */
  private yawAt(at: number): number | null {
    let found: number | null = null;
    for (const h of this.history) if (h.at <= at) found = h.yaw;
    return found;
  }
}
