import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type {
  Identity,
  Player,
  Role,
  Venue,
  Roster,
} from '../src/shared/room.ts';
import { COLORS } from '../src/shared/room.ts';
export const ALPHABET = '23456789ABCDEFGHJKMNPQRSTVWXYZ';
export interface Member {
  id: string;
  role: Role;
  venueId: string;
  connected: boolean;
  disconnectedAt?: number;
  name: string;
  seat?: number;
  color?: string;
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
    if (request.token) {
      const p = this.verify(request.token);
      room = this.rooms.get(p.room)!;
      if (!room || room.ended)
        throw new Error('This session has ended. Start a new room.');
      member = room.members.get(p.id)!;
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
    } else if (request.role === 'host') {
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
      room = this.rooms.get((request.room ?? '').trim().toUpperCase())!;
      if (!room || room.ended)
        throw new Error('Room not found. Check the code on your screen.');
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
        const venue =
          room.members.get(request.venueId ?? '') ??
          [...room.members.values()].find(
            (m) =>
              m.role !== 'controller' &&
              m.id.slice(0, 4) === (request.venueId ?? '').toLowerCase(),
          );
        if (!venue || venue.role === 'controller' || !venue.connected)
          throw new Error(
            'Open this room on a screen first, then use that screen’s phone link.',
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
          name: (request.name ?? 'Player').trim().slice(0, 24) || 'Player',
          seat,
          color: COLORS[seat],
        };
      } else {
        if (
          [...room.members.values()].filter((m) => m.role !== 'controller')
            .length >= 8
        )
          throw new Error('This room already has eight screens.');
        member = {
          id,
          role: 'display',
          venueId: id,
          connected: true,
          name:
            (request.name ?? 'Guest screen').trim().slice(0, 24) ||
            'Guest screen',
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
