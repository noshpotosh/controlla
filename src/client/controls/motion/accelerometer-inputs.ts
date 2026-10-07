/** Pure accelerometer controls. Sensor permission and sampling remain provider-owned. */
import type { Capabilities, Vector } from '../api.ts';
import type {
  Availability,
  MotionClocks,
  MotionCommand,
  MotionDefinition,
  MotionInputProcessor,
  MotionOutput,
  Validated,
  ValidatedMotionSample,
} from './registration.ts';

const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const emptyConfig = (value: unknown): Validated<Record<string, never>> =>
  object(value) && Object.keys(value).length === 0
    ? { ok: true, value: {} }
    : { ok: false, reason: 'Tilt settings must be an empty object.' };
const availability = (capabilities: Readonly<Capabilities>): Availability =>
  capabilities.sensors.accel.present &&
  capabilities.sensors.accel.permission === 'granted'
    ? { available: true }
    : { available: false, reason: 'This input requires acceleration access.' };
const vector = (value: unknown): Vector | undefined =>
  object(value) &&
  typeof value.x === 'number' &&
  typeof value.y === 'number' &&
  Number.isFinite(value.x) &&
  Number.isFinite(value.y) &&
  Math.abs(value.x) <= 1 &&
  Math.abs(value.y) <= 1
    ? { x: value.x, y: value.y }
    : undefined;
const strength = (value: unknown) =>
  typeof value === 'number' &&
  Number.isFinite(value) &&
  value >= 0 &&
  value <= 1
    ? value
    : undefined;
const clamp = (value: number) => Math.max(-1, Math.min(1, value));

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
      return [{ type: 'value', value: { x: 0, y: 0 }, at: now }];
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

export interface ShakeConfig {
  thresholdG: number;
}
export const validateShakeConfig = (value: unknown): Validated<ShakeConfig> => {
  if (!object(value) || Object.keys(value).some((key) => key !== 'thresholdG'))
    return {
      ok: false,
      reason: 'Shake settings must contain only thresholdG.',
    };
  const thresholdG = value.thresholdG ?? 1.8;
  return typeof thresholdG === 'number' &&
    Number.isFinite(thresholdG) &&
    thresholdG > 0 &&
    thresholdG <= 8
    ? { ok: true, value: { thresholdG } }
    : {
        ok: false,
        reason: 'Shake thresholdG must be greater than zero and at most 8.',
      };
};
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
  type: 'tilt',
  channel: 'value',
  kind: 'vector',
  throttle: false,
  transport: { motionVector: true, pressSlots: 0 },
  availability,
  validateConfig: emptyConfig,
  parseValue: vector,
  parseActivation: vector,
  create: (clocks) => new TiltProcessor(clocks),
};
export const shake: MotionDefinition<ShakeConfig> = {
  type: 'shake',
  channel: 'both',
  kind: 'press',
  throttle: false,
  transport: { motionVector: false, pressSlots: 1 },
  availability,
  validateConfig: validateShakeConfig,
  parseValue: strength,
  parseActivation: strength,
  create: (clocks) => new ShakeProcessor(clocks),
};
