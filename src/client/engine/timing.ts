export const now = () => performance.now();

export class Samples {
  values: number[] = [];
  constructor(public capacity = 600) {}
  add(value: number) {
    if (Number.isFinite(value)) {
      this.values.push(value);
      if (this.values.length > this.capacity) this.values.shift();
    }
  }
  percentile(p: number) {
    if (!this.values.length) return 0;
    const a = [...this.values].sort((a, b) => a - b);
    return a[Math.min(a.length - 1, Math.ceil(p * a.length) - 1)];
  }
  summary() {
    return {
      count: this.values.length,
      p50: this.percentile(0.5),
      p95: this.percentile(0.95),
      p99: this.percentile(0.99),
      jitter: this.percentile(0.99) - this.percentile(0.5),
    };
  }
}
export class ClockSync {
  offset = 0;
  error = Infinity;
  samples = 0;
  bestRtt = Infinity;
  rtts = new Samples();
  observe(t0: number, t1: number, t2: number, t3: number) {
    const rtt = t3 - t0 - (t2 - t1);
    if (rtt < 0 || rtt > 3000 || ![t0, t1, t2, t3].every(Number.isFinite))
      return;
    const estimate = (t1 - t0 + (t2 - t3)) / 2;
    this.rtts.add(rtt);
    this.samples++;
    if (this.samples <= 10) {
      if (rtt < this.bestRtt) {
        this.bestRtt = rtt;
        this.offset = estimate;
        this.error = rtt / 2;
      }
    } else if (rtt <= this.rtts.percentile(0.5) + 2) {
      this.offset += (estimate - this.offset) * 0.08;
      this.error = rtt / 2;
    }
  }
  time(local: number) {
    return local + this.offset;
  }
}
export class Equalizer {
  current = 0;
  target = 0;
  limitingVenue: string | null = null;
  update(delays: Map<string, Samples>) {
    if (delays.size <= 1) {
      this.target = 0;
      this.limitingVenue = null;
      return;
    }
    let worst = 0;
    for (const [id, samples] of delays) {
      const delay = samples.percentile(0.95);
      if (delay >= worst) {
        worst = delay;
        this.limitingVenue = id;
      }
    }
    // The common timeline includes interpolation lookahead exactly once.
    this.target = worst + 2 * (1000 / 25) + 10;
  }
  tick(dt: number) {
    this.current += Math.max(
      -dt * 0.05,
      Math.min(dt * 0.05, this.target - this.current),
    );
  }
}
export class ContinuousBuffer<
  T extends { time: number; x: number; y: number; vx: number; vy: number },
> {
  frames: T[] = [];
  delays = new Samples(120);
  depth = 0;
  horizon = 0;
  push(frame: T, now: number) {
    this.delays.add(Math.max(0, now - frame.time));
    this.depth = Math.min(20, this.delays.percentile(0.95));
    this.frames.push(frame);
    this.frames = this.frames.slice(-16);
  }
  sample(now: number): T | null {
    if (!this.frames.length) return null;
    const target = now - this.depth;
    const f =
      [...this.frames].reverse().find((f) => f.time <= target) ??
      this.frames[0];
    this.horizon = Math.max(0, Math.min(30, now - f.time));
    return {
      ...f,
      x: f.x + (f.vx * this.horizon) / 1000,
      y: f.y + (f.vy * this.horizon) / 1000,
    };
  }
}
