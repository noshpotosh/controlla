/** Registered settings become action-scoped processor bindings. */
import type { ControllerConfig, WidgetType } from '../api.ts';
import type { MotionBinding } from './composition.ts';
import { motionDefinitionFor } from './metadata-registry.ts';
export function motionBindings(
  config: ControllerConfig,
): MotionBinding[] | null {
  if (
    !config.motion ||
    typeof config.motion !== 'object' ||
    Array.isArray(config.motion)
  )
    return null;
  for (const [type, settings] of Object.entries(config.motion)) {
    const definition = motionDefinitionFor(type as WidgetType);
    if (
      !definition ||
      !definition.validateConfig(settings).ok ||
      !config.widgets.some((widget) => widget.type === type)
    )
      return null;
  }
  const bindings: MotionBinding[] = [];
  for (const widget of config.widgets) {
    const definition = motionDefinitionFor(widget.type);
    if (!definition) continue;
    const settings = config.motion[definition.type];
    if (settings === undefined) return null;
    bindings.push({
      type: widget.type,
      action: widget.action,
      config: settings,
    });
  }
  return bindings;
}
