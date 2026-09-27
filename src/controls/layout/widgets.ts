// Turn a layout into the widgets a phone renders.
import type { Widget } from '../../core/types.ts';
import type { ControllerLayout, GridRect, LayoutItem } from './schema.ts';

export const normalizedRect = (
  r: GridRect,
  grid: ControllerLayout['grid'],
): Widget['rect'] => [
  r.x / grid.cols,
  r.y / grid.rows,
  r.w / grid.cols,
  r.h / grid.rows,
];

/** One widget, driven by `action`, drawn where `item` sits. */
export function itemWidget(
  layout: ControllerLayout,
  item: LayoutItem,
  action = item.name,
): Widget {
  return {
    id: action,
    action,
    type: item.type,
    label: item.label ?? item.name,
    rect: normalizedRect(item.rect, layout.grid),
    rotation: item.rotation,
    ...(item.variant && { variant: item.variant }),
    ...(item.props && { props: item.props }),
  };
}

/** Every control in the layout, driving actions named after the controls. */
export const layoutWidgets = (layout: ControllerLayout): Widget[] =>
  layout.items.map((item) => itemWidget(layout, item));
