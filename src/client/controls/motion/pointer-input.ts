import {
  clampGain,
  GyroPointer,
  PointerSmoother,
  pointerBounds,
  type PointerBounds,
} from './pointer.ts';
import type {
  MotionClocks,
  MotionCommand,
  MotionDefinition,
  MotionInputProcessor,
  MotionOutput,
  Validated,
  ValidatedMotionSample,
} from './registration.ts';

export interface PointerConfig {
  bounds: PointerBounds;
  anchor: boolean;
  rateHz: number;
}
const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
export function validatePointerConfig(
  value: unknown,
): Validated<PointerConfig> {
  if (
    !record(value) ||
    Object.keys(value).some(
      (key) => !['bounds', 'anchor', 'rateHz'].includes(key),
    )
  )
    return { ok: false, reason: 'Unknown pointer settings.' };
  const rateHz = value.rateHz ?? 60,
    anchor = value.anchor ?? true;
  if (
    typeof rateHz !== 'number' ||
    !Number.isFinite(rateHz) ||
    rateHz < 1 ||
    rateHz > 240 ||
    typeof anchor !== 'boolean'
  )
    return {
      ok: false,
      reason: 'Pointer rateHz must be 1–240 and anchor must be boolean.',
    };
  if (value.bounds !== undefined) {
    if (
      !record(value.bounds) ||
      Object.keys(value.bounds).some(
        (key) => !['left', 'top', 'right', 'bottom'].includes(key),
      )
    )
      return { ok: false, reason: 'Invalid pointer bounds.' };
    const edges = ['left', 'top', 'right', 'bottom'].map(
      (key) => value.bounds && (value.bounds as Record<string, unknown>)[key],
    );
    if (
      !edges.every(
        (edge) =>
          typeof edge === 'number' &&
          Number.isFinite(edge) &&
          edge >= 0 &&
          edge <= 1,
      )
    )
      return {
        ok: false,
        reason: 'Pointer bounds must be finite normalized coordinates.',
      };
    const [left, top, right, bottom] = edges as number[];
    if (right - left < 0.1 || bottom - top < 0.1)
      return {
        ok: false,
        reason: 'Pointer bounds must span at least a tenth of the screen.',
      };
  }
  return {
    ok: true,
    value: { bounds: { ...pointerBounds(value.bounds) }, anchor, rateHz },
  };
}
export class PointerProcessor implements MotionInputProcessor<PointerConfig> {
  private pointer = new GyroPointer();
  private smoother = new PointerSmoother();
  private point = this.pointer.current;
  private epoch = -1;
  private sequence = -1;
  private at: number | null = null;
  private disposed = false;
  constructor(private readonly clocks: MotionClocks) {}
  configure(config: Readonly<PointerConfig>) {
    if (this.disposed) return;
    const result = validatePointerConfig(config);
    if (!result.ok) throw new Error(result.reason);
    this.pointer.setBounds(result.value.bounds);
    this.pointer.anchoring = result.value.anchor;
    this.point = this.pointer.current;
    this.reset('configuration');
  }
  private value(at: number): MotionOutput[] {
    return [{ type: 'value', value: { ...this.point }, at }];
  }
  command(command: MotionCommand): readonly MotionOutput[] {
    if (this.disposed || !Number.isFinite(command.at)) return [];
    switch (command.type) {
      case 'sensitivity':
        this.pointer.gain = clampGain(command.value);
        return [];
      case 'recenter':
        this.pointer.recenter();
        this.point = this.pointer.current;
        break;
      case 'aim-lock':
        this.point = this.pointer.lockAt(command.at, command.policy);
        break;
      case 'aim-release':
        if (command.immediate) this.pointer.release(command.at);
        else this.point = this.pointer.unlock(command.at);
        break;
      case 'press':
        if (!command.down) return [];
        this.point = this.pointer.holdForPress(command.at);
        break;
      case 'cancel':
        this.pointer.release(command.at);
        break;
    }
    this.smoother.reset();
    return this.value(command.at);
  }
  process(sample: ValidatedMotionSample): readonly MotionOutput[] {
    if (
      this.disposed ||
      !Number.isSafeInteger(sample.epoch) ||
      sample.epoch < 0 ||
      sample.epoch < this.epoch ||
      !Number.isSafeInteger(sample.sequence) ||
      sample.sequence < 0
    )
      return [];
    if (sample.epoch > this.epoch) {
      this.pointer.resumeAt(this.point);
      this.smoother.reset();
      this.epoch = sample.epoch;
      this.sequence = -1;
      this.at = null;
    }
    if (sample.sequence <= this.sequence) return [];
    this.sequence = sample.sequence;
    const at = sample.at;
    if (
      !sample.pointerFresh ||
      at === null ||
      !Number.isFinite(at) ||
      at > this.clocks.localTime() ||
      this.clocks.localTime() - at >= 500 ||
      (this.at !== null && at <= this.at) ||
      sample.rate.length !== 3 ||
      !sample.rate.every(Number.isFinite) ||
      sample.up.length !== 3 ||
      !sample.up.every(Number.isFinite)
    )
      return [];
    const dt = this.at === null ? 0 : Math.min(0.05, (at - this.at) / 1000);
    this.at = at;
    this.point = this.smoother.sample(
      this.pointer.update([...sample.rate], [...sample.up], dt, at, sample.aim),
      at,
    );
    return this.value(at);
  }
  reset(reason: 'epoch' | 'inactive' | 'configuration' | 'cancel') {
    if (this.disposed) return;
    this.pointer.resumeAt(this.point);
    this.smoother.reset();
    this.at = null;
    if (reason === 'configuration') this.epoch = this.sequence = -1;
  }
  dispose() {
    this.reset('inactive');
    this.disposed = true;
  }
}
const parse = (value: unknown) =>
  record(value) &&
  typeof value.x === 'number' &&
  typeof value.y === 'number' &&
  Number.isFinite(value.x) &&
  Number.isFinite(value.y) &&
  value.x >= 0 &&
  value.x <= 1 &&
  value.y >= 0 &&
  value.y <= 1
    ? { x: value.x, y: value.y }
    : undefined;
export const pointer: MotionDefinition<PointerConfig> = {
  type: 'pointer',
  channel: 'value',
  kind: 'vector',
  throttle: false,
  transport: { motionVector: true, pressSlots: 0 },
  availability: (capabilities) =>
    [capabilities.sensors.accel, capabilities.sensors.gyro].every(
      (sensor) => sensor.present && sensor.permission === 'granted',
    )
      ? { available: true }
      : {
          available: false,
          reason: 'Pointer requires acceleration and gyro access.',
        },
  validateConfig: validatePointerConfig,
  parseValue: parse,
  parseActivation: parse,
  create: (clocks) => new PointerProcessor(clocks),
};
