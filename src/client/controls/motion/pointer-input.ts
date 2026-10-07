import {
  pointerMetadata,
  validatePointerConfig,
  type PointerConfig,
} from './pointer-definition.ts';
export {
  validatePointerConfig,
  type PointerConfig,
} from './pointer-definition.ts';
import { clampGain, GyroPointer, PointerSmoother } from './pointer.ts';
import type {
  MotionClocks,
  MotionCommand,
  MotionDefinition,
  MotionInputProcessor,
  MotionOutput,
  ValidatedMotionSample,
} from './registration.ts';

export class PointerProcessor implements MotionInputProcessor<PointerConfig> {
  private pointer = new GyroPointer();
  private smoother = new PointerSmoother();
  private point = this.pointer.current;
  private epoch = -1;
  private sequence = -1;
  private at: number | null = null;
  private disposed = false;
  private confidence = 1;
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
    return [
      {
        type: 'value',
        value: { ...this.point },
        confidence: this.confidence,
        at,
      },
    ];
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
    this.confidence = sample.confidence;
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
export const pointer: MotionDefinition<PointerConfig> = {
  ...pointerMetadata,
  create: (clocks) => new PointerProcessor(clocks),
};
