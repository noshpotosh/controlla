import {
  axisAngle,
  multiply,
  normalize,
  rotate,
  identity,
} from '../core/calibration.ts';
import type { Capabilities, Quaternion } from '../core/types.ts';
import { defaultCapabilities } from '../core/config.ts';
interface PermissionConstructor {
  requestPermission?: () => Promise<'granted' | 'denied'>;
}
export class Motion {
  q: Quaternion = [...identity];
  rate = [0, 0, 0];
  gravity = [0, 0, 0];
  bias = [0, 0, 0];
  lastAt = 0;
  observed = 0;
  stationary = 0;
  private startedAt = 0;
  private listener: ((event: DeviceMotionEvent) => void) | null = null;
  capabilities = defaultCapabilities();
  constructor() {
    const present = typeof DeviceMotionEvent !== 'undefined';
    this.capabilities = {
      ...this.capabilities,
      maxTouchPoints: navigator.maxTouchPoints || 1,
      vibration: 'vibrate' in navigator,
      devicePixelRatio: window.devicePixelRatio || 1,
      viewport: { w: innerWidth, h: innerHeight },
      sensors: {
        gyro: { present, permission: present ? 'prompt' : 'unavailable' },
        accel: { present, permission: present ? 'prompt' : 'unavailable' },
      },
    };
  }
  async enable() {
    const D = globalThis.DeviceMotionEvent as unknown as
      | PermissionConstructor
      | undefined;
    let permission: Capabilities['sensors']['gyro']['permission'] =
      'unavailable';
    if (D) {
      try {
        permission = D.requestPermission
          ? await D.requestPermission()
          : 'granted';
      } catch {
        permission = 'denied';
      }
    }
    this.capabilities = {
      ...this.capabilities,
      maxTouchPoints: navigator.maxTouchPoints,
      vibration: 'vibrate' in navigator,
      devicePixelRatio: devicePixelRatio,
      viewport: { w: innerWidth, h: innerHeight },
      sensors: {
        gyro: { present: !!D, permission },
        accel: { present: !!D, permission },
      },
    };
    if (permission === 'granted') this.start();
    return this.capabilities;
  }
  start() {
    if (
      this.listener ||
      this.capabilities.sensors.gyro.permission !== 'granted'
    )
      return;
    this.lastAt = 0;
    this.startedAt = performance.now();
    this.observed = 0;
    this.listener = (e) => this.sample(e);
    window.addEventListener('devicemotion', this.listener);
  }
  stop() {
    if (this.listener)
      window.removeEventListener('devicemotion', this.listener);
    this.listener = null;
    this.lastAt = 0;
  }
  sample(e: DeviceMotionEvent) {
    const time = performance.now(),
      dt = this.lastAt ? Math.min(0.05, (time - this.lastAt) / 1000) : 0;
    this.lastAt = time;
    this.observed++;
    const g = e.accelerationIncludingGravity,
      r = e.rotationRate;
    if (!g || g.x === null || g.y === null || g.z === null) {
      this.capabilities.sensors.accel.present = false;
      return;
    }
    this.capabilities.sensors.accel.present = true;
    this.gravity = [g.x, g.y, g.z];
    if (!r || r.alpha === null || r.beta === null || r.gamma === null) {
      this.capabilities.sensors.gyro.present = false;
      return;
    }
    this.capabilities.sensors.gyro.present = true;
    const raw = [r.beta, r.gamma, r.alpha].map((v) => (v * Math.PI) / 180),
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
    // Correct gravity in the world frame, preserving unobservable heading (no compass).
    if (mag > 7 && mag < 12) {
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
        error = Math.asin(Math.min(1, Math.hypot(...cross)));
      if (error > 1e-8)
        this.q = multiply(
          axisAngle(cross[0], cross[1], cross[2], error * Math.min(1, dt * 2)),
          this.q,
        );
    }
    this.q = normalize(this.q);
  }
  get rateHz() {
    return (
      this.observed /
      Math.max(0.001, (performance.now() - this.startedAt) / 1000)
    );
  }
  get confidence() {
    return this.lastAt
      ? Math.max(0, 1 - (performance.now() - this.lastAt) / 500)
      : 0;
  }
  get tilt() {
    return {
      x: Math.max(-1, Math.min(1, this.gravity[0] / 6)),
      y: Math.max(-1, Math.min(1, this.gravity[1] / 6)),
    };
  }
}
