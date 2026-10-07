/** Authority and presentation consume metadata without importing live processors. */
import type { WidgetType } from '../api.ts';
import type { MotionMetadata } from './registration.ts';
import { joltMetadata } from './jolt-definition.ts';
import { pointerMetadata } from './pointer-definition.ts';
import { tiltMetadata, shakeMetadata } from './accelerometer-definition.ts';
import { chopMetadata } from './chop-definition.ts';
export const motionMetadata: readonly MotionMetadata<object>[] = [
  pointerMetadata,
  tiltMetadata,
  shakeMetadata,
  chopMetadata,
  joltMetadata,
];
const definitions = new Map<WidgetType, MotionMetadata<object>>(
  motionMetadata.map((definition) => [definition.type, definition]),
);
export const motionDefinitionFor = (type: WidgetType) => definitions.get(type);
