/** Temporary schema-1 projection; removed when configuration migrates to the motion map. */
import type { ControllerConfig } from '../api.ts';
import type { MotionBinding } from './composition.ts';
import { motionDefinitions } from './registry.ts';
export function motionBindings(config: ControllerConfig): MotionBinding[] {
  const settings = {
    pointer: config.sensors.pointer.enabled
      ? {
          bounds: config.sensors.pointer.bounds,
          anchor: config.sensors.pointer.anchor !== false,
          rateHz: config.sensors.pointer.rateHz,
        }
      : null,
    tilt: config.sensors.tilt.enabled ? {} : null,
    shake: config.sensors.shake.enabled
      ? { thresholdG: config.sensors.shake.thresholdG }
      : null,
    chop: config.sensors.chop?.enabled ? {} : null,
  };
  return motionDefinitions.flatMap((definition) => {
    const value = settings[definition.type as keyof typeof settings];
    return value
      ? [
          {
            type: definition.type,
            action:
              config.widgets.find((widget) => widget.type === definition.type)
                ?.action ?? `motion:${definition.type}`,
            config: value,
          },
        ]
      : [];
  });
}
