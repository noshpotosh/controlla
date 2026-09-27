'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import type { Message } from '../core/types.ts';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Slider } from '@/components/ui/slider';
import { MAX_GAIN, MIN_GAIN } from '../core/calibration.ts';
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
  Crosshair,
  Sparkles,
  Zap,
  Trophy,
} from 'lucide-react';
import { Runtime, type JoinOptions } from './runtime.ts';
import { WidgetControl } from './Widgets.tsx';
import { GameCanvas } from './GameCanvas.tsx';
import type { Identity, Role } from '../core/types.ts';
const cornerCount = (mask: number) =>
  [1, 2, 4, 8].filter((bit) => mask & bit).length;
function getResume(role: Role, room: string, venue: string) {
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)!;
      if (key.startsWith(`controlla:resume:${role}:${room.toUpperCase()}:`)) {
        const identity = JSON.parse(localStorage.getItem(key)!) as Identity;
        if (
          !venue ||
          identity.venueId === venue ||
          identity.venueId.startsWith(venue.toLowerCase())
        )
          return identity.token;
      }
    }
  } catch {
    /* Storage is optional. */
  }
  return undefined;
}
export default function App() {
  const [runtime, setRuntime] = useState<Runtime | null>(null),
    [role, setRole] = useState<Role>('host'),
    [room, setRoom] = useState(''),
    [venue, setVenue] = useState(''),
    [name, setName] = useState(''),
    [endpoint, setEndpoint] = useState(''),
    [error, setError] = useState(''),
    [resume, setResume] = useState(true);
  const runtimeRef = useRef<Runtime | null>(null);
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
    return () => runtimeRef.current?.close();
  }, []);
  function join() {
    try {
      if (
        role !== 'host' &&
        !/^[23456789ABCDEFGHJKMNPQRSTVWXYZ]{4,6}$/i.test(room.trim())
      )
        throw new Error('Enter the room code shown on the screen.');
      if (role === 'controller' && !venue)
        throw new Error(
          'Open the room on a screen first, then enter its screen code or open its phone link.',
        );
      const url = new URL(endpoint);
      if (!['ws:', 'wss:'].includes(url.protocol))
        throw new Error('Room service address must start with ws:// or wss://');
      const options: JoinOptions = {
        role,
        room: room.toUpperCase().trim(),
        venueId: venue.trim(),
        name,
        endpoint,
        token:
          role !== 'host' && resume ? getResume(role, room, venue) : undefined,
      };
      const r = new Runtime(options);
      runtimeRef.current = r;
      setRuntime(r);
      r.start();
      void r.unlock();
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }
  function leave() {
    runtimeRef.current?.close();
    runtimeRef.current = null;
    setRuntime(null);
  }
  if (runtime) return <Connected runtime={runtime} leave={leave} />;
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
  runtime,
  leave,
}: {
  runtime: Runtime;
  leave: () => void;
}) {
  const [, redraw] = useState(0),
    [game, setGame] = useState('latency-lab'),
    [mode, setMode] = useState('reaction'),
    [hud, setHud] = useState(false),
    [copied, setCopied] = useState(false);
  const stage = useRef<HTMLDivElement>(null);
  useEffect(() => runtime.subscribe(() => redraw((x) => x + 1)), [runtime]);
  const v = runtime.view,
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
                room: runtime.view.identity?.room,
                role: runtime.view.identity?.role,
                roster: runtime.view.roster,
                phase: runtime.view.state?.phase ?? runtime.view.phase,
                status: runtime.view.status,
                D: runtime.view.D,
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
  }, [runtime]);
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
  if (me.role === 'controller')
    return (
      <main className="controller">
        <header className="controller-head">
          <strong
            style={{
              color: v.roster.players.find((p) => p.id === me.id)?.color,
            }}
          >
            {v.roster.players.find((p) => p.id === me.id)?.name ??
              'Your controller'}
          </strong>
          <span>
            {me.room} / {me.venueId.slice(0, 4).toUpperCase()}
          </span>
        </header>
        <div className="controller-tools">
          <Button
            size="sm"
            variant="outline"
            onClick={() => void runtime.enableMotion()}
          >
            {v.motionEnabled ? 'Motion enabled' : 'Enable motion'}
          </Button>
          {v.config?.sensors.pointer.enabled && (
            <>
              <Button
                size="sm"
                variant="outline"
                onClick={() => runtime.beginCalibration()}
              >
                <Crosshair />
                {v.calibrated ? 'Recalibrate' : 'Calibrate'}
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={!v.calibrated}
                onClick={() => runtime.recenter()}
              >
                <RotateCcw />
                Recenter
              </Button>
            </>
          )}
        </div>
        {v.warning && (
          <p className="error" role="alert">
            {v.warning}
          </p>
        )}
        {!globalThis.isSecureContext && (
          <p className="error">
            Motion requires HTTPS. Touch controls still work.
          </p>
        )}
        <div className="controller-status" aria-live="polite">
          {v.ended
            ? 'Session ended'
            : v.status !== 'Connected'
              ? v.status
              : v.phase === 'countdown'
                ? 'Get ready…'
                : v.phase === 'running'
                  ? 'You’re playing'
                  : v.phase === 'results'
                    ? 'Round complete — look at your screen'
                    : 'Ready — choose a game on the host screen'}
        </div>
        {v.ended ? (
          <div className="calibrate">
            <h1>Thanks for playing.</h1>
            <p>{v.warning}</p>
            <Button className="action" onClick={() => runtime.exportSummary()}>
              Save results
            </Button>
            <Button className="action" onClick={leave}>
              Join another room
            </Button>
          </div>
        ) : v.calibrationStep === 0 ? (
          <div className="calibrate">
            <span className="eyebrow lime">CALIBRATION / 1 OF 2</span>
            <h1>Aim at the center.</h1>
            <p className="note">
              Hold your phone like a remote, screen up. Point its top edge at
              the center of your screen’s game area, then tap below.
            </p>
            <Button
              className="action"
              onClick={() => runtime.captureCalibration()}
            >
              Capture center
            </Button>
          </div>
        ) : v.calibrationStep === 1 ? (
          <div className="calibrate">
            <span className="eyebrow lime">CALIBRATION / 2 OF 2</span>
            <h1>Move your cursor into each corner.</h1>
            <p className="note">
              Sitting far away? Turn sensitivity up so you need less movement.
            </p>
            <div className="sensitivity">
              <span id="sensitivity">Sensitivity</span>
              <Slider
                aria-labelledby="sensitivity"
                min={MIN_GAIN}
                max={MAX_GAIN}
                step={0.1}
                value={[v.sensitivity]}
                onValueChange={(value) =>
                  runtime.setSensitivity(
                    Array.isArray(value) ? value[0] : value,
                  )
                }
              />
              <div className="sensitivity-ends">
                <span>More movement</span>
                <span>Less movement</span>
              </div>
            </div>
            <div
              className="corners"
              aria-label={`${cornerCount(v.cornersReached)} of 4 corners reached`}
            >
              {['top-left', 'top-right', 'bottom-right', 'bottom-left'].map(
                (corner, i) => (
                  <i
                    key={corner}
                    className={`corner ${corner} ${
                      v.cornersReached & (1 << i) ? 'reached' : ''
                    }`}
                  />
                ),
              )}
              <span>{cornerCount(v.cornersReached)}/4</span>
            </div>
            <Button
              className="action"
              disabled={v.cornersReached !== 15}
              onClick={() => runtime.finishCalibration()}
            >
              Done
            </Button>
            <Button variant="outline" onClick={() => runtime.redoCenter()}>
              Redo center
            </Button>
          </div>
        ) : (
          <div
            className="controller-surface"
            key={`${v.config?.configId}:${v.config?.generation}`}
          >
            {v.config?.widgets.map((w) => (
              <WidgetControl key={w.id} widget={w} runtime={runtime} />
            ))}
            {!v.config && (
              <p className="note">Waiting for your controller layout…</p>
            )}
          </div>
        )}
        <div className="controller-bottom">
          {v.controllerPath === 'direct-to-session'
            ? 'Degraded connection — aiming goes through the host · '
            : ''}
          {v.config?.substitutions.join(' · ') ||
            `${Math.round(v.sensorHz)} motion Hz`}
          {!v.wakeLock ? ' · Keep this screen awake' : ''}
        </div>
      </main>
    );
  async function copy() {
    const url = new URL(location.href);
    url.search = '';
    url.searchParams.set('role', 'controller');
    url.searchParams.set('room', me!.room);
    url.searchParams.set('venue', me!.venueId);
    url.searchParams.set('signal', runtime.options.endpoint);
    try {
      await navigator.clipboard.writeText(url.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      runtime.warn(
        'Clipboard access is unavailable. Use the room and screen codes shown above.',
      );
    }
  }
  const active = v.roster.players.filter((p) => p.connected),
    playing = v.state?.phase === 'running' || v.state?.phase === 'countdown';
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
              void runtime.unlock();
              void stage.current
                ?.requestFullscreen()
                .catch(() =>
                  runtime.warn('Fullscreen is not available in this browser.'),
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
            <GameCanvas runtime={runtime} />
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
                <span>{p.name}</span>
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
            <Button
              className={
                'game-option ' + (game === 'latency-lab' ? 'active' : '')
              }
              disabled={playing}
              onClick={() => setGame('latency-lab')}
            >
              <Crosshair />
              <span>
                LATENCY LAB
                <br />
                <small>Aim. React. Test your connection.</small>
              </span>
            </Button>
            <Button
              className={
                'game-option ' + (game === 'tilt-rally' ? 'active' : '')
              }
              disabled={playing}
              onClick={() => setGame('tilt-rally')}
            >
              <Gamepad2 />
              <span>
                TILT RALLY
                <br />
                <small>Steer with motion. Swipe for speed.</small>
              </span>
            </Button>
          </div>
          {game === 'latency-lab' && (
            <div className="mode-row" aria-label="Latency Lab mode">
              {['reaction', 'tracking', 'strobe', 'fairness'].map((m) => (
                <button
                  key={m}
                  type="button"
                  className={mode === m ? 'active' : ''}
                  disabled={playing}
                  aria-pressed={mode === m}
                  onClick={() => setMode(m)}
                >
                  {m.charAt(0).toUpperCase() + m.slice(1)}
                </button>
              ))}
            </div>
          )}
          <div className="actions">
            <Button
              className="action"
              disabled={active.length < 2 || playing}
              onClick={() => {
                void runtime.unlock();
                runtime.startGame(game, game === 'tilt-rally' ? 'rally' : mode);
              }}
            >
              {playing
                ? 'Round in progress'
                : active.length < 2
                  ? 'Connect two phones to start'
                  : 'Start round'}
              <ArrowUpRight />
            </Button>
            <span className="note">
              {game === 'latency-lab'
                ? '30 seconds · Pointer + fire button'
                : '30 seconds · Tilt + swipe'}
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
          onClick={() => runtime.exportSummary()}
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
      {hud && <Diagnostics runtime={runtime} />}
      <footer>
        <span>A LITTLE COMPETITION. A LOT OF GOOD COMPANY.</span>
        <span>
          {v.wakeLock ? 'SCREEN AWAKE' : 'CHECK DISPLAY SLEEP SETTINGS'}
        </span>
      </footer>
    </main>
  );
}
function Diagnostics({ runtime }: { runtime: Runtime }) {
  const v = runtime.view,
    t = v.telemetry;
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
          {Object.entries(v.links).map(([id, l]) => (
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
          {t?.players?.map((p: Message) => (
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
        · Snapshot starvation events: {runtime.buffer.starvations}
      </p>
      <p>
        Last prompt’s software presentation spread:{' '}
        {t?.presentationSpreadMs == null
          ? 'waiting for every screen'
          : `${Number(t.presentationSpreadMs).toFixed(1)} ms`}
        . This excludes panel/compositor delay.
      </p>
      <p>
        Snapshot bytes: {runtime.snapshotMetrics().lastBytes} · Delta/full
        ratio: {runtime.snapshotMetrics().deltaRatio?.toFixed(2) ?? '—'} ·
        Downstream p95: {runtime.snapshotMetrics().oneWay.p95.toFixed(1)} ms
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
          {t?.players?.map((p: Message) => (
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
            runtime.setPanelLatency(
              e.target.value ? Number(e.target.value) : null,
            )
          }
        />
      </label>
    </section>
  );
}
