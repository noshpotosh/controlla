import type {
  Capabilities,
  ControllerConfig,
  Manifest,
  WidgetType,
} from './types.ts';
export const labManifest: Manifest = {
  id: 'latency-lab',
  name: 'Latency Lab',
  players: { min: 2, max: 8 },
  inputs: {
    aim: { required: true, prefer: 'pointer', fallback: 'stick' },
    fire: { required: true, prefer: 'button' },
  },
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
    steer: { required: true, prefer: 'tilt', fallback: 'stick' },
    boost: { required: true, prefer: 'swipe-pad' },
  },
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
    pointer = Object.values(resolved).includes('pointer');
  return {
    schemaVersion: 1,
    configId: manifest.id + '-v1',
    generation,
    orientation: 'portrait',
    sensors: {
      pointer: { enabled: pointer, rateHz: 60 },
      tilt: { enabled: Object.values(resolved).includes('tilt') },
      shake: {
        enabled: Object.values(resolved).includes('shake'),
        thresholdG: 1.8,
      },
      accel: { enabled: false },
    },
    haptics: { enabled: c.vibration },
    substitutions,
    widgets: entries.map(([action, type], i) => ({
      id: action,
      action,
      type,
      label: action.toUpperCase(),
      rect:
        entries.length === 1
          ? [0.05, 0.1, 0.9, 0.8]
          : i === 0
            ? [0.05, 0.05, 0.9, 0.52]
            : [0.05, 0.64, 0.9, 0.3],
      holdMs: 800,
      deadzone: 0.08,
      space:
        manifest.inputs[action].prefer === 'pointer' ? 'normalized' : 'signed',
    })),
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
