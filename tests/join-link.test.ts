import test from 'node:test';
import assert from 'node:assert/strict';
import {
  arrival,
  chooseScreen,
  isPhoneLike,
  orderScreens,
  parseJoinPath,
  roomPath,
  signalEndpoint,
} from '../src/client/shell/join-link.ts';
import type { ScreenPreview } from '../src/shared/room.ts';

const screen = (
  index: number,
  sameNetwork = false,
  id = `s${index}`,
): ScreenPreview => ({ id, index, name: `Screen ${index}`, sameNetwork });

void test('join paths carry a room and optionally the screen whose QR was scanned', () => {
  assert.deepEqual(parseJoinPath('/'), {});
  assert.deepEqual(parseJoinPath('/k7qmx'), { room: 'K7QMX' });
  assert.deepEqual(parseJoinPath('/K7QMX/'), { room: 'K7QMX' });
  assert.deepEqual(parseJoinPath('/K7QMX/2'), { room: 'K7QMX', screen: 2 });
  assert.deepEqual(parseJoinPath('/K7QMX/9'), { room: 'K7QMX' });
  assert.deepEqual(parseJoinPath('/K7QMX/x'), { room: 'K7QMX' });
  assert.deepEqual(parseJoinPath('/K7QMX/2/extra'), {});
  assert.deepEqual(parseJoinPath('/dev/game-harness'), {});
  assert.deepEqual(parseJoinPath('/K0QMX'), {}, 'zero is not in the alphabet');
  assert.equal(roomPath('k7qmx'), '/K7QMX');
  assert.equal(roomPath('K7QMX', 3), '/K7QMX/3');
});

void test('phones are small touch devices; TVs, laptops and tablets are screens', () => {
  assert.equal(isPhoneLike({ coarse: true, shortSide: 390 }), true);
  assert.equal(isPhoneLike({ coarse: true, shortSide: 820 }), false);
  assert.equal(isPhoneLike({ coarse: false, shortSide: 390 }), false);
});

void test('a phone joins the scanned screen, else the one on its Wi-Fi, else confirms the only one, else asks', () => {
  const host = screen(1),
    den = screen(2, true);
  assert.deepEqual(chooseScreen([host, den], 1), {
    kind: 'hinted',
    screen: host,
  });
  assert.deepEqual(chooseScreen([host, den], 5), {
    kind: 'sameNetwork',
    screen: den,
  });
  assert.deepEqual(chooseScreen([host]), { kind: 'only', screen: host });
  assert.deepEqual(chooseScreen([host, screen(3)]), { kind: 'pick' });
  assert.deepEqual(chooseScreen([screen(1, true), screen(2, true)]), {
    kind: 'pick',
  });
  assert.deepEqual(chooseScreen([]), { kind: 'pick' });
});

void test('newly arrived and same-Wi-Fi screens are listed first', () => {
  const list = [screen(1), screen(2, true), screen(3), screen(4, true)];
  assert.deepEqual(
    orderScreens(list).map((s) => s.index),
    [2, 4, 1, 3],
  );
  assert.deepEqual(
    orderScreens(list, new Set(['s1', 's2', 's4'])).map((s) => s.index),
    [3, 2, 4, 1],
  );
});

void test('a phone waiting for its own screen picks the lone newcomer, preferring its Wi-Fi', () => {
  const known = new Set(['s1']);
  assert.equal(arrival([screen(1)], known), undefined);
  assert.equal(arrival([screen(1), screen(2)], known)?.index, 2);
  assert.equal(
    arrival([screen(1), screen(2), screen(3, true)], known)?.index,
    3,
  );
  assert.equal(arrival([screen(1), screen(2), screen(3)], known), undefined);
});

void test('signaling follows the page origin unless overridden', () => {
  assert.equal(
    signalEndpoint({ protocol: 'https:', host: 'play.test', search: '' }),
    'wss://play.test/signal',
  );
  assert.equal(
    signalEndpoint({ protocol: 'http:', host: 'localhost:3000', search: '' }),
    'ws://localhost:3000/signal',
  );
  assert.equal(
    signalEndpoint({
      protocol: 'http:',
      host: 'localhost:3000',
      search: '?signal=ws%3A%2F%2F127.0.0.1%3A8787%2Fsignal',
    }),
    'ws://127.0.0.1:8787/signal',
  );
});
