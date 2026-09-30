'use client';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import {
  Gamepad2,
  ArrowUpRight,
  Maximize,
  Share2,
  Activity,
  Download,
  Trophy,
} from 'lucide-react';
import { DiagnosticsPanel } from './DiagnosticsPanel.tsx';
import { ScreenEmblem } from './ScreenEmblem.tsx';
import { roomPath } from './join-link.ts';
import { publicOrigin } from './public-origin.ts';
import { shareLink } from './share.ts';
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
    [copied, setCopied] = useState(false),
    [origin, setOrigin] = useState<string | null>(null);
  const stage = useRef<HTMLDivElement>(null);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    void publicOrigin().then((found) => {
      if (mounted.current) setOrigin(found);
    });
    return () => {
      mounted.current = false;
      if (copyTimer.current) clearTimeout(copyTimer.current);
    };
  }, []);
  const venue = v.roster.venues.find((x) => x.id === me.venueId),
    index = venue?.index ?? 1,
    invite = origin && `${origin}${roomPath(me.room)}`,
    phoneLink = origin && `${origin}${roomPath(me.room, index)}`;
  async function share() {
    if (!invite) return;
    const result = await shareLink(invite);
    if (!mounted.current) return;
    if (result === 'copied') {
      setCopied(true);
      if (copyTimer.current) clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopied(false), 2000);
    } else if (result === 'failed')
      actions.warn(
        'Clipboard access is unavailable. Read out the invite link shown above.',
      );
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
        <div className="room-id">
          <ScreenEmblem index={index} size={44} />
          <div>
            <span className="eyebrow">
              SCREEN {index} · {(venue?.name ?? '').toUpperCase()}
            </span>
            <h1>
              <span className="code">{me.room}</span>
            </h1>
            <p className="note">
              Friends elsewhere open{' '}
              <strong className="invite-inline">
                {invite?.replace(/^https?:\/\//, '') ?? '…'}
              </strong>{' '}
              on a TV, laptop or phone.
            </p>
          </div>
        </div>
        <div className="room-join">
          {phoneLink && <JoinQr url={phoneLink} />}
          <p className="note">
            <strong>Playing here?</strong>
            <br />
            Scan with your phone’s camera.
          </p>
        </div>
        <div className="actions">
          <Button
            className="action"
            variant="outline"
            disabled={!invite}
            onClick={() => void share()}
          >
            <Share2 />
            {copied ? 'Copied' : 'Share invite link'}
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
              Scan this screen’s code with each phone, or share the invite link.
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

/** Encodes this screen's own link, so scanning it skips every question. */
function JoinQr({ url }: { url: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let live = true;
    void import('qrcode').then(({ default: QRCode }) => {
      if (live && canvas.current)
        void QRCode.toCanvas(canvas.current, url, {
          margin: 1,
          width: 168,
          color: { dark: '#111427', light: '#fff9e8' },
        });
    });
    return () => {
      live = false;
    };
  }, [url]);
  return (
    <canvas
      ref={canvas}
      width={168}
      height={168}
      className="join-qr"
      aria-label={`QR code for ${url}`}
    />
  );
}
