import {
  axisAngle,
  inverse,
  multiply,
  normalize,
  rotate,
  identity,
  type Quaternion,
} from './calibration.ts';
import type { RawMotionSample } from './trace.ts';
/** Pure sensor processing, shared by live input and recorded replay. */
export class MotionProcessor {
  q: Quaternion = [...identity];
  rate = [0, 0, 0];
  gravity = [0, 0, 0];
  bias = [0, 0, 0];
  stationary = 0;
  private aligned = false;
  private upSign = 1;
  private lastAt: number | null = null;
  resetTiming() {
    this.lastAt = null;
    this.aligned = false;
    this.stationary = 0;
  }
  sample(sample: RawMotionSample) {
    const time = sample.at;
    const dt =
      this.lastAt === null
        ? 0
        : Math.max(0, Math.min(0.05, (time - this.lastAt) / 1000));
    this.lastAt = time;
    if (!sample.accelG) {
      this.resetTiming();
      return;
    }
    this.gravity = [...sample.accelG];
    if (!sample.rate) {
      this.resetTiming();
      return;
    }
    const [alpha, beta, gamma] = sample.rate;
    const r = { alpha, beta, gamma };
    // DeviceMotion rotationRate uses alpha=X, beta=Y, gamma=Z. The
    // DeviceOrientation Euler-angle order (beta, gamma, alpha) is different.
    // Mixing them turns side-to-side roll into pitch and pitch into yaw.
    // https://www.w3.org/TR/orientation-event/#devicemotioneventrotationrate
    const raw = [r.alpha, r.beta, r.gamma].map((v) => (v * Math.PI) / 180),
      mag = Math.hypot(...this.gravity);
    if (Math.hypot(...raw) < 0.035 && Math.abs(mag - 9.81) < 0.35) {
      this.stationary += dt;
      this.bias = this.bias.map((v, i) => v + (raw[i] - v) * 0.015);
    } else this.stationary = 0;
    this.rate = raw.map((v, i) => v - this.bias[i]);
    const angle = Math.hypot(...this.rate) * dt;
    if (angle)
      this.q = multiply(
        this.q,
        axisAngle(this.rate[0], this.rate[1], this.rate[2], angle),
      );
    // Correct gravity in the world frame, preserving unobservable heading (no
    // compass). Hand jerks and fast turns add acceleration that looks like a
    // tilt, so only trust readings close to 1 g while turning slowly, and
    // correct gently. The first trustworthy reading aligns fully.
    if (Math.abs(mag - 9.81) < 0.5 && Math.hypot(...this.rate) < 1.5) {
      const observed = rotate(
          this.q,
          this.gravity.map((v) => v / mag),
        ),
        expected = [0, 1, 0];
      const cross = [
          observed[1] * expected[2] - observed[2] * expected[1],
          observed[2] * expected[0] - observed[0] * expected[2],
          observed[0] * expected[1] - observed[1] * expected[0],
        ],
        dot =
          observed[0] * expected[0] +
          observed[1] * expected[1] +
          observed[2] * expected[2],
        error = Math.atan2(Math.hypot(...cross), dot);
      if (error > 1e-8)
        this.q = multiply(
          axisAngle(
            cross[0],
            cross[1],
            cross[2],
            this.aligned ? error * Math.min(1, dt / 2) : error,
          ),
          this.q,
        );
      this.aligned = true;
    }
    this.q = normalize(this.q);
  }
  /**
   * World-up in the device frame. Platforms disagree on the sign of
   * `accelerationIncludingGravity`, so orient it toward the screen face, which
   * points up in the remote grip, with hysteresis to avoid flicker near vertical.
   */
  get up() {
    const v = rotate(inverse(this.q), [0, 1, 0]);
    if (v[2] * this.upSign < -0.5) this.upSign = -this.upSign;
    return v.map((c) => c * this.upSign);
  }
  get tilt() {
    return {
      x: Math.max(-1, Math.min(1, this.gravity[0] / 6)),
      y: Math.max(-1, Math.min(1, this.gravity[1] / 6)),
    };
  }
}
