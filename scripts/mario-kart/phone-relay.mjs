import { randomBytes } from 'node:crypto';
import { controllerPacket } from './controller-input.mjs';

export function createPhoneRelay({ now = () => Date.now() } = {}) {
  const token = randomBytes(24).toString('hex');
  const listeners = new Set();
  let owner = null, lastAt = 0, sequence = 0;
  const neutral = { connected: false, mask: 0, stickX: 128, stickY: 128, cStickX: 128, cStickY: 128, triggerLeft: 0, triggerRight: 0, analogA: 0, analogB: 0 };
  function broadcast(state) { for (const response of listeners) response.write(`data: ${JSON.stringify(state)}\n\n`); }
  function expire() {
    if (owner && now() - lastAt > 250) { owner = null; sequence = 0; broadcast(neutral); }
  }
  return {
    token,
    expire,
    subscribe(response) {
      listeners.add(response);
      response.write(`data: ${JSON.stringify(neutral)}\n\n`);
      return () => listeners.delete(response);
    },
    accept(payload) {
      expire();
      if (!/^[a-f0-9-]{36}$/.test(payload.client || '')) throw new Error('Invalid controller identity.');
      const state = controllerPacket(0, payload.state, payload.sequence);
      if (owner && owner !== payload.client) throw new Error('Another phone currently owns this controller.');
      if (owner && payload.sequence <= sequence) throw new Error('Out-of-order controller packet.');
      owner = state.connected ? payload.client : null;
      sequence = state.connected ? payload.sequence : 0;
      lastAt = now();
      broadcast(state);
    },
  };
}
