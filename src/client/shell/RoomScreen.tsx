'use client';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import {
  Gamepad2,
  ArrowUpRight,
  Maximize,
  Copy,
  Activity,
  Download,
  Trophy,
} from 'lucide-react';
import { DiagnosticsPanel } from './DiagnosticsPanel.tsx';
import type {
  ShellView,
  RoomActions,
  HostActions,
  GameChoice,
} from './ports.ts';

export function RoomScreen({
  view: v,
  actions,
  host,
  games,
  screen,
  leave,
}: {
  view: ShellView;
  actions: RoomActions;
  host: HostActions | null;
  games: readonly GameChoice[];
  screen: ReactNode;
  leave(this: void): void;
}) {
  const me = v.identity!;
  const [game, setGame] = useState(games[0].id),
    [mode, setMode] = useState(games[0].defaultMode),
    [hud, setHud] = useState(false),
    [copied, setCopied] = useState(false);
  const stage = useRef<HTMLDivElement>(null);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (copyTimer.current) clearTimeout(copyTimer.current);
    };
  }, []);
  async function copy() {
    const url = new URL(location.href);
    url.search = '';
    url.searchParams.set('role', 'controller');
    url.searchParams.set('room', me!.room);
    url.searchParams.set('venue', me!.venueId);
    url.searchParams.set('signal', actions.endpoint);
    try {
      await navigator.clipboard.writeText(url.href);
      if (!mounted.current) return;
      setCopied(true);
      if (copyTimer.current) clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      if (!mounted.current) return;
      actions.warn(
        'Clipboard access is unavailable. Use the room and screen codes shown above.',
      );
    }
  }
  const active = v.roster.players.filter((p) => p.connected),
    selected = games.find((choice) => choice.id === game) ?? games[0],
    playing = ['loading', 'countdown', 'running', 'settling'].includes(v.phase),
    standings = v.standings;
  return (
    <main className="shell">
      <header className="topbar">
        <span className="brand">
          controlla<span>●</span>
        </span>
        <span className="eyebrow">
          {me.role === 'host' ? 'HOST SCREEN' : 'VENUE SCREEN'}
        </span>
        <span className="connection">
          <i />
          {v.ended ? 'SESSION ENDED' : v.status.toUpperCase()}
        </span>
      </header>
      <section className="room-head">
        <div>
          <span className="eyebrow">YOUR ROOM</span>
          <h1>
            <span className="code">{me.room}</span>
            <span className="screen-code">
              SCREEN {me.venueId.slice(0, 4).toUpperCase()}
            </span>
          </h1>
          <p className="note">
            Phones join this screen. Other screens join with the room code.
          </p>
        </div>
        <div className="actions">
          <Button
            className="action"
            variant="outline"
            onClick={() => void copy()}
          >
            <Copy />
            {copied ? 'Copied' : 'Copy phone link'}
          </Button>
          <Button
            className="action"
            variant="outline"
            onClick={() => {
              void actions.unlock();
              void stage.current
                ?.requestFullscreen()
                .catch(() =>
                  actions.warn('Fullscreen is not available in this browser.'),
                );
            }}
          >
            <Maximize />
            Fullscreen
          </Button>
        </div>
      </section>
      {v.warning && (
        <p className="error" role="alert">
          {v.warning}
        </p>
      )}
      <div className="play-layout">
        <div>
          <div className="stage" ref={stage}>
            {screen}
          </div>
          <div className="health">
            {v.roster.venues.filter((v) => v.connected).length} screen(s)
            connected · {active.length}/8 players · Shared presentation delay{' '}
            {Math.round(v.D)} ms
          </div>
        </div>
        <aside className="sidebar">
          <h2>
            <Trophy size={18} aria-hidden="true" /> THE CREW{' '}
            <span className="lime">
              / {active.length.toString().padStart(2, '0')}
            </span>
          </h2>
          {v.roster.players.length ? (
            v.roster.players.map((p) => (
              <div className="player" key={p.id}>
                <span
                  className="dot"
                  style={{
                    background: p.color,
                    opacity: p.connected ? 1 : 0.3,
                  }}
                />
                <span>
                  {p.name} · {standings[p.id] ?? 0} pts
                </span>
                <small>
                  {p.connected
                    ? p.venueId === me.id
                      ? 'HERE'
                      : 'REMOTE'
                    : 'OFFLINE'}
                </small>
              </div>
            ))
          ) : (
            <p className="empty">
              The gang’s all… almost here.
              <br />
              Open the phone link or enter the room and screen codes on each
              phone.
            </p>
          )}
          <hr style={{ borderColor: 'var(--border)', margin: '22px 0' }} />
          <p className="note">
            TV? Enable Game Mode.
            <br />
            Keep every screen visible.
            <br />
            Phones and their screen should share Wi-Fi.
          </p>
        </aside>
      </div>
      {host && me.role === 'host' && !v.ended && (
        <>
          <div className="game-options">
            {games.map((descriptor) => (
              <Button
                key={descriptor.id}
                className={
                  'game-option ' + (game === descriptor.id ? 'active' : '')
                }
                disabled={playing}
                onClick={() => {
                  setGame(descriptor.id);
                  setMode(descriptor.defaultMode);
                }}
              >
                <Gamepad2 />
                <span>
                  {descriptor.name}
                  <br />
                  <small>
                    {descriptor.players.min}–{descriptor.players.max} players ·{' '}
                    {descriptor.durationMs / 1000} seconds
                  </small>
                </span>
              </Button>
            ))}
          </div>
          {selected.instructions && (
            <ul className="note" aria-label={`${selected.name} instructions`}>
              {selected.instructions.map((instruction) => (
                <li key={instruction}>{instruction}</li>
              ))}
            </ul>
          )}
          {selected.modes.length > 1 && (
            <div className="mode-row" aria-label={`${selected.name} mode`}>
              {selected.modes.map((choice) => (
                <button
                  key={choice.id}
                  type="button"
                  className={mode === choice.id ? 'active' : ''}
                  disabled={playing}
                  aria-pressed={mode === choice.id}
                  onClick={() => setMode(choice.id)}
                >
                  {choice.name}
                </button>
              ))}
            </div>
          )}
          <div className="actions">
            <Button
              className="action"
              disabled={
                active.length < selected.players.min ||
                active.length > selected.players.max ||
                playing
              }
              onClick={() => {
                void actions.unlock();
                host?.startGame(selected.id, mode);
              }}
            >
              {playing
                ? 'Round in progress'
                : active.length < selected.players.min
                  ? `Connect ${selected.players.min} phones to start`
                  : 'Start round'}
              <ArrowUpRight />
            </Button>
            {playing && (
              <Button variant="outline" onClick={() => host?.abortGame()}>
                Abort round
              </Button>
            )}
            <span className="note">
              {selected.durationMs / 1000} seconds · {selected.name}
            </span>
          </div>
        </>
      )}
      <div className="actions" style={{ margin: '24px 0' }}>
        <Button
          className="action"
          variant="outline"
          onClick={() => setHud(!hud)}
        >
          <Activity />
          {hud ? 'Hide' : 'Show'} diagnostics
        </Button>
        <Button
          className="action"
          variant="outline"
          onClick={() => actions.exportSummary()}
        >
          <Download />
          Save session report
        </Button>
        {v.ended && (
          <Button className="action" onClick={leave}>
            Start again
          </Button>
        )}
      </div>
      {hud && <DiagnosticsPanel view={v} actions={actions} />}
      <footer>
        <span>A LITTLE COMPETITION. A LOT OF GOOD COMPANY.</span>
        <span>
          {v.wakeLock ? 'SCREEN AWAKE' : 'CHECK DISPLAY SLEEP SETTINGS'}
        </span>
      </footer>
    </main>
  );
}
