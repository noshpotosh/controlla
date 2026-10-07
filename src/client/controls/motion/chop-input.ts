import { CHOP, ChopDetector } from './chop.ts';
import type {
  MotionClocks,
  MotionCommand,
  MotionDefinition,
  MotionInputProcessor,
  MotionOutput,
  ValidatedMotionSample,
} from './registration.ts';

/** A held swing emits only semantic outputs; the controls adapter owns aim routing. */
export class ChopProcessor implements MotionInputProcessor<
  Record<string, never>
> {
  private detector = new ChopDetector();
  private held = false;
  private releasedAt: number | null = null;
  private epoch = -1;
  private sequence = -1;
  private at = -Infinity;
  private disposed = false;
  constructor(private readonly clocks: MotionClocks) {}
  configure(config: Readonly<Record<string, never>>) {
    if (this.disposed) return;
    const result = chop.validateConfig(config);
    if (!result.ok) throw new Error(result.reason);
    this.reset('configuration');
  }
  command(command: MotionCommand): readonly MotionOutput[] {
    if (this.disposed || !Number.isFinite(command.at)) return [];
    if (command.type === 'cancel') {
      this.reset('cancel');
      return [
        { type: 'held', down: false },
        { type: 'aim-release', at: command.at, immediate: true },
      ];
    }
    if (command.type === 'recenter' && this.held)
      return [
        { type: 'aim-lock', captureAt: command.at, policy: { ...CHOP.swing } },
      ];
    if (command.type !== 'press' || command.down === this.held) return [];
    this.held = command.down;
    if (command.down) {
      this.releasedAt = null;
      this.detector.reset();
      return [
        { type: 'held', down: true },
        {
          type: 'aim-lock',
          captureAt: command.at - CHOP.touchLookbackMs,
          policy: { ...CHOP.swing },
        },
      ];
    }
    this.releasedAt = command.at;
    return [
      { type: 'held', down: false },
      { type: 'aim-release', at: command.at },
    ];
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
    const outputs: MotionOutput[] = [];
    if (sample.epoch > this.epoch) {
      this.detector.reset();
      this.releasedAt = null;
      this.epoch = sample.epoch;
      this.sequence = -1;
      this.at = -Infinity;
      if (this.held)
        outputs.push({
          type: 'aim-lock',
          captureAt: this.clocks.localTime(),
          policy: { ...CHOP.swing },
        });
    }
    if (sample.sequence <= this.sequence) return outputs;
    this.sequence = sample.sequence;
    const at = sample.at;
    if (
      at === null ||
      !Number.isFinite(at) ||
      at <= this.at ||
      at > this.clocks.localTime() ||
      this.clocks.localTime() - at >= 500 ||
      !sample.pointerFresh ||
      sample.rate.length !== 3 ||
      !sample.rate.every(Number.isFinite) ||
      (sample.accelFresh &&
        (sample.gravity.length !== 3 || !sample.gravity.every(Number.isFinite)))
    )
      return outputs;
    this.at = at;
    const event = this.detector.sample(
      sample.rate,
      sample.accelFresh ? sample.gravity : null,
      at,
    );
    if (
      event &&
      (this.held ||
        (this.releasedAt !== null &&
          at - this.releasedAt <= CHOP.releaseGraceMs &&
          event.onsetAt <= this.releasedAt))
    )
      outputs.push(
        { type: 'haptic', ms: 20 },
        {
          type: 'activation',
          value: event.strength,
          at: event.onsetAt,
          capture: 'locked-aim',
        },
      );
    return outputs;
  }
  reset(_reason: 'epoch' | 'inactive' | 'configuration' | 'cancel') {
    if (this.disposed) return;
    this.held = false;
    this.releasedAt = null;
    this.detector.reset();
    // Keep the sample watermark on cancellation so callbacks cannot replay the last swing.
    if (_reason === 'configuration') {
      this.epoch = this.sequence = -1;
      this.at = -Infinity;
    }
  }
  dispose() {
    this.reset('inactive');
    this.disposed = true;
  }
}
const parse = (value: unknown) =>
  typeof value === 'number' &&
  Number.isFinite(value) &&
  value >= 0 &&
  value <= 1
    ? value
    : undefined;
export const chop: MotionDefinition<Record<string, never>> = {
  type: 'chop',
  channel: 'both',
  kind: 'press',
  throttle: false,
  transport: { motionVector: false, pressSlots: 1 },
  availability: (capabilities) =>
    [capabilities.sensors.accel, capabilities.sensors.gyro].every(
      (sensor) => sensor.present && sensor.permission === 'granted',
    )
      ? { available: true }
      : {
          available: false,
          reason: 'Swing requires acceleration and gyro access.',
        },
  validateConfig: (value) =>
    value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.keys(value).length === 0
      ? { ok: true, value: {} }
      : { ok: false, reason: 'Swing settings must be an empty object.' },
  parseValue: parse,
  parseActivation: parse,
  create: (clocks) => new ChopProcessor(clocks),
};
