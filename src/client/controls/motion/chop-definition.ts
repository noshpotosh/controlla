import type { MotionMetadata } from './registration.ts';
const parse = (value: unknown) =>
  typeof value === 'number' &&
  Number.isFinite(value) &&
  value >= 0 &&
  value <= 1
    ? value
    : undefined;
export const chopMetadata: MotionMetadata<Record<string, never>> = {
  type: 'chop',
  description: 'Hold its button to lock aim; a swing counts as a press',
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
};
