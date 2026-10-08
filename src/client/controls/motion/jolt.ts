import {
  JOLT,
  validateJoltConfig,
  joltMetadata,
  type JoltConfig,
} from './jolt-definition.ts';
export {
  JOLT,
  validateJoltConfig,
  parseJolt,
  type JoltConfig,
} from './jolt-definition.ts';
import type { JoltOutput, Rotation } from '../api.ts';
import type {
  MotionClocks,
  MotionCommand,
  MotionDefinition,
  MotionInputProcessor,
  MotionOutput,
  ValidatedMotionSample,
  Vec3,
} from './registration.ts';

const G = 9.81;
const finiteVector = (v: readonly number[]): v is Vec3 =>
  v.length === 3 && v.every(Number.isFinite);
/** Device Y points up. Controller Y points down; angular rates are axial vectors. */
export function controllerVector(
  vector: Vec3,
  rotation: Rotation,
  axial = false,
): Vec3 {
  const [x, y, z] = axial
    ? [-vector[0], vector[1], -vector[2]]
    : [vector[0], -vector[1], vector[2]];
  switch (rotation) {
    case 90:
      return [-y, x, z];
    case 180:
      return [-x, -y, z];
    case 270:
      return [y, -x, z];
    default:
      return [x, y, z];
  }
}

/** Deterministic directional impulse detector; no browser or transport effects. */
export class JoltProcessor implements MotionInputProcessor<JoltConfig> {
  private config: JoltConfig = { ...JOLT };
  private disposed = false;
  private epoch = -1;
  private sequence = -1;
  private at: number | null = null;
  private gravity: Vec3 | null = null;
  private gravitySince: number | null = null;
  private calmSince: number | null = null;
  private armed = false;
  private firedAt = -Infinity;
  constructor(private readonly clocks: MotionClocks) {}
  configure(config: Readonly<JoltConfig>): void {
    if (this.disposed) return;
    const validated = validateJoltConfig(config);
    if (!validated.ok) throw new Error(validated.reason);
    this.config = validated.value;
    this.reset('configuration');
  }
  reset(_reason: 'epoch' | 'inactive' | 'configuration' | 'cancel'): void {
    if (this.disposed) return;
    this.epoch = this.sequence = -1;
    this.at = this.gravitySince = this.calmSince = null;
    this.gravity = null;
    this.armed = false;
    this.firedAt = -Infinity;
  }
  command(command: MotionCommand): readonly MotionOutput[] {
    if (command.type === 'cancel') this.reset('cancel');
    return [];
  }
  dispose(): void {
    if (this.disposed) return;
    this.reset('inactive');
    this.disposed = true;
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
    if (sample.epoch !== this.epoch) {
      this.reset('epoch');
      this.epoch = sample.epoch;
    }
    const at = sample.at;
    if (
      sample.sequence <= this.sequence ||
      (at !== null && this.at !== null && at <= this.at)
    )
      return [];
    this.sequence = sample.sequence;
    if (
      at === null ||
      !Number.isFinite(at) ||
      at > this.clocks.localTime() ||
      this.clocks.localTime() - at >= 500 ||
      !sample.pointerFresh ||
      !sample.accelFresh ||
      !finiteVector(sample.rate) ||
      !finiteVector(sample.gravity) ||
      (sample.linearAcceleration !== null &&
        !finiteVector(sample.linearAcceleration))
    ) {
      this.reset('inactive');
      this.epoch = sample.epoch;
      this.sequence = sample.sequence;
      return [];
    }
    if (this.at !== null && at - this.at > 500) {
      this.reset('inactive');
      this.epoch = sample.epoch;
      this.sequence = sample.sequence;
    }
    const dt = this.at === null ? 0 : at - this.at;
    this.at = at;
    const rawGravity = sample.gravity as Vec3;
    const rate = controllerVector(
      sample.rate as Vec3,
      this.config.rotation,
      true,
    );
    const quietRate = rate.every((v) => Math.abs(v) < this.config.rearmRate);
    const gravityCalm =
      quietRate &&
      Math.abs(Math.hypot(...rawGravity) - G) < 0.5 &&
      (sample.linearAcceleration === null ||
        sample.linearAcceleration.every(
          (v) => Math.abs(v) < this.config.rearmG * G,
        ));
    if (gravityCalm) {
      this.gravitySince ??= at;
      if (!this.gravity) this.gravity = [...rawGravity];
      const alpha = 1 - Math.exp(-dt / 500);
      this.gravity = this.gravity.map(
        (v, i) => v + (rawGravity[i] - v) * alpha,
      ) as unknown as Vec3;
    } else if (
      !this.gravity ||
      this.gravitySince === null ||
      at - this.gravitySince < 200
    ) {
      this.gravitySince = null;
      this.gravity = null;
    }
    const linear =
      sample.linearAcceleration ??
      (this.gravity &&
      this.gravitySince !== null &&
      at - this.gravitySince >= 200
        ? (rawGravity.map((v, i) => v - this.gravity![i]) as unknown as Vec3)
        : null);
    const acceleration = linear
      ? controllerVector(linear, this.config.rotation)
      : null;
    const calm =
      quietRate &&
      (acceleration
        ? acceleration.every((v) => Math.abs(v) < this.config.rearmG * G)
        : gravityCalm);
    if (calm) this.calmSince ??= at;
    else this.calmSince = null;
    if (
      !this.armed &&
      at - this.firedAt >= this.config.refractoryMs &&
      this.calmSince !== null &&
      at - this.calmSince >= this.config.calmMs
    )
      this.armed = true;
    if (!this.armed) return [];
    // Strict > preserves translation-before-rotation and X/Y/Z tie order.
    let candidate: {
      kind: 'translation' | 'rotation';
      axis: number;
      component: number;
      ratio: number;
    } | null = null;
    for (const [kind, vector, threshold] of [
      ['translation', acceleration, this.config.triggerG * G],
      ['rotation', rate, this.config.triggerRate],
    ] as const) {
      if (!vector) continue;
      vector.forEach((component, axis) => {
        const ratio = Math.abs(component) / threshold;
        if (ratio >= 1 && (!candidate || ratio > candidate.ratio))
          candidate = { kind, axis, component, ratio };
      });
    }
    const winning = candidate as {
      kind: 'translation' | 'rotation';
      axis: number;
      component: number;
      ratio: number;
    } | null;
    if (!winning) return [];
    this.armed = false;
    this.calmSince = null;
    this.firedAt = at;
    const strength = Math.min(
      1,
      Math.abs(winning.component) /
        (winning.kind === 'translation'
          ? this.config.fullG * G
          : this.config.fullRate),
    );
    const value: JoltOutput =
      winning.kind === 'translation'
        ? {
            kind: 'translation',
            direction: (winning.component > 0
              ? ['right', 'down', 'back']
              : ['left', 'up', 'forward'])[winning.axis] as Extract<
              JoltOutput,
              { kind: 'translation' }
            >['direction'],
            strength,
          }
        : {
            kind: 'rotation',
            axis: (['x', 'y', 'z'] as const)[winning.axis],
            sign: winning.component > 0 ? 1 : -1,
            strength,
          };
    return [{ type: 'activation', value, at }];
  }
}

export const jolt: MotionDefinition<JoltConfig> = {
  ...joltMetadata,
  create: (clocks) => new JoltProcessor(clocks),
};
