'use client';
// One link for everyone. `/` starts a game or takes a code; `/K7QMX` works out
// whether this device is a screen or a phone, and which screen a phone faces.
import { useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  ArrowUpRight,
  Gamepad2,
  Monitor,
  MonitorSmartphone,
  Share2,
  Sparkles,
  Wifi,
  Zap,
} from 'lucide-react';
import {
  ROOM_CODE,
  type RoomPreview,
  type ScreenPreview,
} from '../../shared/room.ts';
import {
  arrival,
  chooseScreen,
  isPhoneLike,
  orderScreens,
  roomPath,
  signalEndpoint,
  type JoinPath,
} from './join-link.ts';
import { watchRoom } from './room-watch.ts';
import { ScreenEmblem } from './ScreenEmblem.tsx';
import { shareLink } from './share.ts';
import type { JoinRequest } from './ports.ts';

type Device = 'phone' | 'screen';
const NAME_KEY = 'controlla:name',
  SCREEN_NAME_KEY = 'controlla:screen-name';
function stored(key: string) {
  try {
    return localStorage.getItem(key) ?? '';
  } catch {
    return '';
  }
}
function remember(key: string, value: string) {
  try {
    if (value.trim()) localStorage.setItem(key, value.trim());
  } catch {
    /* Storage is optional. */
  }
}

export function JoinScreen({
  path,
  initial,
  error,
  navigation,
  onJoin,
  onOpen,
  savedScreen,
}: {
  /** The room and screen from the address bar; null until mounted. */
  path: JoinPath | null;
  initial: JoinRequest | null;
  error: string;
  navigation?: ReactNode;
  onJoin(this: void, request: JoinRequest): void;
  /** Move to another in-app address, e.g. `/K7QMX` after typing a code. */
  onOpen(this: void, path: string): void;
  /** The screen this browser last was in a room, to rejoin as it. */
  savedScreen(this: void, room: string): string | null;
}) {
  const [device, setDevice] = useState<Device | null>(null),
    [endpoint, setEndpoint] = useState(initial?.endpoint ?? ''),
    [resume, setResume] = useState(initial?.resume ?? true);
  useEffect(() => {
    let mounted = true;
    queueMicrotask(() => {
      if (!mounted) return;
      setDevice(
        isPhoneLike({
          coarse: matchMedia('(pointer: coarse)').matches,
          shortSide: Math.min(screen.width, screen.height),
        })
          ? 'phone'
          : 'screen',
      );
      setEndpoint((current) => current || signalEndpoint(location));
    });
    return () => {
      mounted = false;
    };
  }, []);
  const room = path?.room;
  const settings = (
    <details className="join-settings">
      <summary className="note">Connection settings</summary>
      <label className="field" htmlFor="endpoint">
        Room service address
        <Input
          id="endpoint"
          value={endpoint}
          onChange={(e) => setEndpoint(e.target.value)}
        />
      </label>
      <Button
        type="button"
        variant="outline"
        onClick={() => setResume(!resume)}
        className="action"
      >
        {resume ? 'Resume saved identity: on' : 'Join as a new device'}
      </Button>
    </details>
  );
  return (
    <main className="shell">
      <header className="topbar">
        <Link className="brand" href="/">
          controlla<span>●</span>
        </Link>
        <span className="eyebrow">GOOD COMPANY. GREAT GAMES.</span>
        <span className="connection">
          <i /> {room ? `ROOM ${room}` : 'READY, PLAYER?'}
        </span>
        {navigation}
      </header>
      <section className={'entry' + (room ? ' entry--room' : '')}>
        <div className="entry-copy">
          <span className="party-badge">
            <Sparkles size={16} /> THE LIVING ROOM ARCADE
          </span>
          {room ? (
            <>
              <h1>
                You’re invited.
                <br />
                <span>Room {room}.</span>
              </h1>
              <p>
                Phones become controllers. TVs and laptops become screens.
                <br />
                One link does both.
              </p>
            </>
          ) : (
            <>
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
            </>
          )}
          <div className="facts">
            <span>
              <Monitor /> One link
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
          {!path || !device || !endpoint ? (
            <p className="note">Getting ready…</p>
          ) : room ? (
            <RoomJoin
              key={`${room}|${endpoint}`}
              room={room}
              hint={path.screen}
              device={device}
              endpoint={endpoint}
              resume={resume}
              initialName={initial?.name}
              savedScreen={savedScreen}
              onJoin={onJoin}
              onOpen={onOpen}
            />
          ) : (
            <StartGame
              device={device}
              endpoint={endpoint}
              onJoin={onJoin}
              onOpen={onOpen}
            />
          )}
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          {settings}
        </div>
      </section>
      <footer>
        <span>BUILT FOR THE BIG SCREEN. CONTROLLED BY YOU.</span>
        <span>2–8 PLAYERS · 1–8 SCREENS</span>
      </footer>
    </main>
  );
}

