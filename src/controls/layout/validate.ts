// Rules for layouts. `validateLayout` is about the layout alone (designer,
// save endpoint); `checkAssignment` is about a game using it.
import type {
  ControllerRequirements,
  ControllerLayout,
  GridRect,
} from '../api.ts';
import {
  definitionFor,
  kindOf,
  minSizeOf,
  PRESS_SLOTS,
  usesPressSlot,
} from '../registry.ts';
import { isSideways } from './rotation.ts';

import { isControlName, isMotion, menuRect } from './schema.ts';

export interface LayoutIssue {
  /** Index of the offending item, when the issue belongs to one. */
  item?: number;
  message: string;
}

export const overlaps = (a: GridRect, b: GridRect) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

export function validateLayout(layout: ControllerLayout): LayoutIssue[] {
  const issues: LayoutIssue[] = [],
    { cols, rows } = layout.grid,
    menu = menuRect(layout),
    seen = new Set<string>();
  if (!layout.name.trim()) issues.push({ message: 'Give the layout a name.' });
  layout.items.forEach((item, i) => {
    const { rect: r } = item,
      name = item.label || item.name;
    if (!definitionFor(item.type))
      issues.push({
        item: i,
        message: `${name}: "${item.type}" isn't a touch control. Motion inputs are switched on, not placed.`,
      });
    if (!isControlName(item.name))
      issues.push({
        item: i,
        message: `"${item.name}" isn't a valid name (letters, numbers, - and _).`,
      });
    if (seen.has(item.name))
      issues.push({
        item: i,
        message: `Two controls are named "${item.name}".`,
      });
    seen.add(item.name);
    if (
      r.w < 1 ||
      r.h < 1 ||
      r.x < 0 ||
      r.y < 0 ||
      r.x + r.w > cols ||
      r.y + r.h > rows
    )
      issues.push({ item: i, message: `${name} is outside the controller.` });
    // A sideways control's own width runs along the grid's height.
    const min = minSizeOf(item.type),
      need = isSideways(item.rotation) ? { w: min.h, h: min.w } : min;
    if (r.w < need.w || r.h < need.h)
      issues.push({
        item: i,
        message: `${name} is too small (at least ${need.w}×${need.h}).`,
      });
    if (overlaps(r, menu))
      issues.push({ item: i, message: `${name} covers the menu corner.` });
    for (let j = 0; j < i; j++)
      if (overlaps(r, layout.items[j].rect))
        issues.push({
          item: i,
          message: `${name} overlaps ${layout.items[j].label || layout.items[j].name}.`,
        });
  });
  const presses =
    layout.items.filter((item) => usesPressSlot(item.type)).length +
    (layout.motion.shake ? 1 : 0);
  if (presses > PRESS_SLOTS)
    issues.push({
      message: `${presses} press inputs (shake counts); a controller carries at most ${PRESS_SLOTS}.`,
    });
  return issues;
}

/** The layout control a game input binds to (same name unless remapped). */
export const boundName = (
  spec: Pick<ControllerRequirements, 'controller'>,
  input: string,
) => spec.controller?.bind?.[input] ?? input;

/**
 * Can this game run on this layout? Each required input needs either a
 * touch control of the right kind (matched by name), or — for motion
 * inputs — the layout to switch that motion input on.
 */
export function checkAssignment(
  spec: Pick<ControllerRequirements, 'inputs' | 'controller'>,
  layout: ControllerLayout,
): LayoutIssue[] {
  const issues: LayoutIssue[] = [];
  for (const [input, need] of Object.entries(spec.inputs)) {
    const name = boundName(spec, input),
      item = layout.items.find((i) => i.name === name),
      motionOn = isMotion(need.prefer) && layout.motion[need.prefer];
    if (item && kindOf(item.type) !== kindOf(need.prefer))
      issues.push({
        message: `"${input}" needs a ${kindOf(need.prefer)} control; "${name}" is a ${item.type}.`,
      });
    else if (!item && !motionOn && need.required)
      issues.push({
        message: isMotion(need.prefer)
          ? `"${input}" needs ${need.prefer} switched on, or a ${kindOf(need.prefer)} control named "${name}".`
          : `No control named "${name}" for "${input}".`,
      });
  }
  return issues;
}
