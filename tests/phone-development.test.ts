import assert from 'node:assert/strict';
import test from 'node:test';
import { tunnelUrlFrom } from '../scripts/phone-development.ts';

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