function StartGame({
  device,
  endpoint,
  onJoin,
  onOpen,
}: {
  device: Device;
  endpoint: string;
  onJoin(this: void, request: JoinRequest): void;
  onOpen(this: void, path: string): void;
}) {
  const [code, setCode] = useState('');
  const valid = ROOM_CODE.test(code),
    phone = device === 'phone';
  const start = (
    <Button
      key="start"
      className="action"
      variant={phone ? 'outline' : 'default'}
      onClick={() =>
        onJoin({
          role: 'host',
          room: '',
          venue: '',
          name: '',
          endpoint,
          resume: false,
        })
      }
    >
      {phone ? 'Start a game on this phone' : 'Start a game on this screen'}
      <ArrowUpRight />
    </Button>
  );
  const enter = (
    <form
      key="enter"
      className="join-fields"
      onSubmit={(e) => {
        e.preventDefault();
        if (valid) onOpen(roomPath(code));
      }}
    >
      <label className="field" htmlFor="room">
        {phone ? 'Room code from the TV' : 'Joining a friend’s game?'}
        <Input
          id="room"
          autoCapitalize="characters"
          autoComplete="off"
          value={code}
          maxLength={6}
          placeholder="ABCDE"
          onChange={(e) =>
            setCode(e.target.value.toUpperCase().replace(/\s/g, ''))
          }
        />
      </label>
      <Button
        type="submit"
        className="action"
        variant={phone ? 'default' : 'outline'}
        disabled={!valid}
      >
        Join room <ArrowUpRight />
      </Button>
    </form>
  );
  return (
    <>
      <div className="join-heading">
        <span className="eyebrow">LET’S PLAY</span>
        <h2>{phone ? 'Got a code?' : 'Host tonight’s games.'}</h2>
        <span className="ticket-tag">ADMIT EVERYONE</span>
      </div>
      {phone ? [enter, start] : [start, enter]}
      <p className="setup-note">
        {phone
          ? 'Or scan the code on the TV with your camera.'
          : 'This screen runs the game. Friends join from the link or code it shows.'}
      </p>
    </>
  );
}

type Mode = 'auto' | 'pick' | 'own';
function RoomJoin({
  room,
  hint,
  device,
  endpoint,
  resume,
  initialName,
  savedScreen,
  onJoin,
  onOpen,
}: {
  room: string;
  hint?: number;
  device: Device;
  endpoint: string;
  resume: boolean;
  initialName?: string;
  savedScreen(this: void, room: string): string | null;
  onJoin(this: void, request: JoinRequest): void;
  onOpen(this: void, path: string): void;
}) {
  const [preview, setPreview] = useState<RoomPreview | null>(null),
    [closed, setClosed] = useState<string | null>(null),
    [as, setAs] = useState<Device>(device);
  useEffect(
    () =>
      watchRoom(endpoint, room, {
        preview: setPreview,
        closed: setClosed,
      }),
    [endpoint, room],
  );
  if (closed !== null)
    return (
      <>
        <div className="join-heading">
          <span className="eyebrow">ROOM {room}</span>
          <h2>This game isn’t running.</h2>
        </div>
        <p className="note">{closed}</p>
        <Button className="action" onClick={() => onOpen('/')}>
          Start a new game <ArrowUpRight />
        </Button>
      </>
    );
  if (!preview) return <p className="note">Finding room {room}…</p>;
  const other = (
    <button
      type="button"
      className="text-link"
      onClick={() => setAs(as === 'phone' ? 'screen' : 'phone')}
    >
      {as === 'phone'
        ? 'This is a TV or laptop — use it as a screen'
        : 'I’m a player — use this as my controller'}
    </button>
  );
  return (
    <>
      {as === 'screen' ? (
        <ScreenJoin
          room={room}
          preview={preview}
          endpoint={endpoint}
          // A screen still connected here belongs to another tab: add a new one.
          resume={
            resume && !preview.screens.some((s) => s.id === savedScreen(room))
          }
          onJoin={onJoin}
        />
      ) : (
        <PhoneJoin
          room={room}
          hint={hint}
          preview={preview}
          endpoint={endpoint}
          resume={resume}
          initialName={initialName}
          onJoin={onJoin}
        />
      )}
      {other}
    </>
  );
}

