import type { Point } from './types.ts';

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
