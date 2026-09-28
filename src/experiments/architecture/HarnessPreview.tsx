'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usesPressSlot } from '../../controls/registry.ts';
import type { Point, RoundProgress, RoundSnapshot } from './api.ts';
import { games } from './catalog.ts';
import { ControllerProbe } from './ControllerProbe.tsx';
import { GameHarness } from './harness.ts';
import { createPresenter } from '../../client/game-screen/presenter.ts';
import { driveSimulatedPlayers } from './simulation.ts';
import { SessionProgress } from './session.ts';
import './harness.css';

interface View {
  time: number;
  phase: string;
  error: string | null;
  snapshot: RoundSnapshot<object> | null;
  progress: RoundProgress;
  connected: boolean[];
  controls: string[];
}

export function HarnessPreview() {
  const [gameId, setGameId] = useState(games[0].id);
  const [mode, setMode] = useState(games[0].defaultMode);
  const selected = games.find((game) => game.id === gameId)!;
  const [motion, setMotion] = useState(false);
  const [remoteDelay, setRemoteDelay] = useState(80);
  const [run, setRun] = useState(0);
  const [paused, setPaused] = useState(false);
  const [session] = useState(() => new SessionProgress());
  const [view, setView] = useState<View | null>(null);
  const hostCanvas = useRef<HTMLCanvasElement>(null);
  const remoteCanvas = useRef<HTMLCanvasElement>(null);
  const harness = useRef<GameHarness | null>(null);
  const running = useRef(true);
  const mouse = useRef<Point | undefined>(undefined);
  const refresh = useRef<() => void>(() => {});

  useEffect(() => {
    let alive = true;
    const descriptor = games.find((game) => game.id === gameId)!;
    let instance: GameHarness;
    try {
      instance = new GameHarness(descriptor, {
        progress: session,
        mode,
        motion,
        remoteDelay,
        presentationDelay: Math.max(160, remoteDelay + 80),
      });
    } catch (error) {
      queueMicrotask(() => {
        if (alive)
          setView({
            time: 0,
            phase: 'error',
            error: String(error),
            snapshot: null,
            progress: { revision: 0, totals: {}, awards: {} },
            connected: [],
            controls: [],
          });
      });
      return () => {
        alive = false;
      };
    }
    harness.current = instance;
    mouse.current = undefined;
    const preference = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    let reducedMotion = preference?.matches ?? false;
    const updateMotionPreference = () => {
      reducedMotion = preference?.matches ?? false;
    };
    preference?.addEventListener('change', updateMotionPreference);
    const host = createPresenter([descriptor]),
      remote = createPresenter([descriptor]);
    let stopped = false,
      ready = false,
      raf = 0,
      last = 0,
      accumulated = 0,
      lastView = -100;
    const render = () => {
      const at = instance.time - instance.presentationDelay;
      const draw = (
        canvas: HTMLCanvasElement | null,
        presenter: typeof host,
        venue: 'host' | 'remote',
      ) => {
        const context = canvas?.getContext('2d');
        if (!canvas || !context) return;
        const width = Math.max(
          320,
          Math.round(canvas.getBoundingClientRect().width),
        );
        const height = Math.round((width * 9) / 16);
        const ratio = Math.min(2, window.devicePixelRatio || 1);
        if (
          canvas.width !== Math.round(width * ratio) ||
          canvas.height !== Math.round(height * ratio)
        ) {
          canvas.width = Math.round(width * ratio);
          canvas.height = Math.round(height * ratio);
        }
        context.setTransform(ratio, 0, 0, ratio, 0, 0);
        const snapshot = instance.display(venue);
        presenter.render(
          context,
          {
            snapshot,
            presentationTime: at,
            delay: instance.presentationDelay,
            localCursors: instance.localCursors(venue),
            status: snapshot ? 'ready' : instance.error ? 'error' : 'loading',
            message: instance.error,
          },
          width,
          height,
          reducedMotion,
        );
      };
      draw(hostCanvas.current, host, 'host');
      draw(remoteCanvas.current, remote, 'remote');
    };
    refresh.current = () => {
      if (stopped) return;
      render();
      setView({
        time: Math.max(0, instance.time - instance.presentationDelay),
        phase: instance.display('host')?.phase ?? 'loading',
        error: host.error() ?? remote.error() ?? instance.error,
        snapshot: instance.display('host'),
        progress: instance.display('host')?.progress ?? {
          revision: 0,
          totals: {},
          awards: {},
        },
        connected: instance.players.map((player) => player.connected),
        controls: instance.configs[instance.players[0].id].widgets.map(
          (widget) => `${widget.action}: ${widget.type}`,
        ),
      });
    };
    void instance.load().then(() => {
      ready = true;
      refresh.current();
    });
    const frame = (at: number) => {
      if (stopped) return;
      if (ready && running.current && !instance.error) {
        accumulated += last ? Math.min(100, at - last) : 0;
        const steps = Math.floor(accumulated / 20);
        accumulated -= steps * 20;
        if (steps)
          instance.advance(steps * 20, (game) =>
            driveSimulatedPlayers(game, mouse.current),
          );
      }
      last = at;
      render();
      if (at - lastView >= 120) {
        refresh.current();
        lastView = at;
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => {
      alive = false;
      stopped = true;
      cancelAnimationFrame(raf);
      preference?.removeEventListener('change', updateMotionPreference);
      instance.dispose();
      host.dispose();
      remote.dispose();
      harness.current = null;
      refresh.current = () => {};
    };
  }, [gameId, mode, motion, remoteDelay, run, session]);

  const pointAt = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    mouse.current = {
      x: (event.clientX - rect.left) / rect.width,
      y: (event.clientY - rect.top) / rect.height,
    };
    const instance = harness.current;
    if (!instance) return;
    const player = instance.players[0];
    for (const widget of instance.configs[player.id].widgets)
      if (widget.space === 'normalized')
        instance.setValue(player.id, widget.action, mouse.current);
  };

  return (
    <main className="architecture-harness">
      <header>
        <Link href="/">Controlla</Link>
        <h1>Game authoring harness</h1>
        <p>
          Play a simulated round, inspect both displays, and test controller
          configurations.
        </p>
      </header>
      <section
        className="architecture-harness__toolbar"
        aria-label="Harness controls"
      >
        <label>
          Game
          <select
            value={gameId}
            onChange={(event) => {
              const game = games.find(
                (candidate) => candidate.id === event.target.value,
              )!;
              setGameId(game.id);
              setMode(game.defaultMode);
            }}
          >
            {games.map((game) => (
              <option key={game.id} value={game.id}>
                {game.name}
              </option>
            ))}
          </select>
        </label>
        {selected.modes.length > 1 && (
          <label>
            Mode
            <select
              value={mode}
              onChange={(event) => setMode(event.target.value)}
            >
              {selected.modes.map((choice) => (
                <option key={choice.id} value={choice.id}>
                  {choice.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <label>
          Capabilities
          <select
            value={motion ? 'motion' : 'touch'}
            onChange={(event) => setMotion(event.target.value === 'motion')}
          >
            <option value="touch">Touch fallback</option>
            <option value="motion">Motion available (simulated)</option>
          </select>
        </label>
        <label>
          Remote delivery
          <select
            value={remoteDelay}
            onChange={(event) => setRemoteDelay(Number(event.target.value))}
          >
            <option value={80}>80 ms</option>
            <option value={200}>200 ms</option>
          </select>
        </label>
        <button
          type="button"
          onClick={() => {
            running.current = !running.current;
            setPaused(!running.current);
          }}
        >
          {paused ? 'Resume' : 'Pause'}
        </button>
        <button
          type="button"
          onClick={() => {
            harness.current?.advance(20, (game) =>
              driveSimulatedPlayers(game, mouse.current),
            );
            refresh.current();
          }}
        >
          Step 20 ms
        </button>
        <button
          type="button"
          onClick={() => {
            harness.current?.advance(34000, (game) =>
              driveSimulatedPlayers(game, mouse.current),
            );
            refresh.current();
          }}
        >
          Finish round
        </button>
        <button type="button" onClick={() => setRun((value) => value + 1)}>
          New round
        </button>
        <button
          type="button"
          onClick={() => {
            harness.current?.abort();
            refresh.current();
          }}
        >
          Abort
        </button>
      </section>
      <div className="architecture-harness__status" aria-live="polite">
        <strong>
          {view?.phase === 'settling'
            ? 'Finishing round…'
            : (view?.phase ?? 'loading')}
        </strong>
        <span>{((view?.time ?? 0) / 1000).toFixed(1)} s</span>
        <span>{view?.controls.join(' · ')}</span>
        <span>
          Common presentation delay: {Math.max(160, remoteDelay + 80)} ms
        </span>
      </div>
      {view?.error && (
        <p role="alert" className="architecture-harness__error">
          {view.error}
        </p>
      )}
      <div className="architecture-harness__screens">
        <section>
          <h2>Host display</h2>
          <p>
            Move here to aim as Ada; click to use the action. Own-venue cursors
            update immediately.
          </p>
          <canvas
            ref={hostCanvas}
            width={1600}
            height={900}
            aria-label="Host game preview"
            onPointerMove={pointAt}
            onPointerDown={(event) => {
              pointAt(event);
              const instance = harness.current;
              if (!instance) return;
              const player = instance.players[0];
              const action = instance.configs[player.id].widgets.find(
                (widget) => usesPressSlot(widget.type),
              );
              if (action) instance.press(player.id, action.action);
            }}
            onPointerLeave={() => {
              mouse.current = undefined;
            }}
          />
        </section>
        <section>
          <h2>Remote display</h2>
          <p>
            Receives delayed snapshots and renders the same authority timeline.
          </p>
          <canvas
            ref={remoteCanvas}
            width={1600}
            height={900}
            aria-label="Remote game preview"
          />
        </section>
      </div>
      <section className="architecture-harness__players">
        <h2>Simulated players</h2>
        {['Ada', 'Bea', 'Cy'].map((name, index) => (
          <button
            key={name}
            type="button"
            onClick={() => {
              const instance = harness.current,
                player = instance?.players[index];
              if (!instance || !player) return;
              if (player.connected) instance.disconnect(player.id);
              else instance.reconnect(player.id);
              refresh.current();
            }}
          >
            {view?.connected[index] === false ? 'Reconnect' : 'Disconnect'}{' '}
            {name}
          </button>
        ))}
      </section>
      <div className="architecture-harness__details">
        <section>
          <h2>Session progress</h2>
          <p>One point per opponent placed below you. Ties share awards.</p>
          <pre>{JSON.stringify(view?.progress ?? {}, null, 2)}</pre>
        </section>
        <section>
          <h2>Rendered snapshot</h2>
          <p>This is a display copy of the game-owned state.</p>
          <pre>{JSON.stringify(view?.snapshot?.state ?? {}, null, 2)}</pre>
        </section>
      </div>
      <ControllerProbe />
    </main>
  );
}
