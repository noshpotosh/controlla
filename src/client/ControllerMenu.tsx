'use client';
// In-game chrome for the phone. The controller layout owns the whole screen;
// everything else lives behind one floating button in the layout's reserved
// corner, plus short status toasts.
import { useEffect, useState } from 'react';
import { Crosshair, Menu, RotateCcw, X } from 'lucide-react';
import type { MenuCorner } from '../controls/api.ts';
import type { Runtime } from './runtime.ts';

export function ControllerMenu({
  runtime,
  corner,
  extraAction,
  leave,
}: {
  runtime: Runtime;
  corner: MenuCorner;
  extraAction?: { label: string; run(): void };
  leave: () => void;
}) {
  const [open, setOpen] = useState(false),
    v = runtime.view,
    me = v.identity,
    player = v.roster.players.find((p) => p.id === me?.id),
    pointer = v.config?.sensors.pointer.enabled,
    needsMotion =
      !v.motionEnabled &&
      !!(v.config?.sensors.pointer.enabled || v.config?.sensors.tilt.enabled);
  return (
    <>
      <button
        type="button"
        className="ctl-menu-button"
        data-corner={corner}
        data-alert={needsMotion || !!v.warning || undefined}
        aria-label="Controller menu"
        onClick={() => setOpen(true)}
      >
        <Menu />
      </button>
      {needsMotion && !open && (
        <button
          type="button"
          className="ctl-motion-prompt"
          onClick={() => void runtime.enableMotion()}
        >
          Tap to enable motion
        </button>
      )}
      {open && (
        <dialog open className="ctl-sheet" aria-label="Controller menu">
          <div className="ctl-sheet__head">
            <div>
              <strong style={{ color: player?.color }}>
                {player?.name ?? 'Your controller'}
              </strong>
              <span>
                Room {me?.room} · Screen {me?.venueId.slice(0, 4).toUpperCase()}
              </span>
            </div>
            <button
              type="button"
              className="ctl-sheet__close"
              aria-label="Close menu"
              onClick={() => setOpen(false)}
            >
              <X />
            </button>
          </div>
          <p className="ctl-sheet__status">{statusText(runtime)}</p>
          {v.warning && <p className="ctl-sheet__warning">{v.warning}</p>}
          {!globalThis.isSecureContext && (
            <p className="ctl-sheet__warning">
              Motion requires HTTPS. Touch controls still work.
            </p>
          )}
          <div className="ctl-sheet__actions">
            <button type="button" onClick={() => void runtime.enableMotion()}>
              {v.motionEnabled ? 'Motion enabled' : 'Enable motion'}
            </button>
            {pointer && (
              <>
                <button
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    runtime.beginAdjustAim();
                  }}
                >
                  <Crosshair /> Aim settings
                </button>
                <button type="button" onClick={() => runtime.recenter()}>
                  <RotateCcw /> Recenter
                </button>
              </>
            )}
            {extraAction && (
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  extraAction.run();
                }}
              >
                {extraAction.label}
              </button>
            )}
          </div>
          <p className="ctl-sheet__meta">
            {v.controllerPath === 'direct-to-session'
              ? 'Degraded connection — aiming goes through the host · '
              : ''}
            {v.config?.substitutions.join(' · ') ||
              `${Math.round(v.sensorHz)} motion Hz`}
            {!v.wakeLock ? ' · Keep this screen awake' : ''}
          </p>
          <button type="button" className="ctl-sheet__leave" onClick={leave}>
            Leave room
          </button>
        </dialog>
      )}
    </>
  );
}

export function statusText(runtime: Runtime) {
  const v = runtime.view;
  if (v.ended) return 'Session ended';
  if (v.status !== 'Connected') return v.status;
  if (v.phase === 'countdown') return 'Get ready…';
  if (v.phase === 'running') return 'You’re playing';
  if (v.phase === 'settling') return 'Finishing round…';
  if (v.phase === 'results') return 'Round complete — look at your screen';
  return 'Ready — choose a game on the host screen';
}

/** Shows the status briefly whenever it changes; stays while disconnected. */
export function StatusToast({ runtime }: { runtime: Runtime }) {
  const text = statusText(runtime),
    sticky = runtime.view.status !== 'Connected',
    [dismissed, setDismissed] = useState<string | null>(null);
  useEffect(() => {
    if (sticky) return;
    const t = setTimeout(() => setDismissed(text), 2400);
    return () => clearTimeout(t);
  }, [text, sticky]);
  return sticky || dismissed !== text ? (
    <output className="ctl-toast" aria-live="polite">
      {text}
    </output>
  ) : null;
}
