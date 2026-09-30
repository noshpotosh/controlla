import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type {
  Identity,
  Player,
  Role,
  Venue,
  Roster,
  RoomPreview,
} from '../src/shared/room.ts';
import { COLORS, MAX_SCREENS, ROOM_ALPHABET } from '../src/shared/room.ts';
export const ALPHABET = ROOM_ALPHABET;
export interface Member {
  id: string;
  role: Role;
  venueId: string;
  connected: boolean;
  disconnectedAt?: number;
  name: string;
  seat?: number;
  color?: string;
  /** Screens only: 1–8, lowest free when joining, kept across resume. */
  index?: number;
}
export interface Room {
  code: string;
  hostId: string;
  members: Map<string, Member>;
  created: number;
  ended: boolean;
}
export class RoomRegistry {
  rooms = new Map<string, Room>();
  constructor(private secret = randomBytes(32)) {}
  sign(room: string, member: Member) {
    const body = Buffer.from(
      JSON.stringify({
        room,
        id: member.id,
        role: member.role,
        venueId: member.venueId,
        exp: Date.now() + 12 * 3600000,
      }),
    ).toString('base64url');
    return (
      body +
      '.' +
      createHmac('sha256', this.secret).update(body).digest('base64url')
    );
  }
  verify(token: string) {
    const [body, sig, ...extra] = token.split('.');
    if (!body || !sig || extra.length) throw new Error('Invalid resume token');
    const expected = createHmac('sha256', this.secret).update(body).digest(),
      actual = Buffer.from(sig, 'base64url');
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected))
      throw new Error('Invalid resume token');
    const p = JSON.parse(Buffer.from(body, 'base64url').toString());
    if (p.exp < Date.now()) throw new Error('Resume token expired');
    return p;
  }
  join(
    request: {
      role: Role;
      room?: string;
      venueId?: string;
      name?: string;
      token?: string;
    },
    at = Date.now(),
  ): { room: Room; member: Member; identity: Identity } {
    if (!['host', 'display', 'controller'].includes(request.role))
      throw new Error('Choose a screen or a phone');
    let room: Room, member: Member;
    const resumed = request.token && this.resume(request, request.token, at);
    if (resumed) ({ room, member } = resumed);
    else if (request.role === 'host') {
      if (this.rooms.size >= 200)
        throw new Error('The room service is full. Try again shortly.');
      let code = '';
      do {
        code = Array.from(
          randomBytes(5),
          (b) => ALPHABET[b % ALPHABET.length],
        ).join('');
      } while (this.rooms.has(code));
      const id = Buffer.from(randomBytes(12)).toString('hex');
      member = {
        id,
        role: 'host',
        venueId: id,
        connected: true,
        name: 'Host screen',
        index: 1,
      };
      room = {
        code,
        hostId: id,
        members: new Map([[id, member]]),
        created: at,
        ended: false,
      };
      this.rooms.set(code, room);
    } else {
      room = this.find(request.room ?? '');
      // Expired controllers release their seats. Active or grace-period seats stay reserved.
      for (const [id, m] of room.members)
        if (
          m.role === 'controller' &&
          !m.connected &&
          at - (m.disconnectedAt ?? at) > 60000
        )
          room.members.delete(id);
      const id = Buffer.from(randomBytes(12)).toString('hex');
      if (request.role === 'controller') {
        const venue = room.members.get(request.venueId ?? '');
        if (!venue || venue.role === 'controller' || !venue.connected)
          throw new Error(
            'Pick a screen first: scan the code on the screen you’re playing on.',
          );
        const players = [...room.members.values()].filter(
          (m) => m.role === 'controller',
        );
        if (players.length >= 8)
          throw new Error('This room already has eight players.');
        const seat = Array.from({ length: 8 }, (_, i) => i).find(
          (i) => !players.some((p) => p.seat === i),
        )!;
        member = {
          id,
          role: 'controller',
          venueId: venue.id,
          connected: true,
          name:
            (request.name ?? '').trim().slice(0, 24) || `Player ${seat + 1}`,
          seat,
          color: COLORS[seat],
        };
      } else {
        const taken = [...room.members.values()]
          .filter((m) => m.role !== 'controller')
          .map((m) => m.index);
        const index = Array.from({ length: MAX_SCREENS }, (_, i) => i + 1).find(
          (i) => !taken.includes(i),
        );
        if (index === undefined)
          throw new Error('This room already has eight screens.');
        member = {
          id,
          role: 'display',
          venueId: id,
          connected: true,
          name: (request.name ?? '').trim().slice(0, 24) || `Screen ${index}`,
          index,
        };
      }
      room.members.set(id, member);
    }
    return {
      room,
      member,
      identity: {
        id: member.id,
        role: member.role,
        room: room.code,
        venueId: member.venueId,
        token: this.sign(room.code, member),
        hostId: room.hostId,
      },
    };
  }
  /**
   * Reclaims a saved identity. When the request also names a room, a stale
   * one (expired, forged, or from an ended session) just joins afresh: that
   * grants nothing a plain join would not, and saves a dead-end retry.
   */
  private resume(
    request: { role: Role; room?: string },
    token: string,
    at: number,
  ): { room: Room; member: Member } | null {
    try {
      const p = this.verify(token);
      const room = this.rooms.get(p.room);
      if (!room || room.ended)
        throw new Error('This session has ended. Start a new room.');
      const member = room.members.get(p.id);
      if (
        !member ||
        member.role !== request.role ||
        p.venueId !== member.venueId
      )
        throw new Error('Invalid resume identity');
      if (!member.connected && at - (member.disconnectedAt ?? at) > 60000)
        throw new Error('Your reserved seat expired. Join again.');
      member.connected = true;
      delete member.disconnectedAt;
      return { room, member };
    } catch (error) {
      if (request.room && request.role !== 'host') return null;
      throw error;
    }
  }
  /** A live room by its code, ignoring case and surrounding space. */
  find(code: string): Room {
    const room = this.rooms.get(code.trim().toUpperCase());
    if (!room || room.ended)
      throw new Error('Room not found. Check the code on your screen.');
    return room;
  }
  /** Screens a joining phone can pick from, without exposing tokens or addresses. */
  preview(room: Room, sameNetwork: (screenId: string) => boolean): RoomPreview {
    const members = [...room.members.values()];
    return {
      room: room.code,
      screens: members
        .filter((m) => m.role !== 'controller' && m.connected)
        .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
        .map((m) => ({
          id: m.id,
          index: m.index ?? 1,
          name: m.name,
          sameNetwork: sameNetwork(m.id),
        })),
      full: members.filter((m) => m.role === 'controller').length >= 8,
    };
  }
  disconnect(room: Room, id: string, at = Date.now()) {
    const m = room.members.get(id);
    if (!m) return;
    m.connected = false;
    m.disconnectedAt = at;
    if (m.role === 'host') {
      room.ended = true;
      this.rooms.delete(room.code);
    }
  }
  roster(room: Room): Roster {
    const members = [...room.members.values()];
    return {
      players: members
        .filter((m) => m.role === 'controller')
        .map((m) => ({
          id: m.id,
          venueId: m.venueId,
          seat: m.seat!,
          name: m.name,
          color: m.color!,
          connected: m.connected && !!room.members.get(m.venueId)?.connected,
          disconnectedAt: m.disconnectedAt,
        })) as Player[],
      venues: members
        .filter((m) => m.role !== 'controller')
        .map((m) => ({
          id: m.id,
          name: m.name,
          connected: m.connected,
          index: m.index,
        })) as Venue[],
    };
  }
  expireDisconnected(room: Room, at = Date.now()): string[] {
    const expired = [...room.members.values()]
      .filter(
        (m) =>
          m.role !== 'host' &&
          !m.connected &&
          at - (m.disconnectedAt ?? at) > 60000,
      )
      .map((m) => m.id);
    for (const m of room.members.values())
      if (m.role === 'controller' && expired.includes(m.venueId))
        expired.push(m.id);
    for (const id of expired) room.members.delete(id);
    return [...new Set(expired)];
  }
  canRoute(room: Room, from: string, to: string) {
    const a = room.members.get(from),
      b = room.members.get(to);
    if (!a || !b || a.id === b.id) return false;
    if (a.role === 'controller' && b.role === 'controller') return false;
    return (
      a.role === 'host' ||
      b.role === 'host' ||
      (a.role === 'controller' && a.venueId === b.id) ||
      (b.role === 'controller' && b.venueId === a.id)
    );
  }
}
export class RateLimiter {
  private buckets = new Map<string, { start: number; count: number }>();
  constructor(
    private limit: number,
    private windowMs: number,
  ) {}
  allow(key: string, now = Date.now()) {
    if (this.buckets.size > 10000)
      for (const [id, b] of this.buckets)
        if (now - b.start > this.windowMs) this.buckets.delete(id);
    let b = this.buckets.get(key);
    if (!b || now - b.start >= this.windowMs) {
      b = { start: now, count: 0 };
      this.buckets.set(key, b);
    }
    return ++b.count <= this.limit;
  }
}

