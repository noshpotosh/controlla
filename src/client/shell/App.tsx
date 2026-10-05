'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { createSession } from './runtime-adapter.ts';
import { JoinScreen } from './JoinScreen.tsx';
import { ConnectedShell } from './ConnectedShell.tsx';
import { GameCanvas } from '../GameCanvas.tsx';
import { games } from '../minigames/catalog.ts';
import type { AppExtensions } from './extensions.ts';
import type {
  GameChoice,
  JoinRequest,
  SessionPort,
  ShellSession,
} from './ports.ts';

// Selection needs metadata only; factories stay at the composition boundary.
const choices: readonly GameChoice[] = games.map(
  ({
    id,
    name,
    players,
    durationMs,
    durationLabel,
    modes,
    defaultMode,
    instructions,
  }) => ({
    id,
    name,
    players,
    durationMs,
    durationLabel,
    modes,
    defaultMode,
    instructions,
  }),
);

export default function App({ extensions }: { extensions?: AppExtensions }) {
  const [session, setSession] = useState<ShellSession | null>(null);
  const [request, setRequest] = useState<JoinRequest | null>(null);
  const [error, setError] = useState('');
  const sessionRef = useRef<ShellSession | null>(null);
  useEffect(() => () => sessionRef.current?.close(), []);
  const port = useMemo<SessionPort | null>(
    () =>
      session
        ? {
            getSnapshot: session.getSnapshot,
            subscribe: session.subscribe,
            room: session.room,
            host: session.host,
            phone: session.phone,
            motion: session.motion,
          }
        : null,
    [session],
  );
  function join(next: JoinRequest) {
    if (sessionRef.current) return;
    setRequest(next);
    try {
      const joined = createSession(next);
      sessionRef.current = joined;
      setSession(joined);
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }
  function leave() {
    sessionRef.current?.close();
    sessionRef.current = null;
    setSession(null);
  }
  return session && port ? (
    <ConnectedShell
      session={port}
      games={choices}
      screen={<GameCanvas port={session.screen} />}
      leave={leave}
      extensions={extensions}
    />
  ) : (
    <JoinScreen
      initial={request}
      onJoin={join}
      error={error}
      navigation={extensions?.homeNavigation}
    />
  );
}
