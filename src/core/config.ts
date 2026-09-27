import type {
  Capabilities,
  ControllerConfig,
  Manifest,
  Widget,
  WidgetType,
} from './types.ts';
import { gameDefaultLayout } from '../controls/layouts.ts';
import { itemWidget } from '../controls/layout/widgets.ts';
import { isMotion } from '../controls/layout/schema.ts';
import { boundName } from '../controls/layout/validate.ts';
import { layouts } from '../layouts/index.ts';
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
  controller: { layout: 'aim-and-fire' },
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
  controller: { layout: 'steer-and-boost' },
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
/** The layout a game plays on: its chosen one, else a generated default. */
export function gameLayout(manifest: Manifest) {
  const id = manifest.controller?.layout;
  if (id && !layouts[id])
    throw new Error(
      `${manifest.name} uses layout "${id}", which doesn't exist.`,
    );
  return id ? layouts[id] : gameDefaultLayout(manifest);
}
export function resolveConfig(
  manifest: Manifest,
  c: Capabilities,
  generation: number,
): ControllerConfig {
  const layout = gameLayout(manifest),
    substitutions: string[] = [],
    widgets: Widget[] = [];
  for (const [action, input] of Object.entries(manifest.inputs)) {
    const item = layout.items.find(
        (i) => i.name === boundName(manifest, action),
      ),
      // A motion input the layout switches on wins when the phone has it;
      // otherwise the touch control of the same name stands in for it.
      motion =
        isMotion(input.prefer) &&
        layout.motion[input.prefer] &&
        available(input.prefer, c);
    let widget: Widget | null = null;
    if (motion)
      widget = item
        ? { ...itemWidget(layout, item, action), type: input.prefer }
        : {
            id: action,
            action,
            type: input.prefer,
            label: input.label ?? action,
          };
    else if (item) {
      widget = itemWidget(layout, item, action);
      if (isMotion(input.prefer) && layout.motion[input.prefer])
        substitutions.push(`${action}: ${input.prefer} → ${item.type}`);
    } else if (input.required)
      throw new Error(
        isMotion(input.prefer)
          ? `Motion access is off for ${action}. Enable motion in your browser's site settings.`
          : `Layout "${layout.name}" has no control for ${action}.`,
      );
    if (!widget) continue;
    if (widget.type !== item?.type) {
      // Props and variants belong to the touch control, not the sensor.
      delete widget.props;
      delete widget.variant;
    }
    widgets.push({
      ...widget,
      space: input.prefer === 'pointer' ? 'normalized' : 'signed',
    });
  }
  const types = widgets.map((w) => w.type);
  if (types.filter(usesPressSlot).length > PRESS_SLOTS)
    throw new Error(
      `${manifest.name} needs more than ${PRESS_SLOTS} press controls.`,
    );
  return {
    schemaVersion: 1,
    configId: manifest.id + '-v1',
    generation,
    orientation: layout.orientation,
    menu: layout.menu,
    sensors: {
      pointer: { enabled: types.includes('pointer'), rateHz: 60 },
      tilt: { enabled: types.includes('tilt') },
      shake: {
        enabled: types.includes('shake'),
        thresholdG: 1.8,
      },
      accel: { enabled: false },
    },
    haptics: { enabled: c.vibration },
    substitutions,
    widgets,
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
