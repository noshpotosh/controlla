'use client';
import { useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Radio,
  Monitor,
  Gamepad2,
  ArrowUpRight,
  Sparkles,
  Zap,
} from 'lucide-react';
import type { JoinRequest, Role } from './ports.ts';

export function JoinScreen({
  initial,
  error,
  navigation,
  onJoin,
}: {
  initial: JoinRequest | null;
  error: string;
  navigation?: ReactNode;
  onJoin(this: void, request: JoinRequest): void;
}) {
  const [role, setRole] = useState<Role>(initial?.role ?? 'host'),
    [room, setRoom] = useState(initial?.room ?? ''),
    [venue, setVenue] = useState(initial?.venue ?? ''),
    [name, setName] = useState(initial?.name ?? ''),
    [endpoint, setEndpoint] = useState(initial?.endpoint ?? ''),
    [resume, setResume] = useState(initial?.resume ?? true);
  useEffect(() => {
    if (initial) return;
    let mounted = true;
    queueMicrotask(() => {
      if (!mounted) return;
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
    return () => {
      mounted = false;
    };
  }, [initial]);
  const join = () => onJoin({ role, room, venue, name, endpoint, resume });
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
        {navigation}
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