function ScreenJoin({
  room,
  preview,
  endpoint,
  resume,
  onJoin,
}: {
  room: string;
  preview: RoomPreview;
  endpoint: string;
  resume: boolean;
  onJoin(this: void, request: JoinRequest): void;
}) {
  const [name, setName] = useState(() => stored(SCREEN_NAME_KEY));
  const next =
    Array.from({ length: 8 }, (_, i) => i + 1).find(
      (i) => !preview.screens.some((s) => s.index === i),
    ) ?? 0;
  return (
    <form
      className="join-fields"
      onSubmit={(e) => {
        e.preventDefault();
        remember(SCREEN_NAME_KEY, name);
        onJoin({ role: 'display', room, venue: '', name, endpoint, resume });
      }}
    >
      <div className="join-heading">
        <span className="eyebrow">NEW SCREEN</span>
        <h2>Add this screen to the game.</h2>
      </div>
      <p className="note">
        Phones in this room will scan the code it shows. Everyone plays in the
        same game as {preview.screens[0]?.name ?? 'the host'}.
      </p>
      <label className="field" htmlFor="screen-name">
        Name this screen
        <Input
          id="screen-name"
          value={name}
          maxLength={24}
          placeholder={next ? `Screen ${next}` : 'Living room'}
          onChange={(e) => setName(e.target.value)}
        />
      </label>
      <Button type="submit" className="action" disabled={!next}>
        {next ? 'Add this screen' : 'This room already has eight screens'}
        <ArrowUpRight />
      </Button>
    </form>
  );
}

