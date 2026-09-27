import type {
  Capabilities,
  ControllerConfig,
  Manifest,
  WidgetType,
} from './types.ts';
import { defaultLayout, resolveLayout } from '../controls/layouts.ts';
import { PRESS_SLOTS, usesPressSlot } from '../controls/registry.ts';
export const labManifest: Manifest = {
  id: 'latency-lab',
  name: 'Latency Lab',
  players: { min: 2, max: 8 },
  inputs: {
    aim: { required: true, prefer: 'pointer', fallback: 'stick', label: 'Aim' },
    fire: {
      required: true,
      prefer: 'button',
      label: 'Fire',
      props: { icon: 'fire' },
    },
  },
  layout: 'stack',
  expectedDurationSec: 30,
  scoring: 'time',
  onPlayerDropped: 'freeze',
  retroactiveInput: false,
  interpolatable: ['cursors', 'target'],
  discrete: ['scores', 'phase', 'targetAt', 'promptId', 'results'],
};
export const raceManifest: Manifest = {
  id: 'tilt-rally',
  name: 'Tilt Rally',
  players: { min: 2, max: 8 },
  inputs: {
    steer: {
      required: true,
      prefer: 'tilt',
      fallback: 'stick',
      label: 'Steer',
    },
    boost: {
      required: true,
      prefer: 'swipe-pad',
      label: 'Boost',
      props: { hint: 'Swipe for a burst of speed' },
    },
  },
  layout: 'stack',
  expectedDurationSec: 30,
  scoring: 'points',
  onPlayerDropped: 'freeze',
  retroactiveInput: false,
  interpolatable: ['racers', 'cursors'],
  discrete: ['scores', 'phase', 'results'],
};
export const manifests = [labManifest, raceManifest];
export function available(type: WidgetType, c: Capabilities) {
  if (type === 'pointer')
    return (
      c.sensors.gyro.present &&
      c.sensors.gyro.permission === 'granted' &&
      c.sensors.accel.present &&
      c.sensors.accel.permission === 'granted'
    );
  if (['tilt', 'shake'].includes(type))
    return c.sensors.accel.present && c.sensors.accel.permission === 'granted';
  return true;
}
export function resolveConfig(
  manifest: Manifest,
  c: Capabilities,
  generation: number,
): ControllerConfig {
  const substitutions: string[] = [],
    resolved: Record<string, WidgetType> = {};
  for (const [action, input] of Object.entries(manifest.inputs)) {
    if (available(input.prefer, c)) resolved[action] = input.prefer;
    else if (input.fallback && available(input.fallback, c)) {
      resolved[action] = input.fallback;
      substitutions.push(`${action}: ${input.prefer} → ${input.fallback}`);
    } else if (input.required)
      throw new Error(
        `Motion access is off for ${action}. Enable motion in your browser's site settings.`,
      );
  }
  const entries = Object.entries(resolved),
    types = Object.values(resolved),
    pointer = types.includes('pointer');
  if (types.filter(usesPressSlot).length > PRESS_SLOTS)
    throw new Error(
      `${manifest.name} needs more than ${PRESS_SLOTS} press controls.`,
    );
  const layout = manifest.layout ?? defaultLayout(entries.length);
  return {
    schemaVersion: 1,
    configId: manifest.id + '-v1',
    generation,
    orientation: layout === 'gamepad' ? 'any' : 'portrait',
    layout,
    sensors: {
      pointer: { enabled: pointer, rateHz: 60 },
      tilt: { enabled: types.includes('tilt') },
      shake: {
        enabled: types.includes('shake'),
        thresholdG: 1.8,
      },
      accel: { enabled: false },
    },
    haptics: { enabled: c.vibration },
    substitutions,
    widgets: resolveLayout(
      layout,
      entries.map(([action, type]) => {
        const input = manifest.inputs[action];
        return {
          id: action,
          action,
          type,
          label: input.label ?? action,
          ...(input.slot && { slot: input.slot }),
          ...(input.variant && { variant: input.variant }),
          ...(input.props && { props: input.props }),
          space: input.prefer === 'pointer' ? 'normalized' : 'signed',
        };
      }),
    ),
  };
}
export function defaultCapabilities(): Capabilities {
  return {
    sensors: {
      gyro: { present: false, permission: 'unavailable' },
      accel: { present: false, permission: 'unavailable' },
    },
    maxTouchPoints: 1,
    vibration: false,
    refreshRateHz: 60,
    devicePixelRatio: 1,
    safeAreaInsets: { top: 0, bottom: 0, left: 0, right: 0 },
    viewport: { w: 0, h: 0 },
  };
}
