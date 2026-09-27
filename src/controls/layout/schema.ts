// Controller layouts: a library of named touch layouts, designed in
// /?role=designer and stored as JSON in src/layouts. Layouts don't know about
// games; a game picks one and its inputs bind to the layout's control names.
// Pure: safe for core, tests and Vite.
import type { WidgetType } from '../../core/types.ts';

export type Orientation = 'portrait' | 'landscape';
export type Rotation = 0 | 90 | 180 | 270;
export type MenuCorner =
  | 'top-left'
  | 'top-right'
  | 'bottom-left'
  | 'bottom-right';

/** Motion inputs a layout can switch on. They have no on-screen footprint. */
export const MOTION = ['pointer', 'tilt', 'shake'] as const;
export type MotionInput = (typeof MOTION)[number];
export const isMotion = (type: WidgetType): type is MotionInput =>
  (MOTION as readonly string[]).includes(type);

export interface GridRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface LayoutItem {
  /** Unique within the layout; game inputs bind to this name. */
  name: string;
  /** A touch control from the library (never a motion input). */
  type: WidgetType;
  /** Position and size in grid cells. */
  rect: GridRect;
  rotation: Rotation;
  label?: string;
  variant?: string;
  props?: Record<string, unknown>;
}

export interface ControllerLayout {
  schemaVersion: 2;
  /** Unique slug; also the file name. Fixed once created. */
  id: string;
  /** Display name; free to change. */
  name: string;
  orientation: Orientation;
  grid: { cols: number; rows: number };
  /** Corner reserved for the menu button. */
  menu: MenuCorner;
  /** Motion inputs this layout turns on. */
  motion: Record<MotionInput, boolean>;
  items: LayoutItem[];
}

/** Grid per orientation: roughly square cells on a typical phone. */
export const GRID: Record<Orientation, { cols: number; rows: number }> = {
  portrait: { cols: 12, rows: 24 },
  landscape: { cols: 24, rows: 12 },
};

/** The menu button's reserved footprint, in cells. */
export const MENU_SIZE = 2;

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
};

export function menuRect(
  layout: Pick<ControllerLayout, 'grid' | 'menu'>,
): GridRect {
  const { cols, rows } = layout.grid;
  return {
    x: layout.menu.endsWith('left') ? 0 : cols - MENU_SIZE,
    y: layout.menu.startsWith('top') ? 0 : rows - MENU_SIZE,
    w: MENU_SIZE,
    h: MENU_SIZE,
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
  if (!isObject(motion) || !MOTION.every((m) => typeof motion[m] === 'boolean'))
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
  return v;
}

/** Where the save endpoint may write a layout; null if unsafe. */
export function layoutFileName(id: string): string | null {
  return isLayoutId(id) ? `${id}.json` : null;
}
