// The single source of truth for which controls exist and how they report.
// Pure data (no React): core, session and runtime code import this.
import type { WidgetType, ControlDefinition, OutputKind } from './api.ts';

import { motionDefinitionFor } from './motion/metadata-registry.ts';

import { button } from './button/definition.ts';
import { dpad } from './dpad/definition.ts';
import { stick } from './stick/definition.ts';
import { aimPad } from './aim-pad/definition.ts';
import { swipePad } from './swipe-pad/definition.ts';
import { holdMeter } from './hold-meter/definition.ts';

/** Library controls, in gallery order. Add new controls here (and in views.ts). */
export const definitions: ControlDefinition[] = [
  button,
  dpad,
  stick,
  aimPad,
  swipePad,
  holdMeter,
  // control:new inserts above this line
];

const byType = new Map(definitions.map((d) => [d.type, d]));

export const definitionFor = (type: WidgetType) => byType.get(type);
export const isLibraryControl = (type: WidgetType) => byType.has(type);

export const kindOf = (type: WidgetType): OutputKind | undefined =>
  (byType.get(type) ?? motionDefinitionFor(type))?.kind;

export function channelOf(type: WidgetType) {
  const d = byType.get(type) ?? motionDefinitionFor(type);
  return {
    channel: d?.channel ?? 'value',
    throttle: d?.throttle ?? true,
    drivesPointer: byType.get(type)?.drivesPointer ?? false,
  };
}

/** Comfortable footprint in grid cells; motion has no touch footprint. */
export const recommendedSizeOf = (type: WidgetType) =>
  byType.get(type)?.recommendedSize ?? { w: 4, h: 4 };

export const usesPressSlot = (type: WidgetType) =>
  channelOf(type).channel !== 'value';

export { PRESS_SLOTS } from './motion/registration.ts';
