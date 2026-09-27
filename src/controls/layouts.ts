// Layout presets: named grid slots a game drops controls into. Pure data +
// validation; the grid templates themselves live in layout.css.
import type { Widget } from '../core/types.ts';

export const LAYOUTS = {
  /** One control fills the surface. */
  single: ['primary'],
  /** A big control on top, one action underneath. */
  stack: ['primary', 'a'],
  /** Two equal actions side by side. */
  duo: ['a', 'b'],
  /** Movement on the left thumb, two actions on the right (landscape);
   *  movement on top with the actions side by side (portrait). */
  gamepad: ['primary', 'a', 'b'],
  /** Escape hatch: every widget supplies its own normalized `rect`. */
  custom: [],
} as const satisfies Record<string, readonly string[]>;

export type LayoutPreset = keyof typeof LAYOUTS;
export type Slot = (typeof LAYOUTS)[Exclude<LayoutPreset, 'custom'>][number];

/** The preset a game gets when it doesn't name one. */
export function defaultLayout(count: number): LayoutPreset {
  if (count <= 1) return 'single';
  if (count === 2) return 'stack';
  if (count === 3) return 'gamepad';
  return 'custom';
}

/**
 * Assign every widget a slot in `preset`. Widgets that name a slot keep it;
 * the rest fill the remaining slots in order. Throws when it can't fit.
 */
export function resolveLayout<W extends Pick<Widget, 'id' | 'slot' | 'rect'>>(
  preset: LayoutPreset,
  widgets: W[],
): (W & { slot?: string })[] {
  if (preset === 'custom') {
    const missing = widgets.find((w) => !w.rect);
    if (missing)
      throw new Error(`Custom layout: "${missing.id}" needs a rect.`);
    return widgets;
  }
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
    if (w.slot) return w;
    const slot = free.shift();
    if (!slot)
      throw new Error(
        `Layout "${preset}" fits ${slots.length} controls; got ${widgets.length}.`,
      );
    return { ...w, slot };
  });
}
