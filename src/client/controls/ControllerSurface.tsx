'use client';
// Renders a controller: every widget in its rect on one uninterrupted
// surface, rotated if placed that way. Used by the live controller, the phone
// preview, the designer and the gallery, so they all look identical.
import type { CSSProperties, ReactNode } from 'react';
import type { Widget, ControlPort } from './api.ts';
import { RotationContext } from './kit/rotation-context.ts';
import { definitionFor } from './registry.ts';

import { motionSurfaces } from './motion-views/registry.tsx';
import type { MotionControlPort } from './motion/contracts.ts';
import type { MotionInput } from './api.ts';
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
      props={{
        hint: definition.hint,
        shape: definition.shapes[0],
        appearance: definition.appearances[0],
        ...definition.defaults,
        ...widget.props,
      }}
    />
  );
}

/** Wrap a port so a rotated control reports values in the screen frame. */
export function screenPort(widget: Widget, port: ControlPort): ControlPort {
  const rotation = widget.rotation ?? 0,
    rotate = definitionFor(widget.type)?.rotateOutput;
  return rotation && rotate
    ? { ...port, value: (v) => port.value(rotate(v, rotation)) }
    : port;
}

export interface ControllerSurfaceProps {
  widgets: Widget[];
  /** Player colour; tints every active state. */
  accent?: string;
  portFor: (widget: Widget) => ControlPort;
  motionPortFor?: (widget: Widget) => MotionControlPort;
  /** Renders widget types the library doesn't provide yet. */
  fallback?: (widget: Widget) => ReactNode;
  /** Overlays drawn on top of the surface (menu button, designer handles). */
  children?: ReactNode;
  className?: string;
}

export function ControllerSurface({
  widgets,
  accent,
  portFor,
  fallback,
  motionPortFor,
  children,
  className,
}: ControllerSurfaceProps) {
  return (
    <div
      className={['ctl-root', className].filter(Boolean).join(' ')}
      style={accent ? ({ '--ctl-accent': accent } as CSSProperties) : undefined}
    >
      <div className="ctl-surface">
        {widgets.map((w) =>
          // Motion inputs with no touch fallback have no footprint.
          !w.rect ? null : (
            <ControlCell key={w.id} rect={w.rect} rotation={w.rotation}>
              {views[w.type] ? (
                <ControlView widget={w} port={screenPort(w, portFor(w))} />
              ) : (
                <MotionView
                  widget={w}
                  port={portFor(w)}
                  motion={motionPortFor?.(w)}
                  fallback={fallback?.(w)}
                />
              )}
            </ControlCell>
          ),
        )}
        {children}
      </div>
    </div>
  );
}

/** Positions one control and applies its rotation. */
export function ControlCell({
  rect,
  rotation = 0,
  children,
}: {
  rect: NonNullable<Widget['rect']>;
  rotation?: Widget['rotation'];
  children: ReactNode;
}) {
  const [x, y, w, h] = rect;
  return (
    <div
      className="ctl-cell"
      style={{
        left: `${x * 100}%`,
        top: `${y * 100}%`,
        width: `${w * 100}%`,
        height: `${h * 100}%`,
      }}
    >
      <div className="ctl-cell__box">
        <RotationContext value={rotation}>
          <div className="ctl-cell__turn" data-rotation={rotation}>
            {children}
          </div>
        </RotationContext>
      </div>
    </div>
  );
}

function MotionView({
  widget,
  port,
  motion,
  fallback,
}: {
  widget: Widget;
  port: ControlPort;
  motion?: MotionControlPort;
  fallback?: ReactNode;
}) {
  const View = motionSurfaces[widget.type as MotionInput];
  return View ? <View widget={widget} port={port} motion={motion} /> : fallback;
}
