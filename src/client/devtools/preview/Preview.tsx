'use client';
// /?role=preview&layout=<id> — a layout, full screen, with no room.
// Open it on a phone from the designer's QR code: saving in the designer
// hot-reloads this page, so the phone tracks your edits live.
import { useEffect, useState } from 'react';
import { Menu, X } from 'lucide-react';
import { COLORS } from '../../../core/types.ts';
import { layouts } from '../../../layouts/index.ts';
import { ControllerSurface } from '../../../controls/ControllerSurface.tsx';
import { Readout, useReadings } from '../gallery/readings.tsx';
import { layoutWidgets } from '../../../controls/layout/widgets.ts';
import type { Orientation } from '../../../controls/api.ts';
import { MOTION } from '../../../controls/layout/schema.ts';
import { SensorTile } from '../../../controls/SensorTile.tsx';

function useOrientation(): Orientation {
  const query = '(orientation: landscape)';
  const [landscape, setLandscape] = useState(
    () => typeof matchMedia !== 'undefined' && matchMedia(query).matches,
  );
  useEffect(() => {
    const m = matchMedia(query),
      change = () => setLandscape(m.matches);
    m.addEventListener('change', change);
    return () => m.removeEventListener('change', change);
  }, []);
  return landscape ? 'landscape' : 'portrait';
}

export function Preview({ layoutId }: { layoutId: string | null }) {
  // Read through the index on every render: saves hot-reload it.
  const layout = (layoutId && layouts[layoutId]) || null,
    orientation = useOrientation(),
    [panel, setPanel] = useState(false),
    { readings, portFor } = useReadings();
  if (!layout)
    return (
      <main className="ctl-preview-pick ctl-scope">
        <h1>Preview a layout</h1>
        {Object.values(layouts).map((l) => (
          <a key={l.id} href={`?role=preview&layout=${l.id}`}>
            {l.name}
            <small>{l.orientation}</small>
          </a>
        ))}
      </main>
    );
  const widgets = layoutWidgets(layout),
    wrongWay = orientation !== layout.orientation;
  return (
    <main className="controller ctl-scope">
      <ControllerSurface
        widgets={widgets}
        accent={COLORS[0]}
        portFor={portFor}
        fallback={(w) => <SensorTile widget={w} />}
      >
        <button
          type="button"
          className="ctl-menu-button"
          data-corner={layout.menu}
          aria-label="Preview readout"
          onClick={() => setPanel((p) => !p)}
        >
          {panel ? <X /> : <Menu />}
        </button>
      </ControllerSurface>
      {panel && (
        <dialog open className="ctl-sheet" aria-label="Preview readout">
          <div className="ctl-sheet__head">
            <div>
              <strong>{layout.name}</strong>
              <span>
                Preview · {layout.orientation}
                {MOTION.filter((m) => layout.motion[m])
                  .map((m) => ` · ${m}`)
                  .join('')}
              </span>
            </div>
            <button
              type="button"
              className="ctl-sheet__close"
              aria-label="Close"
              onClick={() => setPanel(false)}
            >
              <X />
            </button>
          </div>
          {widgets.map((w) => (
            <div key={w.id} className="ctl-gallery__readout-row">
              <code>{w.action}</code>
              <Readout reading={readings[w.id]} />
            </div>
          ))}
          <button
            type="button"
            className="ctl-sheet__leave"
            onClick={() => location.assign('/?role=preview')}
          >
            Other layouts
          </button>
        </dialog>
      )}
      {wrongWay && <RotatePrompt orientation={layout.orientation} />}
    </main>
  );
}

function RotatePrompt({ orientation }: { orientation: Orientation }) {
  // Android can lock orientation once fullscreen; iOS can't, so it just asks.
  const canLock =
    typeof document !== 'undefined' &&
    !!document.documentElement.requestFullscreen &&
    'orientation' in screen;
  return (
    <div className="ctl-rotate">
      <div className="ctl-rotate__phone" data-orientation={orientation} />
      <p>Turn your phone to {orientation}</p>
      {canLock && (
        <button
          type="button"
          onClick={async () => {
            try {
              await document.documentElement.requestFullscreen();
              const lock = (
                screen.orientation as ScreenOrientation & {
                  lock?: (o: string) => Promise<void>;
                }
              ).lock;
              await lock?.call(screen.orientation, orientation);
            } catch {
              /* Not supported here; the prompt stays. */
            }
          }}
        >
          Go fullscreen
        </button>
      )}
    </div>
  );
}
