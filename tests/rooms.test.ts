import test from 'node:test';
import assert from 'node:assert/strict';
import { RoomRegistry, ALPHABET, RateLimiter } from '../server/rooms.ts';
void test('room codes are unambiguous and case-insensitive', () => {
  const r = new RoomRegistry(),
    host = r.join({ role: 'host' });
  assert.equal(host.room.code.length, 5);
  assert.ok(host.room.code.split('').every((c) => ALPHABET.includes(c)));
  assert.doesNotThrow(() =>
    r.join({ role: 'display', room: host.room.code.toLowerCase() }),
  );
});
void test('a phone without a screen gets an actionable error', () => {
  const r = new RoomRegistry(),
    h = r.join({ role: 'host' });
  assert.throws(
    () => r.join({ role: 'controller', room: h.room.code }),
    /screen first/,
  );
});
void test('resume tokens preserve seats and cannot be forged or reused after grace', () => {
  const r = new RoomRegistry(),
    h = r.join({ role: 'host' }),
    p = r.join(
      {
        role: 'controller',
        room: h.room.code,
        venueId: h.identity.id,
        name: 'Ada',
      },
      1000,
    );
  r.disconnect(h.room, p.identity.id, 2000);
  const again = r.join({ role: 'controller', token: p.identity.token }, 3000);
  assert.equal(again.member.id, p.member.id);
  assert.equal(again.member.seat, p.member.seat);
  assert.equal(again.member.name, 'Ada');
  const [body, sig] = p.identity.token.split('.');
  assert.throws(
    () =>
      r.join({
        role: 'controller',
        token: body + '.' + (sig[0] === 'A' ? 'B' : 'A') + sig.slice(1),
      }),
    /Invalid resume/,
  );
  r.disconnect(h.room, p.identity.id, 5000);
  assert.throws(
    () => r.join({ role: 'controller', token: p.identity.token }, 65001),
    /expired/,
  );
});
void test('eight seats are reserved through grace, then reusable', () => {
  const r = new RoomRegistry(),
    h = r.join({ role: 'host' });
  const ps = Array.from({ length: 8 }, () =>
    r.join(
      { role: 'controller', room: h.room.code, venueId: h.identity.id },
      1000,
    ),
  );
  r.disconnect(h.room, ps[0].identity.id, 2000);
  assert.throws(
    () =>
      r.join(
        { role: 'controller', room: h.room.code, venueId: h.identity.id },
        3000,
      ),
    /eight/,
  );
  const ninth = r.join(
    { role: 'controller', room: h.room.code, venueId: h.identity.id },
    62001,
  );
  assert.equal(ninth.member.seat, 0);
});
void test('dropping a venue marks its phones disconnected without ending others; resume restores them', () => {
  const r = new RoomRegistry(),
    h = r.join({ role: 'host' }),
    v = r.join({ role: 'display', room: h.room.code }),
    p = r.join({
      role: 'controller',
      room: h.room.code,
      venueId: v.identity.id,
    });
  r.disconnect(h.room, v.identity.id);
  assert.equal(r.roster(h.room).players[0].connected, false);
  assert.equal(h.room.ended, false);
  r.join({ role: 'display', token: v.identity.token });
  assert.equal(r.roster(h.room).players[0].connected, true);
  assert.equal(r.roster(h.room).players[0].id, p.identity.id);
});
void test('host disconnect ends and expires the room', () => {
  const r = new RoomRegistry(),
    h = r.join({ role: 'host' });
  r.disconnect(h.room, h.identity.id);
  assert.equal(r.rooms.size, 0);
  assert.throws(
    () => r.join({ role: 'host', token: h.identity.token }),
    /ended/,
  );
});
void test('routing isolates controllers and venues while permitting direct-to-host fallback', () => {
  const r = new RoomRegistry(),
    h = r.join({ role: 'host' }),
    v = r.join({ role: 'display', room: h.room.code }),
    p = r.join({
      role: 'controller',
      room: h.room.code,
      venueId: v.identity.id,
    }),
    q = r.join({
      role: 'controller',
      room: h.room.code,
      venueId: h.identity.id,
    }),
    other = r.join({ role: 'display', room: h.room.code });
  assert.equal(r.canRoute(h.room, p.member.id, q.member.id), false);
  assert.equal(r.canRoute(h.room, p.member.id, other.member.id), false);
  assert.equal(r.canRoute(h.room, p.member.id, v.member.id), true);
  assert.equal(r.canRoute(h.room, p.member.id, h.member.id), true);
});
void test('rate limiter bounds enumeration and resets its window', () => {
  const l = new RateLimiter(2, 100);
  assert.ok(l.allow('ip', 0));
  assert.ok(l.allow('ip', 1));
  assert.equal(l.allow('ip', 2), false);
  assert.ok(l.allow('ip', 100));
});
void test('venue grace expiration releases orphaned phones and the screen slot', () => {
  const r = new RoomRegistry(),
    h = r.join({ role: 'host' }),
    v = r.join({ role: 'display', room: h.room.code }),
    p = r.join({
      role: 'controller',
      room: h.room.code,
      venueId: v.identity.id,
    });
  r.disconnect(h.room, v.identity.id, 1000);
  assert.deepEqual(
    r.expireDisconnected(h.room, 61001).sort(),
    [v.identity.id, p.identity.id].sort(),
  );
  assert.equal(r.roster(h.room).players.length, 0);
  assert.equal(h.room.ended, false);
});
