import type { MotionMetadata, Validated } from './registration.ts';
interface PointerBounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}
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
    value: {
      bounds: {
        ...(value.bounds === undefined
          ? { left: 0, top: 0, right: 1, bottom: 1 }
          : (value.bounds as unknown as PointerBounds)),
      },
      anchor,
      rateHz,
    },
  };
}
const parse = (value: unknown) =>
  record(value) &&
  typeof value.x === 'number' &&
  typeof value.y === 'number' &&
  Number.isFinite(value.x) &&
  Number.isFinite(value.y)
    ? { x: value.x, y: value.y }
    : undefined;
export const pointerMetadata: MotionMetadata<PointerConfig> = {
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
};
