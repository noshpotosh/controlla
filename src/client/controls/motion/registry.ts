/** Pure motion registration. Presentation has its own registry. */
import type { WidgetType } from '../api.ts';
import type { MotionDefinition } from './registration.ts';
import { jolt } from './jolt.ts';
import { pointer } from './pointer-input.ts';
import { tilt, shake } from './accelerometer-inputs.ts';
import { chop } from './chop-input.ts';

export const motionDefinitions: readonly MotionDefinition<object>[] = [
  pointer,
  tilt,
  shake,
  chop,
  jolt,
];
const definitions = new Map<WidgetType, MotionDefinition<object>>(
  motionDefinitions.map((definition) => [definition.type, definition]),
);
export const motionDefinitionFor = (type: WidgetType) => definitions.get(type);
