'use client';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Slider } from '@/components/ui/slider';
import {
  Radio,
  Monitor,
  Gamepad2,
  ArrowUpRight,
  Maximize,
  Copy,
  Activity,
  Download,
  RotateCcw,
  Sparkles,
  Zap,
  Trophy,
} from 'lucide-react';
import { createSession } from './shell/runtime-adapter.ts';
import type {
  ShellSession,
  Role,
  ShellView,
  RoomActions,
} from './shell/ports.ts';
import { LegacyWidget } from './Widgets.tsx';
import { ControllerSurface } from '../controls/ControllerSurface.tsx';
import { ControllerMenu, StatusToast } from './ControllerMenu.tsx';
import { GameCanvas } from './GameCanvas.tsx';
import { games, findGame } from './minigames/catalog.ts';
import type { AppExtensions } from './extensions.ts';
export default function App({ extensions }: { extensions?: AppExtensions }) {
  const [session, setSession] = useState<ShellSession | null>(null),
    [role, setRole] = useState<Role>('host'),
    [room, setRoom] = useState(''),
    [venue, setVenue] = useState(''),
    [name, setName] = useState(''),
    [endpoint, setEndpoint] = useState(''),
    [error, setError] = useState(''),
    [resume, setResume] = useState(true);
  const sessionRef = useRef<ShellSession | null>(null);
  useEffect(() => {
    queueMicrotask(() => {
      const params = new URLSearchParams(location.search);
      const r = params.get('role');
      if (r === 'display' || r === 'controller') setRole(r);
      setRoom(params.get('room') ?? '');
      setVenue(params.get('venue') ?? '');
      setEndpoint(
        params.get('signal') ??
          `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/signal`,
      );
    });
    return () => sessionRef.current?.close();
  }, []);
  function join() {
    try {
      if (sessionRef.current) return;
      const joined = createSession({
        role,
        room,
        venue,
        name,
        endpoint,
        resume,
      });
      sessionRef.current = joined;
      setSession(joined);
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }
  function leave() {
    sessionRef.current?.close();
    sessionRef.current = null;
    setSession(null);
  }
  if (session)
    return (
      <Connected
        session={session}
        screen={<GameCanvas port={session.screen} />}
        leave={leave}
        extensions={extensions}
      />
    );
  return (
    <main className="shell">
      <header className="topbar">
        <Link className="brand" href="/">
          controlla<span>●</span>
        </Link>
        <span className="eyebrow">GOOD COMPANY. GREAT GAMES.</span>
        <span className="connection">
          <i /> READY, PLAYER?
        </span>
        {extensions?.homeNavigation}
      </header>
      <section className="entry">
        <div className="entry-copy">
          <span className="party-badge">
            <Sparkles size={16} /> THE LIVING ROOM ARCADE
          </span>
          <h1>
            Little phones.
            <br />
            <span>Big play energy.</span>
          </h1>
          <p>
            Grab your people. Pick your screen.
            <br />
            Your phone is your ticket to game night.
          </p>
          <div className="facts">
            <span>
              <Monitor /> One screen
            </span>
            <span>
              <Gamepad2 /> 2–8 players
            </span>
            <span>
              <Zap /> All play
            </span>
          </div>
        </div>
        <div className="join-panel">
          <div className="join-heading">
            <span className="eyebrow">LET’S PLAY</span>
            <h2>Pick your seat.</h2>
            <span className="ticket-tag">ADMIT EVERYONE</span>
          </div>
          {[
            {
              id: 'host' as const,
              label: 'Start a room',
              hint: 'This screen runs the game',
              Icon: Radio,
            },
            {
              id: 'display' as const,
              label: 'Join with a screen',
              hint: 'Add another living room',
              Icon: Monitor,
            },
            {
              id: 'controller' as const,
              label: 'Use my phone',
              hint: 'Connect to a screen in your room',
              Icon: Gamepad2,
            },
          ].map(({ id, label, hint, Icon }) => (
            <Button
              key={id}
              className={'role-card ' + (role === id ? 'selected' : '')}
              onClick={() => setRole(id)}
              aria-pressed={role === id}
            >
              <Icon />
              <span>
                <strong>{label}</strong>
                <small>{hint}</small>
              </span>
              <ArrowUpRight />
            </Button>
          ))}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              join();
            }}
            className="join-fields"
          >
            {role !== 'host' && (
              <label className="field" htmlFor="room">
                Room code
                <Input
                  id="room"
                  autoCapitalize="characters"
                  autoComplete="off"
                  value={room}
                  maxLength={6}
                  placeholder="ABCDE"
                  onChange={(e) => setRoom(e.target.value.toUpperCase())}
                  required
                />
              </label>
            )}
            {role === 'controller' && (
              <label className="field" htmlFor="venue">
                Screen code
                <Input
                  id="venue"
                  autoComplete="off"
                  value={venue}
                  placeholder="Shown beside the room code"
                  onChange={(e) => setVenue(e.target.value)}
                  required
                />
              </label>
            )}
            {role !== 'host' && (
              <label className="field" htmlFor="name">
                {role === 'controller' ? 'Your name' : 'Name this screen'}
                <Input
                  id="name"
                  value={name}
                  maxLength={24}
                  placeholder={
                    role === 'controller' ? 'Player name' : 'Living room'
                  }
                  onChange={(e) => setName(e.target.value)}
                  required
                />
              </label>
            )}
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
            <Button type="submit" className="action">
              {role === 'host'
                ? 'Let’s start a room'
                : role === 'display'
                  ? 'Connect this screen'
                  : 'Connect my phone'}{' '}
              <ArrowUpRight />
            </Button>
            <details>
              <summary className="note">Connection settings</summary>
              <label className="field" htmlFor="endpoint">
                Room service address
                <Input
                  id="endpoint"
                  value={endpoint}
                  onChange={(e) => setEndpoint(e.target.value)}
                />
              </label>
              {role !== 'host' && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setResume(!resume)}
                  className="action"
                >
                  {resume
                    ? 'Resume saved identity: on'
                    : 'Join as a new device'}
                </Button>
              )}
            </details>
          </form>
          <p className="setup-note">
            Use Game Mode on your TV. Keep the host screen open for the whole
            session.
          </p>
        </div>
      </section>
      <footer>
        <span>BUILT FOR THE BIG SCREEN. CONTROLLED BY YOU.</span>
        <span>2–8 PLAYERS · 1–8 SCREENS</span>
      </footer>
    </main>
  );
}
function Connected({
  session,
  screen,
  leave,
  extensions,
}: {
  session: ShellSession;
  screen: import('react').ReactNode;
  leave: () => void;
  extensions?: AppExtensions;
}) {
  const [game, setGame] = useState(games[0].id),
    [mode, setMode] = useState(games[0].defaultMode),
    [hud, setHud] = useState(false),
    [copied, setCopied] = useState(false),
    [panelOpen, setPanelOpen] = useState(false);
  const panel = extensions?.controllerPanel;
  const Panel = panel?.Component;
  const motion = session.motion;
  const stage = useRef<HTMLDivElement>(null);
  const v = useSyncExternalStore(
      session.subscribe,
      session.getSnapshot,
      session.getSnapshot,
    ),
    me = v.identity;
  useEffect(() => {
    if (me?.role !== 'controller') return;
    const cancel = (e: TouchEvent) => e.preventDefault();
    document.addEventListener('touchmove', cancel, { passive: false });
    const previous = document.body.style.overscrollBehavior;
    document.body.style.overscrollBehavior = 'none';
    return () => {
      document.removeEventListener('touchmove', cancel);
      document.body.style.overscrollBehavior = previous;
    };
  }, [me?.role]);
  useEffect(() => {
    const context = (
      document as Document & {
        modelContext?: {
          registerTool: (
            tool: unknown,
            options: { signal: AbortSignal },
          ) => void | Promise<void>;
        };
      }
    ).modelContext;
    if (!context?.registerTool) return;
    const abort = new AbortController();
    try {
      void Promise.resolve(
        context.registerTool(
          {
            name: 'read_party_room',
            description:
              'Read the current room, connected players, phase, and diagnostics without exposing resume tokens.',
            inputSchema: {
              type: 'object',
              properties: {},
              additionalProperties: false,
            },
            annotations: { readOnlyHint: true, untrustedContentHint: true },
            execute(input: unknown) {
              if (
                !input ||
                typeof input !== 'object' ||
                Object.keys(input).length
              )
                throw new Error('Expected an empty object');
              return {
                room: session.getSnapshot().identity?.room,
                role: session.getSnapshot().identity?.role,
                roster: session.getSnapshot().roster,
                phase: session.getSnapshot().phase,
                status: session.getSnapshot().status,
                D: session.getSnapshot().D,
              };
            },
          },
          { signal: abort.signal },
        ),
      ).catch(() => {});
    } catch {
      /* Optional browser standard. */
    }
    return () => abort.abort();
  }, [session]);
  if (!me)
    return (
      <main className="shell">
        <header className="topbar">
          <span className="brand">
            controlla<span>●</span>
          </span>
        </header>
        <section className="entry">
          <div>
            <h1>{v.status}</h1>
            <p className="note">Connecting to your room.</p>
            {v.warning && (
              <p className="error" role="alert">
                {v.warning}
              </p>
            )}
            <Button className="action" onClick={leave}>
              Back to setup
            </Button>
          </div>
        </section>
      </main>
    );
  if (me.role === 'controller') {
    const accent = v.roster.players.find((p) => p.id === me.id)?.color,
      menu = (
        <ControllerMenu
          view={v}
          phone={session.phone}
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
            <Button
              className="action"
              onClick={() => session.room.exportSummary()}
            >
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
              Hold your phone flat like a remote, screen facing up. Swivel its
              top edge left or right to move sideways; tip the top edge up or
              down to move vertically. Slow turns are precise; quick flicks go
              further. Push past an edge to re-center.
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
                  session.phone.setSensitivity(
                    Array.isArray(value) ? value[0] : value,
                  )
                }
              />
              <div className="sensitivity-ends">
                <span>More movement</span>
                <span>Less movement</span>
              </div>
            </div>
            <Button variant="outline" onClick={() => session.phone.recenter()}>
              <RotateCcw />
              Recenter
            </Button>
            {panel && (
              <Button variant="outline" onClick={() => setPanelOpen(true)}>
                {panel.label}
              </Button>
            )}
            <Button
              className="action"
              onClick={() => session.phone.finishAdjustAim()}
            >
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
            portFor={(w) => session.phone.portFor(w, v.config!.generation)}
            fallback={(w) => (
              <LegacyWidget
                widget={w}
                port={session.phone.portFor(w, v.config!.generation)}
                previewPoint={session.phone.previewPoint}
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
  async function copy() {
    const url = new URL(location.href);
    url.search = '';
    url.searchParams.set('role', 'controller');
    url.searchParams.set('room', me!.room);
    url.searchParams.set('venue', me!.venueId);
    url.searchParams.set('signal', session.room.endpoint);
    try {
      await navigator.clipboard.writeText(url.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      session.room.warn(
        'Clipboard access is unavailable. Use the room and screen codes shown above.',
      );
    }
  }
  const active = v.roster.players.filter((p) => p.connected),
    selected = findGame(game) ?? games[0],
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
              void session.room.unlock();
              void stage.current
                ?.requestFullscreen()
                .catch(() =>
                  session.room.warn(
                    'Fullscreen is not available in this browser.',
                  ),
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
      {me.role === 'host' && !v.ended && (
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
                void session.room.unlock();
                session.host?.startGame(selected.id, mode);
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
              <Button
                variant="outline"
                onClick={() => session.host?.abortGame()}
              >
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
          onClick={() => session.room.exportSummary()}
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
      {hud && <Diagnostics view={v} actions={session.room} />}
      <footer>
        <span>A LITTLE COMPETITION. A LOT OF GOOD COMPANY.</span>
        <span>
          {v.wakeLock ? 'SCREEN AWAKE' : 'CHECK DISPLAY SLEEP SETTINGS'}
        </span>
      </footer>
    </main>
  );
}
function Diagnostics({
  view: v,
  actions,
}: {
  view: ShellView;
  actions: RoomActions;
}) {
  const t = v.diagnostics;
  return (
    <section className="hud">
      <h2>Path A · Phone → this screen</h2>
      <p>
        Software measurements exclude sensor and panel delay. A P2P route is not
        proof of LAN locality.
      </p>
      <table>
        <thead>
          <tr>
            <th>Peer</th>
            <th>Transport</th>
            <th>ICE types</th>
            <th>RTT</th>
          </tr>
        </thead>
        <tbody>
          {Object.entries(t.links).map(([id, l]) => (
            <tr key={id}>
              <td>
                {v.roster.players.find((p) => p.id === id)?.name ??
                  v.roster.venues.find((p) => p.id === id)?.name ??
                  id.slice(0, 6)}
              </td>
              <td>{l.path}</td>
              <td>
                {l.localCandidate ?? '—'} / {l.remoteCandidate ?? '—'}
              </td>
              <td>{l.rtt == null ? '—' : `${l.rtt.toFixed(1)} ms`}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <h2>Path B · Phone → authority</h2>
      <table>
        <thead>
          <tr>
            <th>Player</th>
            <th>Hz</th>
            <th>Loss</th>
            <th>Age</th>
            <th>p50 / p95 / p99</th>
            <th>Jitter</th>
            <th>Buffer / extrapolation</th>
            <th>Clock error</th>
            <th>Fallback</th>
          </tr>
        </thead>
        <tbody>
          {t?.players?.map((p) => (
            <tr key={p.id}>
              <td>{p.name}</td>
              <td>{p.hz.toFixed(0)}</td>
              <td>{(p.loss * 100).toFixed(1)}%</td>
              <td>{p.age?.toFixed(0) ?? '—'} ms</td>
              <td>
                {p.delay
                  ? [p.delay.p50, p.delay.p95, p.delay.p99]
                      .map((x: number) => x.toFixed(1))
                      .join(' / ')
                  : '—'}
              </td>
              <td>{p.delay?.jitter.toFixed(1) ?? '—'}</td>
              <td>
                {p.buffer.toFixed(1)} / {p.horizon.toFixed(1)} ms
              </td>
              <td>{p.clock?.error?.toFixed(1) ?? '—'} ms</td>
              <td>{p.substitutions.join(', ') || 'none'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p>
        D = {v.D.toFixed(1)} ms · Limiting venue:{' '}
        {v.roster.venues.find((x) => x.id === v.limitingVenue)?.name ??
          'single venue'}{' '}
        · Snapshot starvation events: {t.snapshots.starvations}
      </p>
      <p>
        Last prompt’s software presentation spread:{' '}
        {t?.presentationSpreadMs == null
          ? 'waiting for every screen'
          : `${Number(t.presentationSpreadMs).toFixed(1)} ms`}
        . This excludes panel/compositor delay.
      </p>
      <p>
        Snapshot bytes: {t.snapshots.lastBytes} · Delta/full ratio:{' '}
        {t.snapshots.deltaRatio?.toFixed(2) ?? '—'} · Downstream p95:{' '}
        {t.snapshots.oneWay.p95.toFixed(1)} ms
      </p>
      <table>
        <thead>
          <tr>
            <th>Player</th>
            <th>Control RTT p50 / p95 / p99</th>
            <th>Clock offset</th>
            <th>Pointer confidence</th>
            <th>Sensor Hz</th>
            <th>Recenters</th>
            <th>Controller path</th>
          </tr>
        </thead>
        <tbody>
          {t?.players?.map((p) => (
            <tr key={p.id}>
              <td>{p.name}</td>
              <td>
                {p.clock?.rtt
                  ? [p.clock.rtt.p50, p.clock.rtt.p95, p.clock.rtt.p99]
                      .map((n: number) => n.toFixed(1))
                      .join(' / ')
                  : '—'}
              </td>
              <td>{p.clock?.offset?.toFixed(1) ?? '—'} ms</td>
              <td>{Math.round(p.confidence * 100)}%</td>
              <td>{p.clock?.sensorHz?.toFixed(0) ?? '—'}</td>
              <td>{p.clock?.recenters ?? 0}</td>
              <td>{p.clock?.path ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p>
        Panel latency / Game Mode: unmeasured. Record camera ground truth below;
        this cannot be detected from browser timers.
      </p>
      <label className="field" htmlFor="panel-latency">
        Camera-measured motion-to-photon (ms)
        <Input
          id="panel-latency"
          type="number"
          min={0}
          max={2000}
          placeholder="Not measured"
          value={v.panelLatency ?? ''}
          onChange={(e) =>
            actions.setPanelLatency(
              e.target.value ? Number(e.target.value) : null,
            )
          }
        />
      </label>
    </section>
  );
}
