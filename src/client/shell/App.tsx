'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  createSession,
  forgetTab,
  savedVenue,
  tabIdentity,
} from './runtime-adapter.ts';
import { JoinScreen } from './JoinScreen.tsx';
import { ConnectedShell } from './ConnectedShell.tsx';
import { GameCanvas } from '../GameCanvas.tsx';
import { games } from '../minigames/catalog.ts';
import {
  parseJoinPath,
  roomPath,
  signalEndpoint,
  type JoinPath,
} from './join-link.ts';
import type { AppExtensions } from './extensions.ts';
import type {
  GameChoice,
  JoinRequest,
  SessionPort,
  ShellSession,
} from './ports.ts';

// Selection needs metadata only; factories stay at the composition boundary.
const choices: readonly GameChoice[] = games.map(
  ({ id, name, players, durationMs, modes, defaultMode, instructions }) => ({
    id,
    name,
    players,
    durationMs,
    modes,
    defaultMode,
    instructions,
  }),
);

export default function App({ extensions }: { extensions?: AppExtensions }) {
  const [session, setSession] = useState<ShellSession | null>(null);
  const [request, setRequest] = useState<JoinRequest | null>(null);
  const [error, setError] = useState('');
  const [path, setPath] = useState<JoinPath | null>(null);
  const sessionRef = useRef<ShellSession | null>(null);
  useEffect(() => () => sessionRef.current?.close(), []);
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
  function open(next: string) {
    history.pushState(null, '', next + location.search);
    setPath(parseJoinPath(next));
    setError('');
  }
  function leave() {
    const joined = !!sessionRef.current?.getSnapshot().identity;
    sessionRef.current?.close();
    sessionRef.current = null;
    setSession(null);
    forgetTab();
    // After playing, start over from home; a join that never got in retries here.
    if (joined) open('/');
  }
  useEffect(() => {
    const read = () => setPath(parseJoinPath(location.pathname));
    queueMicrotask(read);
    addEventListener('popstate', read);
    return () => removeEventListener('popstate', read);
  }, []);
  // A reloaded tab rejoins as the screen or phone it was, skipping the questions.
  useEffect(() => {
    const room = path?.room;
    if (!room || sessionRef.current) return;
    const saved = tabIdentity(room);
    if (saved)
      queueMicrotask(() =>
        join({
          role: saved.role,
          room,
          venue: saved.venueId,
          name: '',
          endpoint: signalEndpoint(location),
          resume: true,
        }),
      );
  }, [path]);
  // Once joined, the address bar holds this device's own link, so a reload
  // (or a copied URL) lands on the same room and screen.
  useEffect(() => {
    if (!session) return;
    const sync = () => {
      const v = session.getSnapshot(),
        me = v.identity;
      if (!me) return;
      const screen =
        me.role === 'controller'
          ? v.roster.venues.find((venue) => venue.id === me.venueId)?.index
          : undefined;
      if (me.role === 'controller' && !screen) return;
      const next = roomPath(me.room, screen);
      if (location.pathname !== next)
        history.replaceState(history.state, '', next + location.search);
    };
    sync();
    return session.subscribe(sync);
  }, [session]);
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
      path={path}
      initial={request}
      onJoin={join}
      onOpen={open}
      savedScreen={(room) => savedVenue('display', room)}
      error={error}
      navigation={extensions?.homeNavigation}
    />
  );
}
