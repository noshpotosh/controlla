'use client';
// The designer's phone: the real ControllerSurface, with an editing overlay
// (grid, menu corner, drag/resize handles) laid exactly over its grid.
import {
  useRef,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { RotateCw, Trash2 } from 'lucide-react';
import type { WidgetType, ControllerLayout, GridRect } from '../api.ts';
import { ControllerSurface } from '../ControllerSurface.tsx';
import type { useReadings } from '../gallery/readings.tsx';

import { menuRect } from '../layout/schema.ts';
import { layoutWidgets } from '../layout/widgets.ts';
import { SensorTile } from '../SensorTile.tsx';
import { clampRect } from './model.ts';

export const DRAG_TYPE = 'application/x-controlla-control';

type Handle = 'move' | 'nw' | 'ne' | 'sw' | 'se';

const pct = (r: GridRect, grid: ControllerLayout['grid']) => ({
  left: `${(r.x / grid.cols) * 100}%`,
  top: `${(r.y / grid.rows) * 100}%`,
  width: `${(r.w / grid.cols) * 100}%`,
  height: `${(r.h / grid.rows) * 100}%`,
});

export function Canvas({
  layout,
  selected,
  invalid,
  play,
  aspect,
  accent,
  readings,
  onSelect,
  onBeginEdit,
  onRect,
  onRotate,
  onRemove,
  onDropControl,
}: {
  layout: ControllerLayout;
  selected: number | null;
  invalid: Set<number>;
  play: boolean;
  aspect: number;
  accent: string;
  readings: ReturnType<typeof useReadings>;
  onSelect: (index: number | null) => void;
  /** Called once before a drag/resize, so it can be undone as one step. */
  onBeginEdit: () => void;
  onRect: (index: number, rect: GridRect) => void;
  onRotate: (index: number) => void;
  onRemove: (index: number) => void;
  onDropControl: (type: WidgetType, cell: { x: number; y: number }) => void;
}) {
  const overlay = useRef<HTMLDivElement>(null),
    { grid } = layout;

  const cellAt = (clientX: number, clientY: number) => {
    const box = overlay.current!.getBoundingClientRect();
    return {
      x: Math.floor(((clientX - box.left) / box.width) * grid.cols),
      y: Math.floor(((clientY - box.top) / box.height) * grid.rows),
    };
  };

  const startDrag = (e: ReactPointerEvent, index: number, handle: Handle) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    onSelect(index);
    onBeginEdit();
    const box = overlay.current!.getBoundingClientRect(),
      cw = box.width / grid.cols,
      ch = box.height / grid.rows,
      start = layout.items[index].rect,
      sx = e.clientX,
      sy = e.clientY;
    const move = (ev: PointerEvent) => {
      const dx = Math.round((ev.clientX - sx) / cw),
        dy = Math.round((ev.clientY - sy) / ch),
        r = { ...start };
      if (handle === 'move') {
        r.x += dx;
        r.y += dy;
      } else {
        // Corner handles: the opposite corner stays put.
        if (handle.includes('w')) {
          r.x = Math.min(start.x + dx, start.x + start.w - 1);
          r.w = start.x + start.w - r.x;
        } else r.w = Math.max(1, start.w + dx);
        if (handle.includes('n')) {
          r.y = Math.min(start.y + dy, start.y + start.h - 1);
          r.h = start.y + start.h - r.y;
        } else r.h = Math.max(1, start.h + dy);
      }
      onRect(index, clampRect(r, grid));
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  return (
    <div
      className="dz-device"
      data-orientation={layout.orientation}
      style={{
        aspectRatio:
          layout.orientation === 'portrait' ? `1 / ${aspect}` : `${aspect} / 1`,
      }}
    >
      <ControllerSurface
        widgets={layoutWidgets(layout)}
        accent={accent}
        portFor={readings.portFor}
        fallback={(w) => <SensorTile widget={w} />}
      >
        <div
          ref={overlay}
          className="dz-overlay"
          data-play={play || undefined}
          style={{ '--cols': grid.cols, '--rows': grid.rows } as CSSProperties}
          onPointerDown={() => onSelect(null)}
          onDragOver={(e) => {
            if (e.dataTransfer.types.includes(DRAG_TYPE)) e.preventDefault();
          }}
          onDrop={(e) => {
            const type = e.dataTransfer.getData(DRAG_TYPE) as WidgetType;
            if (!type) return;
            e.preventDefault();
            const cell = cellAt(e.clientX, e.clientY);
            // Drop so the pointer lands roughly in the new control's middle.
            onDropControl(type, { x: cell.x - 2, y: cell.y - 2 });
          }}
        >
          <div className="dz-menu" style={pct(menuRect(layout), grid)}>
            menu
          </div>
          {layout.items.map((item, i) => (
            <div
              key={`${item.name}-${i}`}
              className="dz-item"
              data-selected={selected === i || undefined}
              data-invalid={invalid.has(i) || undefined}
              style={pct(item.rect, grid)}
              onPointerDown={(e) => startDrag(e, i, 'move')}
            >
              <span className="dz-item__tag">
                {item.name}
                {item.rotation ? ` · ${item.rotation}°` : ''}
              </span>
              {selected === i && (
                <>
                  {(['nw', 'ne', 'sw', 'se'] as const).map((h) => (
                    <span
                      key={h}
                      className={`dz-handle dz-handle--${h}`}
                      onPointerDown={(e) => startDrag(e, i, h)}
                    />
                  ))}
                  <span
                    className="dz-item__tools"
                    onPointerDown={(e) => e.stopPropagation()}
                  >
                    <button
                      type="button"
                      aria-label="Rotate 90°"
                      title="Rotate 90° (R)"
                      onClick={() => onRotate(i)}
                    >
                      <RotateCw />
                    </button>
                    <button
                      type="button"
                      aria-label="Remove"
                      title="Remove (Delete)"
                      onClick={() => onRemove(i)}
                    >
                      <Trash2 />
                    </button>
                  </span>
                </>
              )}
            </div>
          ))}
        </div>
      </ControllerSurface>
    </div>
  );
}
