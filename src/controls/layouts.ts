// Layout presets: arrangements the designer starts new layouts from, and
// that games without a chosen layout fall back to.
import type { Manifest, WidgetType } from '../core/types.ts';
import {
  emptyLayout,
  isMotion,
  NO_MOTION,
  type ControllerLayout,
  type GridRect,
  type Orientation,
} from './layout/schema.ts';

/** Slots per preset, in fill order. */
export const LAYOUTS = {
  /** One control fills the surface. */
  single: ['primary'],
  /** A big control, then one action (below in portrait, beside in landscape). */
  stack: ['primary', 'a'],
  /** Two equal actions side by side. */
  duo: ['a', 'b'],
  /** Movement plus two actions: left/right thumbs in landscape. */
  gamepad: ['primary', 'a', 'b'],
} as const satisfies Record<string, readonly string[]>;

export type LayoutPreset = keyof typeof LAYOUTS;

const r = (x: number, y: number, w: number, h: number): GridRect => ({
  x,
  y,
  w,
  h,
});

// Rects in grid cells (portrait 12×24, landscape 24×12). The menu button
// owns the top-right 2×2, so presets keep clear of it.
const RECTS: Record<Orientation, Record<LayoutPreset, GridRect[]>> = {
  portrait: {
    single: [r(0, 2, 12, 22)],
    stack: [r(0, 2, 12, 13), r(0, 15, 12, 9)],
    duo: [r(0, 2, 6, 22), r(6, 2, 6, 22)],
    gamepad: [r(0, 2, 12, 13), r(0, 15, 6, 9), r(6, 15, 6, 9)],
  },
  landscape: {
    single: [r(0, 0, 22, 12)],
    stack: [r(0, 0, 13, 12), r(13, 2, 11, 10)],
    duo: [r(0, 0, 12, 12), r(12, 2, 12, 10)],
    gamepad: [r(0, 0, 12, 12), r(12, 2, 12, 5), r(12, 7, 12, 5)],
  },
};

/** The preset a game gets when it doesn't name one. */
export function defaultLayout(count: number): LayoutPreset {
  if (count <= 1) return 'single';
  if (count === 2) return 'stack';
  return 'gamepad';
}

/**
 * Assign each input a slot in `preset`. Inputs that name a slot keep it;
 * the rest fill the remaining slots in order. Throws when they can't fit.
 */
export function assignSlots<W extends { id: string; slot?: string }>(
  preset: LayoutPreset,
  widgets: W[],
): (W & { slot: string })[] {
  const slots: readonly string[] = LAYOUTS[preset],
    taken = new Set<string>();
  for (const w of widgets) {
    if (!w.slot) continue;
    if (!slots.includes(w.slot))
      throw new Error(
        `Layout "${preset}" has no slot "${w.slot}" (for "${w.id}").`,
      );
    if (taken.has(w.slot))
      throw new Error(`Layout "${preset}": slot "${w.slot}" is used twice.`);
    taken.add(w.slot);
  }
  const free = slots.filter((s) => !taken.has(s));
  return widgets.map((w) => {
    const slot = w.slot ?? free.shift();
    if (!slot)
      throw new Error(
        `Layout "${preset}" fits ${slots.length} controls; got ${widgets.length}. Design a layout for this game.`,
      );
    return { ...w, slot };
  });
}

/** Starting points for new layouts in the designer: generic controls. */
const TEMPLATE_ITEMS: Record<
  LayoutPreset,
  { name: string; type: WidgetType; label: string; variant?: string }[]
> = {
  single: [{ name: 'move', type: 'stick', label: 'Move' }],
  stack: [
    { name: 'move', type: 'stick', label: 'Move' },
    { name: 'a', type: 'button', label: 'A' },
  ],
  duo: [
    { name: 'a', type: 'button', label: 'A' },
    { name: 'b', type: 'button', label: 'B', variant: 'neutral' },
  ],
  gamepad: [
    { name: 'move', type: 'dpad', label: 'Move' },
    { name: 'a', type: 'button', label: 'A' },
    { name: 'b', type: 'button', label: 'B', variant: 'neutral' },
  ],
};

export function templateLayout(
  preset: LayoutPreset,
  orientation: Orientation,
  id: string,
  name: string,
): ControllerLayout {
  return {
    ...emptyLayout(id, name, orientation),
    items: TEMPLATE_ITEMS[preset].map((item, i) => ({
      ...item,
      rect: { ...RECTS[orientation][preset][i] },
      rotation: 0,
    })),
  };
}

/**
 * The layout a game gets when it hasn't picked one: its touch inputs placed
 * by a preset, its motion inputs switched on (with any touch fallback placed
 * under the input's name).
 */
export function gameDefaultLayout(
  manifest: Pick<Manifest, 'id' | 'name' | 'inputs' | 'layout'>,
): ControllerLayout {
  const touch = Object.entries(manifest.inputs).flatMap(([input, need]) => {
      const type = isMotion(need.prefer) ? need.fallback : need.prefer;
      return type && !isMotion(type) ? [{ id: input, type, need }] : [];
    }),
    preset = manifest.layout ?? defaultLayout(touch.length),
    slots: readonly string[] = LAYOUTS[preset],
    placed = assignSlots(
      preset,
      touch.map((t) => ({ ...t, slot: t.need.slot })),
    ),
    motion = { ...NO_MOTION };
  for (const need of Object.values(manifest.inputs))
    if (isMotion(need.prefer)) motion[need.prefer] = true;
  return {
    ...emptyLayout(
      `${manifest.id}-default`,
      `${manifest.name} (default)`,
      'portrait',
    ),
    motion,
    items: placed.map(({ id, type, need, slot }) => ({
      name: id,
      type,
      rect: { ...RECTS.portrait[preset][slots.indexOf(slot)] },
      rotation: 0,
      ...(need.label && { label: need.label }),
      ...(type === need.prefer && need.variant && { variant: need.variant }),
      ...(type === need.prefer && need.props && { props: need.props }),
    })),
  };
}
