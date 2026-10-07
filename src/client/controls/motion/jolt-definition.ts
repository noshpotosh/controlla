import type { JoltOutput, Rotation } from '../api.ts';
import type { MotionMetadata, Validated } from './registration.ts';
export interface JoltConfig {
  rotation: Rotation;
  triggerG: number;
  rearmG: number;
  fullG: number;
  triggerRate: number;
  rearmRate: number;
  fullRate: number;
  refractoryMs: number;
  calmMs: number;
}
export const JOLT: Readonly<JoltConfig> = Object.freeze({
  rotation: 0,
  triggerG: 0.9,
  rearmG: 0.35,
  fullG: 2.5,
  triggerRate: 3,
  rearmRate: 1.2,
  fullRate: 10,
  refractoryMs: 250,
  calmMs: 60,
});
const record = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);
const within = (v: number, min: number, max: number) =>
  Number.isFinite(v) && v >= min && v <= max;

export function validateJoltConfig(value: unknown): Validated<JoltConfig> {
  if (!record(value))
    return { ok: false, reason: 'Jolt settings must be an object.' };
  const settings = { ...JOLT, ...value } as JoltConfig;
  if (
    Object.keys(value).some((key) => !Object.hasOwn(JOLT, key)) ||
    ![0, 90, 180, 270].includes(settings.rotation) ||
    !within(settings.triggerG, 0.1, 4) ||
    !within(settings.rearmG, Number.MIN_VALUE, settings.triggerG) ||
    settings.rearmG >= settings.triggerG ||
    !within(settings.fullG, settings.triggerG, 8) ||
    !within(settings.triggerRate, 0.1, 20) ||
    !within(settings.rearmRate, Number.MIN_VALUE, settings.triggerRate) ||
    settings.rearmRate >= settings.triggerRate ||
    !within(settings.fullRate, settings.triggerRate, 40) ||
    !Number.isInteger(settings.refractoryMs) ||
    !within(settings.refractoryMs, 100, 1000) ||
    !Number.isInteger(settings.calmMs) ||
    !within(settings.calmMs, 20, 250)
  )
    return {
      ok: false,
      reason: 'Invalid jolt thresholds, rotation or rearm timing.',
    };
  return { ok: true, value: settings };
}

export function parseJolt(value: unknown): JoltOutput | undefined {
  if (!record(value) || !within(value.strength as number, 0, 1))
    return undefined;
  if (
    value.kind === 'translation' &&
    ['left', 'right', 'up', 'down', 'forward', 'back'].includes(
      value.direction as string,
    )
  )
    return {
      kind: 'translation',
      direction: value.direction as Extract<
        JoltOutput,
        { kind: 'translation' }
      >['direction'],
      strength: value.strength as number,
    };
  if (
    value.kind === 'rotation' &&
    ['x', 'y', 'z'].includes(value.axis as string) &&
    (value.sign === -1 || value.sign === 1)
  )
    return {
      kind: 'rotation',
      axis: value.axis as 'x' | 'y' | 'z',
      sign: value.sign,
      strength: value.strength as number,
    };
  return undefined;
}

export const joltMetadata: MotionMetadata<JoltConfig> = {
  type: 'jolt',
  description: 'A directional translation or turn emits an impulse',
  channel: 'both',
  kind: 'impulse',
  throttle: false,
  transport: { motionVector: false, pressSlots: 1 },
  availability: (capabilities) =>
    [capabilities.sensors.accel, capabilities.sensors.gyro].every(
      (sensor) => sensor.present && sensor.permission === 'granted',
    )
      ? { available: true }
      : {
          available: false,
          reason:
            'Directional jolt requires acceleration and gyro motion access.',
        },
  validateConfig: validateJoltConfig,
  parseValue: parseJolt,
  parseActivation: parseJolt,
};
