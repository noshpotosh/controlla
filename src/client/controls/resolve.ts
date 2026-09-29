import type {
  Capabilities,
  ControllerConfig,
  ControllerSpec,
  Widget,
  WidgetType,
} from './api.ts';
import { gameDefaultLayout } from './layouts.ts';
import { itemWidget } from './layout/widgets.ts';
import { isMotion } from './layout/schema.ts';
import {
  boundName,
  checkAssignment,
  validateLayout,
} from './layout/validate.ts';
import { layouts } from './layouts/index.ts';
import { PRESS_SLOTS, usesPressSlot } from './registry.ts';
export function available(type: WidgetType, c: Capabilities) {
  if (type === 'pointer' || type === 'chop')
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
/** Select the named controller layout, or generate one from requirements. */
export function gameLayout(spec: ControllerSpec) {
  const id = spec.controller?.layout;
  if (id && !layouts[id])
    throw new Error(`${spec.name} uses layout "${id}", which doesn't exist.`);
  return id ? layouts[id] : gameDefaultLayout(spec);
}
/** Resolve atomically: no configuration escapes before all checks pass. */
export function resolveConfig(
  spec: ControllerSpec,
  c: Capabilities,
  generation: number,
): ControllerConfig {
  const layout = gameLayout(spec),
    substitutions: string[] = [],
    widgets: Widget[] = [];
  const issues = [...validateLayout(layout), ...checkAssignment(spec, layout)];
  if (issues.length)
    throw new Error(issues.map((issue) => issue.message).join(' '));
  for (const [action, input] of Object.entries(spec.inputs)) {
    const item = layout.items.find((i) => i.name === boundName(spec, action)),
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
  // The unchanged binary frame carries one motion vector. Check resolved
  // actions, including repeated uses of one sensor, rather than layout flags.
  const motionWidgets = widgets.filter(
    (widget) => widget.type === 'pointer' || widget.type === 'tilt',
  );
  if (motionWidgets.length > 1)
    throw new Error(
      `${spec.name}: only one binary motion vector is supported; conflicting actions: ${motionWidgets.map((widget) => `${widget.action} (${widget.type})`).join(', ')}.`,
    );
  const types = widgets.map((w) => w.type);
  if (types.filter(usesPressSlot).length > PRESS_SLOTS)
    throw new Error(
      `${spec.name} needs more than ${PRESS_SLOTS} press controls.`,
    );
  return {
    schemaVersion: 1,
    configId: spec.id + '-v1',
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
      chop: { enabled: types.includes('chop') },
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
