'use client';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { ControllerSettings } from '../controls/motion-views/Settings.tsx';
import { ControllerSurface } from '../controls/ControllerSurface.tsx';
import { useImmersive } from '../controls/kit/immersive.ts';
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
  // Landscape: hide the browser toolbar where the browser allows it.
  const { suggestHomeScreen } = useImmersive(!!v.config && !v.ended);
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
        homeScreenTip={suggestHomeScreen}
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
      ) : v.settingsOpen && v.config ? (
        <ControllerSettings
          key={`${v.config.configId}:${v.config.generation}:${v.inputEpoch}`}
          config={v.config}
          motionPortFor={(widget) =>
            phone.motionPortFor(widget, v.config!.generation)
          }
          onClose={phone.closeSettings}
        />
      ) : v.roundId &&
        ['loading', 'countdown', 'running', 'settling'].includes(v.phase) &&
        v.controllerRoundId !== v.roundId ? (
        <div className="controller-waiting">
          <p className="note">Waiting for the next round…</p>
          {menu}
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
          motionPortFor={(w) => phone.motionPortFor(w, v.config!.generation)}
        >
          {menu}
        </ControllerSurface>
      )}
      {!v.ended && <StatusToast view={v} />}
    </main>
  );
}
