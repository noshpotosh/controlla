/** Map Controlla's signed, screen-aligned tilt.x to GameCube analog steering. */
export class MotionSteering {
  center = 0;
  value = 0;
  constructor({ sensitivity = 1.6, deadzone = 0.06, smoothingMs = 35 } = {}) {
    if (!Number.isFinite(sensitivity) || sensitivity <= 0 || !Number.isFinite(deadzone) || deadzone < 0 || deadzone >= 1 || !Number.isFinite(smoothingMs) || smoothingMs < 0)
      throw new Error('Invalid motion steering settings.');
    Object.assign(this, { sensitivity, deadzone, smoothingMs });
  }
  recenter(tilt) {
    if (!Number.isFinite(tilt)) throw new Error('A current motion sample is required to recenter.');
    this.center = Math.max(-1, Math.min(1, tilt));
    this.value = 0;
  }
  reset() { this.value = 0; }
  sample(tilt, dtMs, { connected = true, sampleAgeMs = 0 } = {}) {
    if (!connected || !Number.isFinite(tilt) || !Number.isFinite(sampleAgeMs) || sampleAgeMs < 0 || sampleAgeMs > 250) {
      this.reset();
      return 128;
    }
    if (!Number.isFinite(dtMs) || dtMs < 0) throw new Error('Invalid motion sample interval.');
    const relative = (Math.max(-1, Math.min(1, tilt)) - this.center) * this.sensitivity;
    const magnitude = Math.min(1, Math.max(0, (Math.abs(relative) - this.deadzone) / (1 - this.deadzone)));
    const target = Math.sign(relative) * magnitude;
    const alpha = this.smoothingMs ? 1 - Math.exp(-Math.min(dtMs, 100) / this.smoothingMs) : 1;
    this.value += (target - this.value) * alpha;
    return Math.round(128 + this.value * (this.value < 0 ? 128 : 127));
  }
}