function PhoneJoin({
  room,
  hint,
  preview,
  endpoint,
  resume,
  initialName,
  onJoin,
}: {
  room: string;
  hint?: number;
  preview: RoomPreview;
  endpoint: string;
  resume: boolean;
  initialName?: string;
  onJoin(this: void, request: JoinRequest): void;
}) {
  const [name, setName] = useState(() => initialName || stored(NAME_KEY)),
    [mode, setMode] = useState<Mode>('auto'),
    [known, setKnown] = useState<ReadonlySet<string>>(new Set()),
    [shared, setShared] = useState('');
  const join = (screen: ScreenPreview) => {
    remember(NAME_KEY, name);
    onJoin({
      role: 'controller',
      room,
      venue: screen.id,
      name,
      endpoint,
      resume,
    });
  };
  const ownScreen = () => {
    setKnown(new Set(preview.screens.map((s) => s.id)));
    setMode('own');
  };
  const nameField = (
    <label className="field" htmlFor="name">
      Your name
      <Input
        id="name"
        value={name}
        maxLength={24}
        placeholder="Player name"
        autoComplete="nickname"
        onChange={(e) => setName(e.target.value)}
      />
    </label>
  );
  if (preview.full)
    return (
      <p className="error" role="alert">
        This room already has eight players.
      </p>
    );
  const choice = chooseScreen(preview.screens, hint);
  if (mode === 'own') {
    const invite = `${location.origin}${roomPath(room)}`,
      found = arrival(preview.screens, known),
      fresh = orderScreens(
        preview.screens.filter((s) => !known.has(s.id) && s !== found),
      );
    return (
      <>
        <div className="join-heading">
          <span className="eyebrow">YOUR OWN SCREEN</span>
          <h2>Open this on your TV or laptop.</h2>
        </div>
        <p className="invite-url">{invite.replace(/^https?:\/\//, '')}</p>
        <Button
          className="action"
          variant="outline"
          onClick={() =>
            void shareLink(invite).then((result) =>
              setShared(
                result === 'copied'
                  ? 'Link copied.'
                  : result === 'failed'
                    ? 'Copy the address above.'
                    : '',
              ),
            )
          }
        >
          <Share2 /> Send the link to my screen
        </Button>
        {shared && <p className="note">{shared}</p>}
        {nameField}
        {found ? (
          <>
            <ScreenOption screen={found} fresh />
            <Button className="action" onClick={() => join(found)}>
              Join on {found.name} <ArrowUpRight />
            </Button>
          </>
        ) : (
          <p className="note waiting">
            Waiting for your screen to join… it’ll show up here.
          </p>
        )}
        {fresh.map((s) => (
          <ScreenOption key={s.id} screen={s} fresh onPick={() => join(s)} />
        ))}
        <button
          type="button"
          className="text-link"
          onClick={() => setMode('pick')}
        >
          Back to the screens in this room
        </button>
      </>
    );
  }
  if (mode === 'auto' && choice.kind !== 'pick') {
    const { screen } = choice;
    return (
      <>
        <div className="join-heading">
          <span className="eyebrow">
            {choice.kind === 'hinted'
              ? 'YOU SCANNED'
              : choice.kind === 'sameNetwork'
                ? 'ON YOUR WI-FI'
                : 'ROOM ' + room}
          </span>
          <h2>
            {choice.kind === 'only'
              ? 'Are you in front of this screen?'
              : 'Join on this screen?'}
          </h2>
        </div>
        <ScreenOption screen={screen} />
        {nameField}
        <Button className="action" onClick={() => join(screen)}>
          {choice.kind === 'only' ? 'Yes, join' : `Join on ${screen.name}`}
          <ArrowUpRight />
        </Button>
        {choice.kind === 'only' ? (
          <Button className="action" variant="outline" onClick={ownScreen}>
            <MonitorSmartphone /> No, I’m using my own screen
          </Button>
        ) : (
          <button
            type="button"
            className="text-link"
            onClick={() => setMode('pick')}
          >
            Somewhere else? Pick another screen
          </button>
        )}
      </>
    );
  }
  return (
    <>
      <div className="join-heading">
        <span className="eyebrow">ROOM {room}</span>
        <h2>Which screen are you playing on?</h2>
      </div>
      <p className="note">Tap the emblem you see on your screen.</p>
      {nameField}
      <div className="screen-options">
        {orderScreens(preview.screens).map((s) => (
          <ScreenOption key={s.id} screen={s} onPick={() => join(s)} />
        ))}
      </div>
      <Button className="action" variant="outline" onClick={ownScreen}>
        <MonitorSmartphone /> My own screen (not listed)
      </Button>
    </>
  );
}

function ScreenOption({
  screen,
  fresh = false,
  onPick,
}: {
  screen: ScreenPreview;
  fresh?: boolean;
  onPick?: () => void;
}) {
  const body = (
    <>
      <ScreenEmblem index={screen.index} />
      <span>
        <strong>{screen.name}</strong>
        <small>
          Screen {screen.index}
          {screen.sameNetwork && (
            <>
              {' · '}
              <span className="badge">
                <Wifi size={13} aria-hidden="true" /> Same Wi-Fi
              </span>
            </>
          )}
          {fresh && ' · New'}
        </small>
      </span>
    </>
  );
  const label = `${screen.name}, screen ${screen.index}${
    screen.sameNetwork ? ', same Wi-Fi' : ''
  }${fresh ? ', new' : ''}`;
  return onPick ? (
    <Button
      className="role-card screen-option"
      aria-label={label}
      onClick={onPick}
    >
      {body}
      <ArrowUpRight />
    </Button>
  ) : (
    <div className="role-card screen-option screen-option--static">{body}</div>
  );
}
