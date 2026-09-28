'use client';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { RotateCcw } from 'lucide-react';
import { ControllerSurface } from '../controls/ControllerSurface.tsx';
import { LegacyWidget } from './LegacyWidget.tsx';
import { ControllerMenu, StatusToast } from './ControllerMenu.tsx';
import type {
  ShellView,
  PhoneActions,
  MotionDiagnosticsPort,
} from './ports.ts';
import type { AppExtensions } from './extensions.ts';

export function ControllerScreen({
  view: v,
  phone,
  motion,
  exportSummary,
  leave,
  panel,
}: {
  view: ShellView;
  phone: PhoneActions;
  motion: MotionDiagnosticsPort;
  exportSummary(this: void): void;
  leave(this: void): void;
  panel?: AppExtensions['controllerPanel'];
}) {
  const [panelOpen, setPanelOpen] = useState(false);
  const Panel = panel?.Component;
  const me = v.identity!;
  useEffect(() => {
    const cancel = (e: TouchEvent) => e.preventDefault();
    document.addEventListener('touchmove', cancel, { passive: false });
    const previous = document.body.style.overscrollBehavior;
    document.body.style.overscrollBehavior = 'none';
    return () => {
      document.removeEventListener('touchmove', cancel);
      document.body.style.overscrollBehavior = previous;
    };
  }, []);

  const accent = v.roster.players.find((p) => p.id === me.id)?.color,
    menu = (
      <ControllerMenu
        view={v}
        phone={phone}
        corner={v.config?.menu ?? 'top-right'}
        extraAction={
          panel
            ? { label: panel.label, run: () => setPanelOpen(true) }
            : undefined
        }
        leave={leave}
      />
    );
  return (
    <main className="controller ctl-scope">
      {v.ended ? (
        <div className="calibrate">
          <h1>Thanks for playing.</h1>
          <p>{v.warning}</p>
          <Button className="action" onClick={() => exportSummary()}>
            Save results
          </Button>
          <Button className="action" onClick={leave}>
            Join another room
          </Button>
        </div>
      ) : panelOpen && Panel ? (
        <Panel motion={motion} onClose={() => setPanelOpen(false)} />
      ) : v.adjustingAim ? (
        <div className="calibrate">
          <span className="eyebrow lime">AIM SETTINGS</span>
          <h1>Adjust your aim.</h1>
          <p className="note">
            Hold your phone flat like a remote, screen facing up. Swivel its top
            edge left or right to move sideways; tip the top edge up or down to
            move vertically. Slow turns are precise; quick flicks go further.
            Push past an edge to re-center.
          </p>
          <div className="sensitivity">
            <span id="sensitivity">Sensitivity</span>
            <Slider
              aria-labelledby="sensitivity"
              min={v.sensitivityRange.min}
              max={v.sensitivityRange.max}
              step={0.1}
              value={[v.sensitivity]}
              onValueChange={(value) =>
                phone.setSensitivity(Array.isArray(value) ? value[0] : value)
              }
            />
            <div className="sensitivity-ends">
              <span>More movement</span>
              <span>Less movement</span>
            </div>
          </div>
          <Button variant="outline" onClick={() => phone.recenter()}>
            <RotateCcw />
            Recenter
          </Button>
          {panel && (
            <Button variant="outline" onClick={() => setPanelOpen(true)}>
              {panel.label}
            </Button>
          )}
          <Button className="action" onClick={() => phone.finishAdjustAim()}>
            Done
          </Button>
        </div>
      ) : !v.config ? (
        <div className="controller-waiting">
          <p className="note">Waiting for your controller layout…</p>
          {menu}
        </div>
      ) : (
        <ControllerSurface
          key={`${v.config.configId}:${v.config.generation}:${v.inputEpoch}`}
          widgets={v.config.widgets}
          accent={accent}
          portFor={(w) => phone.portFor(w, v.config!.generation)}
          fallback={(w) => (
            <LegacyWidget
              widget={w}
              port={phone.portFor(w, v.config!.generation)}
              previewPoint={phone.previewPoint}
              sensorHz={v.sensorHz}
            />
          )}
        >
          {menu}
        </ControllerSurface>
      )}
      {!v.ended && <StatusToast view={v} />}
    </main>
  );
}
