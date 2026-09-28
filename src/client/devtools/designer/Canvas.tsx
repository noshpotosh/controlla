'use client';
// The designer's phone: the real ControllerSurface, with an editing overlay
// (grid, menu corner, drag/resize handles, alignment guides) laid exactly
// over its grid.
import {
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { RotateCw, Trash2 } from 'lucide-react';
import type {
  WidgetType,
  ControllerLayout,
  GridRect,
} from '../../controls/api.ts';
import { ControllerSurface } from '../../controls/ControllerSurface.tsx';
import type { useReadings } from '../gallery/readings.tsx';

import { menuRect, needsRecenter } from '../../controls/layout/schema.ts';
import { layoutWidgets } from '../../controls/layout/widgets.ts';
import { SensorTile } from '../../controls/SensorTile.tsx';
import {
  alignmentGuides,
  clampRect,
  resizeRect,
  type Guides,
  type ResizeHandle,
} from './model.ts';

export const DRAG_TYPE = 'application/x-controlla-control';

type Handle = 'move' | ResizeHandle;

const HANDLES: readonly ResizeHandle[] = [
  'nw',
  'n',
  'ne',
  'e',
  'se',
  's',
  'sw',
  'w',
];

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
  warned,
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
  /** Items that work but are smaller than recommended. */
  warned: Set<number>;
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
    [drag, setDrag] = useState<{ index: number; guides: Guides } | null>(null),
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
    const others = layout.items
      .filter((_, i) => i !== index)
      .map((item) => item.rect);
    const move = (ev: PointerEvent) => {
      const dx = Math.round((ev.clientX - sx) / cw),
        dy = Math.round((ev.clientY - sy) / ch),
        rect =
          handle === 'move'
            ? clampRect({ ...start, x: start.x + dx, y: start.y + dy }, grid)
            : // The opposite edge stays put; ⇧ keeps the proportions.
              resizeRect(start, handle, dx, dy, grid, {
                lockAspect: ev.shiftKey,
              });
      setDrag({ index, guides: alignmentGuides(rect, others, grid) });
      onRect(index, rect);
    };
    setDrag({ index, guides: alignmentGuides(start, others, grid) });
    const up = () => {
      setDrag(null);
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
            {needsRecenter(layout.motion) ? 'menu · recenter' : 'menu'}
          </div>
          {drag?.guides.x.map((x) => (
            <span
              key={`x${x}`}
              className="dz-guide dz-guide--x"
              style={{ left: `${(x / grid.cols) * 100}%` }}
            />
          ))}
          {drag?.guides.y.map((y) => (
            <span
              key={`y${y}`}
              className="dz-guide dz-guide--y"
              style={{ top: `${(y / grid.rows) * 100}%` }}
            />
          ))}
          {layout.items.map((item, i) => (
            <div
              key={`${item.name}-${i}`}
              className="dz-item"
              data-selected={selected === i || undefined}
              data-invalid={invalid.has(i) || undefined}
              data-warn={warned.has(i) || undefined}
              data-dragging={drag?.index === i || undefined}
              style={pct(item.rect, grid)}
              onPointerDown={(e) => startDrag(e, i, 'move')}
            >
              <span className="dz-item__tag">
                {item.name}
                {item.rotation ? ` · ${item.rotation}°` : ''}
              </span>
              {drag?.index === i && (
                <span className="dz-item__size">
                  {item.rect.w}×{item.rect.h}
                </span>
              )}
              {selected === i && (
                <>
                  {HANDLES.map((h) => (
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
