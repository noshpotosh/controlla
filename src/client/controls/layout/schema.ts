// Controller layouts: a library of named touch layouts, designed in
// /?role=designer and stored as JSON in src/client/controls/layouts. Layouts don't know about
// games; a game picks one and its inputs bind to the layout's control names.
// Pure: safe for core, tests and Vite.
import type {
  WidgetType,
  Orientation,
  Rotation,
  MenuCorner,
  MotionInput,
  GridRect,
  ControllerLayout,
} from '../api.ts';

/** Motion inputs a layout can switch on. They have no on-screen footprint. */
export const MOTION = [
  'pointer',
  'tilt',
  'shake',
  'chop',
] as const satisfies readonly MotionInput[];
/** Motion inputs added after layout schema 2; saved layouts may omit them. */
const LATER_MOTION: readonly MotionInput[] = ['chop'];
export const isMotion = (type: WidgetType): type is MotionInput =>
  (MOTION as readonly string[]).includes(type);

/** Grid per orientation: roughly square cells on a typical phone. */
export const GRID: Record<Orientation, { cols: number; rows: number }> = {
  portrait: { cols: 12, rows: 24 },
  landscape: { cols: 24, rows: 12 },
};

/** The menu button's reserved footprint, in cells. */
export const MENU_SIZE = 2;

/** Aimed motion (pointer, tilt) drifts, so those layouts always show Recenter. */
export const needsRecenter = (motion: Record<MotionInput, boolean>) =>
  motion.pointer || motion.tilt;

export const ROTATIONS: readonly Rotation[] = [0, 90, 180, 270];
export const MENU_CORNERS: readonly MenuCorner[] = [
  'top-left',
  'top-right',
  'bottom-left',
  'bottom-right',
];

export const NO_MOTION: Record<MotionInput, boolean> = {
  pointer: false,
  tilt: false,
  shake: false,
  chop: false,
};

/**
 * The corner the phone chrome owns. With aimed motion on, it also holds the
 * Recenter button beside the menu, along the screen's short edge: two cells
 * more across in portrait, down in landscape.
 */
export function menuRect(
  layout: Pick<ControllerLayout, 'grid' | 'menu'> &
    Partial<Pick<ControllerLayout, 'motion'>>,
): GridRect {
  const { cols, rows } = layout.grid,
    extra = layout.motion && needsRecenter(layout.motion) ? MENU_SIZE : 0,
    portrait = cols <= rows,
    w = MENU_SIZE + (portrait ? extra : 0),
    h = MENU_SIZE + (portrait ? 0 : extra);
  return {
    x: layout.menu.endsWith('left') ? 0 : cols - w,
    y: layout.menu.startsWith('top') ? 0 : rows - h,
    w,
    h,
  };
}

export function emptyLayout(
  id: string,
  name: string,
  orientation: Orientation,
): ControllerLayout {
  return {
    schemaVersion: 2,
    id,
    name,
    orientation,
    grid: { ...GRID[orientation] },
    menu: 'top-right',
    motion: { ...NO_MOTION },
    items: [],
  };
}

const ID = /^[a-z0-9]+(-[a-z0-9]+)*$/;
export const isLayoutId = (id: string) => ID.test(id) && id.length <= 40;
const NAME = /^[A-Za-z0-9_-]{1,40}$/;
export const isControlName = (name: string) => NAME.test(name);

/** "Racing Wheel!" → "racing-wheel", unique among `taken`. */
export function slugify(text: string, taken: Iterable<string> = []) {
  const base =
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 34) || 'layout';
  const used = new Set(taken);
  let id = base;
  for (let n = 2; used.has(id); n++) id = `${base}-${n}`;
  return id;
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const isCount = (v: unknown): v is number =>
  Number.isInteger(v) && (v as number) >= 0;

/** Structural check for untrusted JSON (the save endpoint, hand edits). */
export function isControllerLayout(v: unknown): v is ControllerLayout {
  if (!isObject(v) || v.schemaVersion !== 2) return false;
  if (typeof v.id !== 'string' || !isLayoutId(v.id)) return false;
  if (typeof v.name !== 'string' || !v.name.trim() || v.name.length > 60)
    return false;
  if (v.orientation !== 'portrait' && v.orientation !== 'landscape')
    return false;
  if (!isObject(v.grid) || !isCount(v.grid.cols) || !isCount(v.grid.rows))
    return false;
  if (!MENU_CORNERS.includes(v.menu as MenuCorner)) return false;
  const motion = v.motion;
  if (
    !isObject(motion) ||
    !MOTION.every(
      (m) =>
        typeof motion[m] === 'boolean' ||
        (motion[m] === undefined && LATER_MOTION.includes(m)),
    )
  )
    return false;
  if (!Array.isArray(v.items) || v.items.length > 24) return false;
  return v.items.every(
    (item) =>
      isObject(item) &&
      typeof item.name === 'string' &&
      isControlName(item.name) &&
      typeof item.type === 'string' &&
      isObject(item.rect) &&
      ['x', 'y', 'w', 'h'].every((k) =>
        isCount((item.rect as Record<string, unknown>)[k]),
      ) &&
      ROTATIONS.includes(item.rotation as Rotation) &&
      (item.label === undefined || typeof item.label === 'string') &&
      (item.variant === undefined || typeof item.variant === 'string') &&
      (item.props === undefined || isObject(item.props)),
  );
}

/** Checked cast for layout JSON imported by the layout index. */
export function asControllerLayout(v: unknown): ControllerLayout {
  if (!isControllerLayout(v)) throw new Error('Invalid controller layout JSON');
  // Older files omit motion inputs added later; they are off.
  return { ...v, motion: { ...NO_MOTION, ...v.motion } };
}

/** Where the save endpoint may write a layout; null if unsafe. */
export function layoutFileName(id: string): string | null {
  return isLayoutId(id) ? `${id}.json` : null;
}
