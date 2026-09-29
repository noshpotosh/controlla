import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isStalePhoneProcess,
  tunnelUrlFrom,
  type ProcessDetails,
} from '../scripts/phone-development.ts';

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

const root = '/work/controlla';
const processDetails = (
  overrides: Partial<ProcessDetails> = {},
): ProcessDetails => ({
  pid: 42,
  cwd: root,
  command: 'node harmless.js',
  environment: {},
  ...overrides,
});

void test('phone development recognizes its stale repository processes', () => {
  assert.equal(
    isStalePhoneProcess(
      processDetails({ command: 'node scripts/phone-development.ts' }),
      root,
      99,
    ),
    true,
  );
  assert.equal(
    isStalePhoneProcess(
      processDetails({
        command: 'node node_modules/.bin/vinext dev --port 3012',
      }),
      root,
      99,
    ),
    true,
  );
  assert.equal(
    isStalePhoneProcess(
      processDetails({
        command:
          'node node_modules/.bin/wrangler tunnel quick-start http://127.0.0.1:3012',
      }),
      root,
      99,
    ),
    true,
  );
  assert.equal(
    isStalePhoneProcess(
      processDetails({
        command: 'node --import tsx server/index.ts',
        environment: {
          SIGNAL_PORT: '8912',
          ALLOWED_ORIGINS: 'https://game.trycloudflare.com',
        },
      }),
      root,
      99,
    ),
    true,
  );
  assert.equal(
    isStalePhoneProcess(
      processDetails({
        command: 'node anything.js',
        environment: { CONTROLLA_PHONE_DEV_ROOT: root },
      }),
      root,
      99,
    ),
    true,
  );
});

void test('phone development leaves current and unrelated processes alone', () => {
  const oldFrontend = processDetails({
    command: 'node node_modules/.bin/vinext dev --port 3012',
  });
  assert.equal(isStalePhoneProcess(oldFrontend, root, oldFrontend.pid), false);
  assert.equal(
    isStalePhoneProcess({ ...oldFrontend, cwd: '/work/other' }, root, 99),
    false,
  );
  assert.equal(
    isStalePhoneProcess(
      processDetails({
        command: 'node --import tsx server/index.ts',
        environment: { SIGNAL_PORT: '8787' },
      }),
      root,
      99,
    ),
    false,
  );
  assert.equal(
    isStalePhoneProcess(processDetails({ command: 'node app.js' }), root, 99),
    false,
  );
});
