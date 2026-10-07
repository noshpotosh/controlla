'use client';
// In-game chrome for the phone. The controller layout owns the whole screen;
// everything else lives behind one floating button in the layout's reserved
// corner, plus short status toasts. Aimed motion adds an always-visible
// Recenter button beside it.
import { useEffect, useState } from 'react';
import { Crosshair, Menu, RotateCcw, X } from 'lucide-react';
import type { MenuCorner } from '../controls/api.ts';
import { RecenterButton } from '../controls/kit/RecenterButton.tsx';
import type { ShellView, PhoneActions } from './ports.ts';

export function ControllerMenu({
  view: v,
  phone,
  corner,
  extraAction,
  homeScreenTip = false,
  leave,
}: {
  view: ShellView;
  phone: PhoneActions;
  corner: MenuCorner;
  extraAction?: { label: string; run(): void };
  /** Landscape on a browser that can't hide its toolbar (iPhone Safari). */
  homeScreenTip?: boolean;
  leave: () => void;
}) {
  const [open, setOpen] = useState(false),
    me = v.identity,
    player = v.roster.players.find((p) => p.id === me?.id),
    pointer = v.config?.motion.pointer,
    aimed = !!(pointer || v.config?.motion.tilt),
    needsMotion =
      !v.motionEnabled && !!(v.config?.motion.pointer || v.config?.motion.tilt);
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
      {aimed && v.config && (
        <RecenterButton
          corner={corner}
          orientation={v.config.orientation}
          onRecenter={phone.recenter}
        />
      )}
      {needsMotion && !open && (
        <button
          type="button"
          className="ctl-motion-prompt"
          onClick={() => void phone.enableMotion()}
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
          <p className="ctl-sheet__status">{statusText(v)}</p>
          {v.warning && <p className="ctl-sheet__warning">{v.warning}</p>}
          {!globalThis.isSecureContext && (
            <p className="ctl-sheet__warning">
              Motion requires HTTPS. Touch controls still work.
            </p>
          )}
          <output>{motionStatusText(v.motionStatus, v.motionEnabled)}</output>
          <div className="ctl-sheet__actions">
            <button type="button" onClick={() => void phone.enableMotion()}>
              {v.motionEnabled ? 'Motion permission granted' : 'Enable motion'}
            </button>
            {pointer && (
              <>
                <button
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    phone.beginAdjustAim();
                  }}
                >
                  <Crosshair /> Aim settings
                </button>
              </>
            )}
            {aimed && (
              <button type="button" onClick={() => phone.recenter()}>
                <RotateCcw /> Recenter
              </button>
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
          {homeScreenTip && (
            <p className="ctl-home-screen-tip">
              To hide the browser bar, tap Share, then Add to Home Screen, and
              open Controlla from there.
            </p>
          )}
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

export function statusText(v: ShellView) {
  if (v.ended) return 'Session ended';
  if (v.status !== 'Connected') return v.status;
  if (v.phase === 'countdown') return 'Get ready…';
  if (v.phase === 'running') return 'You’re playing';
  if (v.phase === 'settling') return 'Finishing round…';
  if (v.phase === 'results') return 'Round complete — look at your screen';
  return 'Ready — choose a game on the host screen';
}

/** Shows the status briefly whenever it changes; stays while disconnected. */
export function StatusToast({ view: v }: { view: ShellView }) {
  const text = statusText(v),
    sticky = v.status !== 'Connected',
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

export function motionStatusText(
  status: ShellView['motionStatus'],
  permissionGranted: boolean,
) {
  switch (status) {
    case 'prompt':
      return 'Enable motion to use the phone’s sensors.';
    case 'requesting':
      return 'Waiting for motion permission…';
    case 'waiting':
      return 'Permission granted — waiting for motion samples…';
    case 'active':
      return 'Motion samples available.';
    case 'suspended':
      return 'Motion paused while the controller is inactive.';
    case 'unavailable':
      return permissionGranted
        ? 'Motion unavailable. Available touch fallbacks remain usable; motion returns automatically when samples resume.'
        : 'Motion permission unavailable. Use touch controls, or check browser site settings and enable motion to try again.';
    case 'disposed':
      return 'Motion stopped.';
  }
}
