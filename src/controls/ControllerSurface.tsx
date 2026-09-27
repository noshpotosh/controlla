'use client';
// Renders a controller: the layout grid, one cell per widget, and the right
// view for each widget. Used by the live controller and the gallery alike, so
// what you see in the gallery is exactly what players get.
import type { CSSProperties, ReactNode } from 'react';
import type { Widget } from '../core/types.ts';
import type { LayoutPreset } from './layouts.ts';
import { definitionFor } from './registry.ts';
import type { ControlPort } from './types.ts';
import { views } from './views.ts';

export function ControlView({
  widget,
  port,
}: {
  widget: Widget;
  port: ControlPort;
}) {
  const View = views[widget.type],
    definition = definitionFor(widget.type);
  if (!View || !definition) return null;
  return (
    <View
      widget={widget}
      port={port}
      props={{ hint: definition.hint, ...definition.defaults, ...widget.props }}
    />
  );
}

export interface ControllerSurfaceProps {
  layout: LayoutPreset;
  widgets: Widget[];
  /** Player colour; tints every active state. */
  accent?: string;
  portFor: (widget: Widget) => ControlPort;
  /** Renders widget types the library doesn't provide yet. */
  fallback?: (widget: Widget) => ReactNode;
  className?: string;
}

export function ControllerSurface({
  layout,
  widgets,
  accent,
  portFor,
  fallback,
  className,
}: ControllerSurfaceProps) {
  return (
    <div
      className={['ctl-root', className].filter(Boolean).join(' ')}
      style={accent ? ({ '--ctl-accent': accent } as CSSProperties) : undefined}
    >
      <div className={`ctl-surface ctl-layout--${layout}`}>
        {widgets.map((w) => (
          <div key={w.id} className="ctl-cell" style={cellStyle(layout, w)}>
            {views[w.type] ? (
              <ControlView widget={w} port={portFor(w)} />
            ) : (
              fallback?.(w)
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function cellStyle(layout: LayoutPreset, w: Widget): CSSProperties {
  if (layout !== 'custom') return { gridArea: w.slot };
  const [x, y, width, height] = w.rect ?? [0, 0, 1, 1];
  return {
    left: `${x * 100}%`,
    top: `${y * 100}%`,
    width: `${width * 100}%`,
    height: `${height * 100}%`,
  };
}