type Headers = Record<string, string | string[] | undefined>;
const LOOPBACK = 'loopback';
function normalizeAddress(address: string) {
  const a = address.trim().toLowerCase().replace(/%.*$/, '');
  return a.startsWith('::ffff:') && a.includes('.') ? a.slice(7) : a;
}
const isLoopback = (a: string) => a === '::1' || a.startsWith('127.');
/**
 * The address a browser reached us from. Forwarded headers are trusted only
 * from a loopback socket: the dev server's proxy or a local tunnel.
 */
export function clientAddress(remote: string | undefined, headers: Headers) {
  const socket = normalizeAddress(remote ?? '');
  if (!isLoopback(socket)) return socket;
  const first = (name: string) => {
    const value = headers[name];
    return (Array.isArray(value) ? value[0] : value)?.split(',')[0]?.trim();
  };
  return normalizeAddress(
    first('cf-connecting-ip') || first('x-forwarded-for') || socket,
  );
}
function ipv6Groups(address: string): string[] | null {
  if (!address.includes(':')) return null;
  const [head, tail = ''] = address.split('::');
  const left = head ? head.split(':') : [],
    right = address.includes('::') && tail ? tail.split(':') : [];
  const missing = 8 - left.length - right.length;
  if (missing < 0 || (!address.includes('::') && missing)) return null;
  return [...left, ...Array<string>(missing).fill('0'), ...right].map((g) =>
    g.padStart(4, '0'),
  );
}
/**
 * A household-sized key for an address: a private IPv4 /24, an IPv6 /64, or
 * an exact public IPv4 (one NAT'd home). Loopback is the dev machine itself.
 */
export function networkKey(address: string): string {
  const a = normalizeAddress(address);
  if (!a) return '';
  if (isLoopback(a)) return LOOPBACK;
  const v4 = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(a);
  if (v4) {
    const [first, second] = [Number(v4[1]), Number(v4[2])];
    const lan =
      first === 10 ||
      (first === 172 && second >= 16 && second <= 31) ||
      (first === 192 && second === 168) ||
      (first === 169 && second === 254);
    return lan ? `lan:${v4[1]}.${v4[2]}.${v4[3]}` : `ip:${a}`;
  }
  const groups = ipv6Groups(a);
  return groups ? `v6:${groups.slice(0, 4).join(':')}` : '';
}
/** Loopback (a dev tab on the serving machine) shares that machine's LAN. */
export function sameNetwork(a: string, b: string) {
  if (!a || !b) return false;
  if (a === b) return true;
  const lan = (key: string) => key === LOOPBACK || key.startsWith('lan:');
  return (a === LOOPBACK && lan(b)) || (b === LOOPBACK && lan(a));
}
