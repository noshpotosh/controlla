// The single source of truth for which controls exist and how they report.
// Pure data (no React): core, session and runtime code import this.
import type { WidgetType } from '../core/types.ts';
import type { Channel, ControlDefinition, OutputKind } from './types.ts';
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

/**
 * Inputs not yet ported to the library (motion + legacy widgets). Their
 * channels live here so the runtime has one lookup for every input type.
 */
const legacy: Partial<
  Record<WidgetType, { channel: Channel; throttle: boolean; kind: OutputKind }>
> = {
  shake: { channel: 'both', throttle: false, kind: 'press' },
  text: { channel: 'value', throttle: false, kind: 'text' },
  slider: { channel: 'value', throttle: true, kind: 'scalar' },
  dial: { channel: 'value', throttle: true, kind: 'angle' },
  'draw-canvas': { channel: 'value', throttle: true, kind: 'stroke' },
  // Motion inputs steer the frame's x/y, like a stick does.
  pointer: { channel: 'value', throttle: true, kind: 'vector' },
  tilt: { channel: 'value', throttle: true, kind: 'vector' },
};

export const kindOf = (type: WidgetType): OutputKind | undefined =>
  (byType.get(type) ?? legacy[type])?.kind;

export function channelOf(type: WidgetType) {
  const d = byType.get(type) ?? legacy[type];
  return {
    channel: d?.channel ?? 'value',
    throttle: d?.throttle ?? true,
    drivesPointer: byType.get(type)?.drivesPointer ?? false,
  };
}

/** Smallest footprint in grid cells; legacy widgets get a safe default. */
export const minSizeOf = (type: WidgetType) =>
  byType.get(type)?.minSize ?? { w: 4, h: 4 };

export const usesPressSlot = (type: WidgetType) =>
  channelOf(type).channel !== 'value';

/** InputFrame carries four timestamped press slots. */
export const PRESS_SLOTS = 4;
