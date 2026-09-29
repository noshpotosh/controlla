import assert from 'node:assert/strict';
import test from 'node:test';
import { lanAddresses, tunnelUrlFrom } from '../scripts/phone-development.ts';

void test('phone development extracts only a Quick Tunnel HTTPS URL', () => {
  assert.equal(
    tunnelUrlFrom(
      'Starting quick tunnel…\nYour tunnel URL: https://bright-game-42.trycloudflare.com\n',
    ),
    'https://bright-game-42.trycloudflare.com',
  );
  assert.equal(tunnelUrlFrom('http://localhost:3012'), null);
  assert.equal(tunnelUrlFrom('https://example.com'), null);
});

void test('local Wi-Fi play offers reachable LAN addresses, Wi-Fi first', () => {
  const entry = (address: string, internal = false, family = 'IPv4') =>
    ({
      address,
      internal,
      family,
      netmask: '255.255.255.0',
      mac: '00:00:00:00:00:00',
      cidr: null,
    }) as never;
  assert.deepEqual(
    lanAddresses({
      bridge100: [entry('192.168.64.1')],
      lo0: [entry('127.0.0.1', true)],
      en0: [entry('fe80::1', false, 'IPv6'), entry('10.0.0.90')],
      en7: [entry('169.254.10.2')],
    }),
    ['10.0.0.90', '192.168.64.1'],
  );
  assert.deepEqual(lanAddresses({ lo0: [entry('127.0.0.1', true)] }), []);
});
