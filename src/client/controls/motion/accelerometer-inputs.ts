import {
  tiltMetadata,
  shakeMetadata,
  emptyConfig,
  vector,
  clamp,
  validateShakeConfig,
  type ShakeConfig,
} from './accelerometer-definition.ts';
export {
  validateShakeConfig,
  type ShakeConfig,
} from './accelerometer-definition.ts';
/** Pure accelerometer controls. Sensor permission and sampling remain provider-owned. */
import type { Vector } from '../api.ts';
import type {
  MotionClocks,
  MotionCommand,
  MotionDefinition,
  MotionInputProcessor,
  MotionOutput,
  ValidatedMotionSample,
} from './registration.ts';

/** Reject duplicate/reordered samples while allowing sequence restart in a new epoch. */
class SampleCursor {
  epoch = -1;
  sequence = -1;
  at = -Infinity;
  accept(sample: ValidatedMotionSample, now: number) {
    if (
      !Number.isSafeInteger(sample.epoch) ||
      sample.epoch < 0 ||
      sample.epoch < this.epoch ||
      !Number.isSafeInteger(sample.sequence) ||
      sample.sequence < 0
    )
      return false;
    if (sample.epoch > this.epoch) {
      this.epoch = sample.epoch;
      this.sequence = -1;
      this.at = -Infinity;
    }
    if (sample.sequence <= this.sequence) return false;
    this.sequence = sample.sequence;
    if (
      sample.at === null ||
      !Number.isFinite(sample.at) ||
      sample.at <= this.at ||
      sample.at > now ||
      now - sample.at >= 500
    )
      return false;
    this.at = sample.at;
    return true;
  }
  reset() {
    this.epoch = this.sequence = -1;
    this.at = -Infinity;
  }
}

export class TiltProcessor implements MotionInputProcessor<
  Record<string, never>
> {
  private cursor = new SampleCursor();
  private zero: Vector = { x: 0, y: 0 };
  private last: Vector = { x: 0, y: 0 };
  private disposed = false;
  constructor(private readonly clocks: MotionClocks) {}
  configure(config: Readonly<Record<string, never>>) {
    if (this.disposed) return;
    const result = emptyConfig(config);
    if (!result.ok) throw new Error(result.reason);
    this.reset('configuration');
  }
  process(sample: ValidatedMotionSample): readonly MotionOutput[] {
    if (this.disposed) return [];
    const now = this.clocks.localTime();
    if (!sample.accelFresh || sample.at === null || now - sample.at >= 500)
      return [{ type: 'value', value: { x: 0, y: 0 }, confidence: 0, at: now }];
    if (!this.cursor.accept(sample, now) || !vector(sample.tilt)) return [];
    this.last = { ...sample.tilt };
    return [
      {
        type: 'value',
        value: {
          x: clamp(this.last.x - this.zero.x),
          y: clamp(this.last.y - this.zero.y),
        },
        at: sample.at,
        confidence: 1,
      },
    ];
  }
  command(command: MotionCommand): readonly MotionOutput[] {
    if (this.disposed) return [];
    if (command.type === 'recenter') this.zero = { ...this.last };
    if (command.type === 'cancel') {
      this.reset('cancel');
      return [{ type: 'value', value: { x: 0, y: 0 }, at: command.at }];
    }
    return [];
  }
  reset(reason: 'epoch' | 'inactive' | 'configuration' | 'cancel') {
    if (this.disposed) return;
    if (reason === 'configuration') this.cursor.reset();
  }
  dispose() {
    this.reset('inactive');
    this.disposed = true;
  }
}

export class ShakeProcessor implements MotionInputProcessor<ShakeConfig> {
  private cursor = new SampleCursor();
  private config: ShakeConfig = { thresholdG: 1.8 };
  private firedAt = 0;
  private disposed = false;
  constructor(private readonly clocks: MotionClocks) {}
  configure(config: Readonly<ShakeConfig>) {
    if (this.disposed) return;
    const result = validateShakeConfig(config);
    if (!result.ok) throw new Error(result.reason);
    this.config = result.value;
    this.reset('configuration');
  }
  process(sample: ValidatedMotionSample): readonly MotionOutput[] {
    if (this.disposed) return [];
    const now = this.clocks.localTime();
    if (
      !this.cursor.accept(sample, now) ||
      !sample.accelFresh ||
      sample.gravity.length !== 3 ||
      !sample.gravity.every(Number.isFinite)
    )
      return [];
    if (
      Math.abs(Math.hypot(...sample.gravity) - 9.81) <=
        this.config.thresholdG * 9.81 ||
      now - this.firedAt <= 600
    )
      return [];
    this.firedAt = now;
    // Preserve the existing shake action's recognition time and strict 600ms cooldown.
    return [{ type: 'activation', value: 1, at: now }];
  }
  command(command: MotionCommand): readonly MotionOutput[] {
    if (command.type === 'cancel') this.reset('cancel');
    return [];
  }
  reset(_reason: 'epoch' | 'inactive' | 'configuration' | 'cancel') {
    if (this.disposed) return;
    if (_reason === 'configuration') this.cursor.reset();
  }
  dispose() {
    this.reset('inactive');
    this.disposed = true;
  }
}
export const tilt: MotionDefinition<Record<string, never>> = {
  ...tiltMetadata,
  create: (clocks) => new TiltProcessor(clocks),
};
export const shake: MotionDefinition<ShakeConfig> = {
  ...shakeMetadata,
  create: (clocks) => new ShakeProcessor(clocks),
};
