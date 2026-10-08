import type { Capabilities, Vector } from '../api.ts';
import type {
  Availability,
  MotionMetadata,
  Validated,
} from './registration.ts';
const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
export const emptyConfig = (
  value: unknown,
): Validated<Record<string, never>> =>
  object(value) && Object.keys(value).length === 0
    ? { ok: true, value: {} }
    : { ok: false, reason: 'Tilt settings must be an empty object.' };
const availability = (capabilities: Readonly<Capabilities>): Availability =>
  capabilities.sensors.accel.present &&
  capabilities.sensors.accel.permission === 'granted'
    ? { available: true }
    : { available: false, reason: 'This input requires acceleration access.' };
export const vector = (value: unknown): Vector | undefined =>
  object(value) &&
  typeof value.x === 'number' &&
  typeof value.y === 'number' &&
  Number.isFinite(value.x) &&
  Number.isFinite(value.y) &&
  Math.abs(value.x) <= 1 &&
  Math.abs(value.y) <= 1
    ? { x: value.x, y: value.y }
    : undefined;
const strength = (value: unknown) => (value === 1 ? 1 : undefined);
export const clamp = (value: number) => Math.max(-1, Math.min(1, value));

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
export const tiltMetadata: MotionMetadata<Record<string, never>> = {
  type: 'tilt',
  description: 'Steer by tilting the phone',
  calibration: { recenter: true },
  channel: 'value',
  kind: 'vector',
  throttle: false,
  transport: { motionVector: true, pressSlots: 0 },
  availability,
  validateConfig: emptyConfig,
  parseValue: vector,
  parseActivation: vector,
};
export const shakeMetadata: MotionMetadata<ShakeConfig> = {
  type: 'shake',
  description: 'A shake counts as a press',
  channel: 'both',
  kind: 'press',
  throttle: false,
  transport: { motionVector: false, pressSlots: 1 },
  availability,
  validateConfig: validateShakeConfig,
  parseValue: strength,
  parseActivation: strength,
};
