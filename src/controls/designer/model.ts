// Pure editing operations for the controller designer (tested in
// tests/layout.test.ts). The React components only call these.
import type { WidgetType } from '../../core/types.ts';
import { minSizeOf } from '../registry.ts';
import { isSideways } from '../layout/rotation.ts';
import {
  GRID,
  menuRect,
  type ControllerLayout,
  type GridRect,
  type LayoutItem,
  type Orientation,
  type Rotation,
} from '../layout/schema.ts';
import { overlaps } from '../layout/validate.ts';

/** Minimum footprint for an item, accounting for rotation. */
export function footprint(type: WidgetType, rotation: Rotation) {
  const min = minSizeOf(type);
  return isSideways(rotation) ? { w: min.h, h: min.w } : min;
}

/** Keep a rect on the grid: at least 1×1, never past an edge. */
export function clampRect(
  rect: GridRect,
  grid: ControllerLayout['grid'],
): GridRect {
  const w = Math.max(1, Math.min(grid.cols, Math.round(rect.w))),
    h = Math.max(1, Math.min(grid.rows, Math.round(rect.h)));
  return {
    x: Math.max(0, Math.min(grid.cols - w, Math.round(rect.x))),
    y: Math.max(0, Math.min(grid.rows - h, Math.round(rect.y))),
    w,
    h,
  };
}

/** True when `rect` sits clear of the menu corner and every other item. */
export function isFree(layout: ControllerLayout, rect: GridRect, ignore = -1) {
  return (
    !overlaps(rect, menuRect(layout)) &&
    layout.items.every((item, i) => i === ignore || !overlaps(rect, item.rect))
  );
}

/** First free top-left position (row by row) for a w×h rect, if any. */
export function findFreeSpot(
  layout: ControllerLayout,
  size: { w: number; h: number },
): GridRect | null {
  const { cols, rows } = layout.grid;
  for (let y = 0; y + size.h <= rows; y++)
    for (let x = 0; x + size.w <= cols; x++) {
      const rect = { x, y, ...size };
      if (isFree(layout, rect)) return rect;
    }
  return null;
}

/** A control name not yet used in the layout: "button", "button-2", … */
export function uniqueName(layout: ControllerLayout, base: string) {
  const used = new Set(layout.items.map((i) => i.name));
  let name = base;
  for (let n = 2; used.has(name); n++) name = `${base}-${n}`;
  return name;
}

const title = (name: string) =>
  name.replace(/[-_]+/g, ' ').replace(/^./, (c) => c.toUpperCase());

/**
 * Add a touch control, named after its type. Placed at `at` when given (and
 * free), else the first free spot; null when there's no room.
 */
export function addItem(
  layout: ControllerLayout,
  type: WidgetType,
  at?: { x: number; y: number },
): { layout: ControllerLayout; index: number } | null {
  const size = footprint(type, 0),
    // Start a little bigger than the minimum; most controls want room.
    comfy = { w: Math.min(layout.grid.cols, size.w + 1), h: size.h + 1 },
    wanted = at && clampRect({ ...at, ...comfy }, layout.grid),
    rect =
      (wanted && isFree(layout, wanted) && wanted) ||
      findFreeSpot(layout, comfy) ||
      findFreeSpot(layout, size);
  if (!rect) return null;
  const name = uniqueName(layout, type),
    item: LayoutItem = { name, type, rect, rotation: 0, label: title(name) };
  return {
    layout: { ...layout, items: [...layout.items, item] },
    index: layout.items.length,
  };
}

export function updateItem(
  layout: ControllerLayout,
  index: number,
  change: Partial<LayoutItem>,
): ControllerLayout {
  return {
    ...layout,
    items: layout.items.map((item, i) =>
      i === index ? { ...item, ...change } : item,
    ),
  };
}

export function removeItem(
  layout: ControllerLayout,
  index: number,
): ControllerLayout {
  return { ...layout, items: layout.items.filter((_, i) => i !== index) };
}

/** Quarter-turn clockwise, keeping the item's centre and staying on the grid. */
export function rotateItem(
  layout: ControllerLayout,
  index: number,
): ControllerLayout {
  const item = layout.items[index],
    rotation = ((item.rotation + 90) % 360) as Rotation,
    { x, y, w, h } = item.rect,
    rect = clampRect(
      { x: x + (w - h) / 2, y: y + (h - w) / 2, w: h, h: w },
      layout.grid,
    );
  return updateItem(layout, index, { rotation, rect });
}

/** Switch orientation, scaling every rect onto the new grid. */
export function reorient(
  layout: ControllerLayout,
  orientation: Orientation,
): ControllerLayout {
  if (layout.orientation === orientation) return layout;
  const grid = GRID[orientation],
    sx = grid.cols / layout.grid.cols,
    sy = grid.rows / layout.grid.rows;
  return {
    ...layout,
    orientation,
    grid: { ...grid },
    items: layout.items.map((item) => ({
      ...item,
      rect: clampRect(
        {
          x: item.rect.x * sx,
          y: item.rect.y * sy,
          w: item.rect.w * sx,
          h: item.rect.h * sy,
        },
        grid,
      ),
    })),
  };
}
