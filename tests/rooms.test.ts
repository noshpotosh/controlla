import test from 'node:test';
import assert from 'node:assert/strict';
import {
  RoomRegistry,
  ALPHABET,
  RateLimiter,
  clientAddress,
  networkKey,
  sameNetwork,
} from '../server/rooms.ts';
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

void test('screens get the lowest free number, keep it on resume, and reuse it after expiry', () => {
  const r = new RoomRegistry(),
    h = r.join({ role: 'host' }),
    a = r.join({ role: 'display', room: h.room.code }, 1000),
    b = r.join({ role: 'display', room: h.room.code, name: 'Den' }, 1000);
  assert.deepEqual(
    r.roster(h.room).venues.map((v) => [v.index, v.name]),
    [
      [1, 'Host screen'],
      [2, 'Screen 2'],
      [3, 'Den'],
    ],
  );
  r.disconnect(h.room, a.identity.id, 2000);
  assert.equal(
    r.join({ role: 'display', token: a.identity.token }, 3000).member.index,
    2,
  );
  r.disconnect(h.room, a.identity.id, 4000);
  r.expireDisconnected(h.room, 65000);
  assert.equal(
    r.join({ role: 'display', room: h.room.code }, 65000).member.index,
    2,
  );
  assert.equal(b.member.index, 3);
});
void test('phones join a screen by its full id only, never by a short prefix', () => {
  const r = new RoomRegistry(),
    h = r.join({ role: 'host' });
  assert.throws(
    () =>
      r.join({
        role: 'controller',
        room: h.room.code,
        venueId: h.identity.id.slice(0, 4),
      }),
    /screen first/,
  );
  assert.equal(
    r.join({ role: 'controller', room: h.room.code, venueId: h.identity.id })
      .member.venueId,
    h.identity.id,
  );
});
void test('room previews list connected screens in order without credentials', () => {
  const r = new RoomRegistry(),
    h = r.join({ role: 'host' }),
    a = r.join({ role: 'display', room: h.room.code, name: 'Den' }),
    b = r.join({ role: 'display', room: h.room.code });
  r.disconnect(h.room, b.identity.id);
  const preview = r.preview(
    r.find(h.room.code.toLowerCase()),
    (id) => id === a.identity.id,
  );
  assert.deepEqual(preview, {
    room: h.room.code,
    screens: [
      { id: h.identity.id, index: 1, name: 'Host screen', sameNetwork: false },
      { id: a.identity.id, index: 2, name: 'Den', sameNetwork: true },
    ],
    full: false,
  });
  assert.equal(JSON.stringify(preview).includes('token'), false);
  assert.throws(() => r.find('ZZZZZ'), /Room not found/);
});
void test('network keys group a household and trust forwarding only from a local proxy', () => {
  assert.equal(networkKey('192.168.1.23'), 'lan:192.168.1');
  assert.equal(networkKey('::ffff:10.0.4.9'), 'lan:10.0.4');
  assert.equal(networkKey('172.20.1.2'), 'lan:172.20.1');
  assert.equal(networkKey('172.32.1.2'), 'ip:172.32.1.2');
  assert.equal(networkKey('100.64.3.2'), 'ip:100.64.3.2');
  assert.equal(networkKey('203.0.113.7'), 'ip:203.0.113.7');
  assert.equal(
    networkKey('2001:db8:1:2:aaaa::1'),
    networkKey('2001:0db8:0001:0002:bbbb:cccc:dddd:eeee'),
  );
  assert.notEqual(networkKey('2001:db8:1:2::1'), networkKey('2001:db8:1:3::1'));
  assert.equal(networkKey('fe80::1%en0'), 'v6:fe80:0000:0000:0000');
  assert.equal(networkKey(''), '');
  assert.equal(networkKey('not an address'), '');
  assert.equal(networkKey('127.0.0.1'), networkKey('::1'));

  assert.ok(
    sameNetwork(networkKey('192.168.1.23'), networkKey('192.168.1.40')),
  );
  assert.equal(
    sameNetwork(networkKey('192.168.1.23'), networkKey('192.168.2.40')),
    false,
  );
  assert.ok(sameNetwork(networkKey('203.0.113.7'), networkKey('203.0.113.7')));
  assert.ok(sameNetwork(networkKey('127.0.0.1'), networkKey('192.168.1.40')));
  assert.equal(
    sameNetwork(networkKey('127.0.0.1'), networkKey('203.0.113.7')),
    false,
  );
  assert.equal(sameNetwork('', ''), false);

  const forwarded = {
    'x-forwarded-for': '192.168.1.23, 127.0.0.1',
    'cf-connecting-ip': '198.51.100.4',
  };
  assert.equal(clientAddress('127.0.0.1', forwarded), '198.51.100.4');
  assert.equal(
    clientAddress('::ffff:127.0.0.1', { 'x-forwarded-for': '192.168.1.23' }),
    '192.168.1.23',
  );
  assert.equal(clientAddress('203.0.113.9', forwarded), '203.0.113.9');
  assert.equal(clientAddress('::1', {}), '::1');
  assert.equal(clientAddress(undefined, forwarded), '');
});
void test('a stale saved identity joins afresh when the request names a room', () => {
  const r = new RoomRegistry(),
    h = r.join({ role: 'host' }),
    v = r.join({ role: 'display', room: h.room.code }, 1000);
  r.disconnect(h.room, v.identity.id, 2000);
  r.expireDisconnected(h.room, 63000);
  const again = r.join(
    { role: 'display', room: h.room.code, token: v.identity.token },
    63000,
  );
  assert.notEqual(again.member.id, v.member.id);
  assert.equal(again.member.index, 2);
  assert.throws(
    () => r.join({ role: 'display', token: v.identity.token }, 63000),
    /Invalid resume identity/,
  );
  const forged = r.join({
    role: 'controller',
    room: h.room.code,
    venueId: h.identity.id,
    token: 'bogus.token',
  });
  assert.equal(forged.member.role, 'controller');
});
