/** Pure output validation shared by phone adapters and authoritative ingress. */
import type { WidgetType, SwipeOutput, ControlValue } from './api.ts';
import { motionDefinitionFor } from './motion/metadata-registry.ts';
import { kindOf } from './registry.ts';

const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const finite = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);
const between = (value: unknown, low: number, high: number): value is number =>
  finite(value) && value >= low && value <= high;

/** Canonical, detached output; undefined means malformed or unsupported. */
export function parseControlValue(
  type: WidgetType,
  value: unknown,
): ControlValue | undefined {
  try {
    value = structuredClone(value);
  } catch {
    return undefined;
  }
  const motion = motionDefinitionFor(type);
  if (motion) return motion.parseValue(value);
  switch (kindOf(type)) {
    case 'vector': {
      if (!record(value) || !finite(value.x) || !finite(value.y))
        return undefined;
      // Pointer coordinates may legitimately lie beyond the display edges.
      if (
        type !== 'pointer' &&
        (!between(value.x, -1, 1) || !between(value.y, -1, 1))
      )
        return undefined;
      if (
        type === 'dpad' &&
        (![-1, 0, 1].includes(value.x) || ![-1, 0, 1].includes(value.y))
      )
        return undefined;
      return { x: value.x, y: value.y };
    }
    case 'swipe':
      return record(value) &&
        ['up', 'right', 'down', 'left'].includes(value.dir as string) &&
        finite(value.x) &&
        finite(value.y) &&
        finite(value.distance) &&
        value.distance >= 0 &&
        finite(value.velocity) &&
        value.velocity >= 0
        ? {
            dir: value.dir as SwipeOutput['dir'],
            x: value.x,
            y: value.y,
            distance: value.distance,
            velocity: value.velocity,
          }
        : undefined;
    case 'charge':
      return record(value) &&
        between(value.charge, 0, 1) &&
        typeof value.released === 'boolean'
        ? { charge: value.charge, released: value.released }
        : undefined;
    case 'press':
      // A chop carries its swing strength; a shake is a bare event.
      if (type === 'chop') return between(value, 0, 1) ? value : undefined;
      return type === 'shake' && value === 1 ? 1 : undefined;
    case 'scalar':
      return between(value, 0, 1) ? value : undefined;
    case 'angle':
      return finite(value) ? value : undefined;
    case 'text':
      return typeof value === 'string' && value.length <= 120
        ? value
        : undefined;
    case 'stroke':
      return record(value) &&
        between(value.x, 0, 1) &&
        between(value.y, 0, 1) &&
        between(value.pressure, 0, 1) &&
        value.phase === 'move'
        ? { x: value.x, y: value.y, pressure: value.pressure, phase: 'move' }
        : undefined;
    default:
      return undefined;
  }
}

export function valueFitsEnvelope(value: unknown): boolean {
  try {
    const json = JSON.stringify(structuredClone(value));
    return (
      typeof json === 'string' &&
      new TextEncoder().encode(json).byteLength < 4096
    );
  } catch {
    return false;
  }
}

/** Charge updates become activations only on an actual release. */
export function parseActivationValue(
  type: WidgetType,
  value: unknown,
): ControlValue | undefined {
  const motion = motionDefinitionFor(type);
  if (motion)
    return valueFitsEnvelope(value)
      ? motion.parseActivation(structuredClone(value))
      : undefined;
  const parsed = parseControlValue(type, value);
  if (
    kindOf(type) === 'charge' &&
    (!record(parsed) || !('released' in parsed) || parsed.released !== true)
  )
    return undefined;
  return parsed;
}
