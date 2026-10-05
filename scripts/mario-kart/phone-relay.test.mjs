import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPhoneRelay } from './phone-relay.mjs';
const state = { connected: true, mask: 1, stickX: 240, stickY: 128, cStickX: 128, cStickY: 128, triggerLeft: 0, triggerRight: 0, analogA: 255, analogB: 0 };
const client = '11111111-1111-1111-1111-111111111111';

test('phone owns port 0 until stale and stale input releases all held controls', () => {
  let time = 0;
  const relay = createPhoneRelay({ now: () => time });
  const messages = [];
  relay.subscribe({ write: message => messages.push(JSON.parse(message.slice(6))) });
  relay.accept({ client, sequence: 1, state });
  assert.equal(messages.at(-1).stickX, 240);
  assert.throws(() => relay.accept({ client, sequence: 1, state }), /Out-of-order/);
  assert.throws(() => relay.accept({ client: '22222222-2222-2222-2222-222222222222', sequence: 1, state }), /Another phone/);
  time = 251;
  relay.expire();
  assert.equal(messages.at(-1).connected, false);
  assert.equal(messages.at(-1).mask, 0);
  assert.equal(messages.at(-1).stickX, 128);
  relay.accept({ client: '22222222-2222-2222-2222-222222222222', sequence: 1, state });
  assert.equal(messages.at(-1).connected, true);
});

test('disconnect is immediate and malformed inputs never claim controller ownership', () => {
  const relay = createPhoneRelay();
  assert.throws(() => relay.accept({ client, sequence: 1, state: { ...state, stickX: 999 } }), /stickX/);
  relay.accept({ client, sequence: 1, state });
  relay.accept({ client, sequence: 2, state: { ...state, connected: false } });
  relay.accept({ client: '22222222-2222-2222-2222-222222222222', sequence: 1, state });
});
