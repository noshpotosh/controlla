import assert from 'node:assert/strict';
import test from 'node:test';
import {
  Runtime,
  runtimeBootId,
} from '../src/client/runtime/runtime.ts';
import type {
  Transport,
  LinkStats,
} from '../src/client/transport/contracts.ts';
import type { Identity, Roster } from '../src/shared/room.ts';
import type { Channel, Message } from '../src/client/engine/messages.ts';
import { motionFixture } from './fixtures/motion-provider.ts';

class FakeTransport implements Transport {
  onWelcome: (identity: Identity) => void = () => {};
  onRoster: (roster: Roster) => void = () => {};
  onMessage: (
    from: string,
    channel: Channel,
    data: Message | ArrayBuffer,
  ) => void = () => {};
  onWarning: (message: string) => void = () => {};
  onEnded: (reason: string) => void = () => {};
  onStatus: (status: string) => void = () => {};
  connects = 0;
  closes = 0;
  sends = 0;
  pending: ((links: Record<string, LinkStats>) => void)[] = [];
  connect() {
    this.connects++;
  }
  close() {
    this.closes++;
  }
  send() {
    this.sends++;
  }
  isOpen() {
    return false;
  }
  ensureHostFallback() {}
  stats() {
    return new Promise<Record<string, LinkStats>>((resolve) =>
      this.pending.push(resolve),
    );
  }
}
const identity: Identity = {
  id: 'phone',
  role: 'controller',
  hostId: 'host',
  venueId: 'host',
  room: 'TEST',
  token: 'fixture',
};

void test('runtime boot IDs fall back outside secure browser contexts', () => {
  const first = runtimeBootId(null),
    second = runtimeBootId(null);
  assert.match(first, /^boot-[a-z0-9]+-\d+-[a-z0-9]+$/);
  assert.notEqual(first, second);
});

void test('injected transport starts once and all callbacks, probes and statistics retire on end/close', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const network = new FakeTransport(),
    motion = motionFixture();
  let listeners = 0;
  const runtime = new Runtime(
    { role: 'controller', endpoint: 'ws://unused' },
    motion.motion,
    network,
    {
      hidden: () => false,
      listen: () => {
        listeners++;
        return () => {
          listeners--;
        };
      },
      createAudio: () => {
        throw new Error('unavailable');
      },
      requestWake: () => null,
    },
  );
  t.after(() => runtime.close());
  let notifications = 0;
  runtime.subscribe(() => notifications++);
  runtime.start();
  runtime.start();
  assert.equal(network.connects, 1);
  network.onWelcome(identity);
  network.onStatus('Connected');
  t.mock.timers.tick(2000);
  assert.equal(network.pending.length, 1);
  network.onEnded('Host left');
  const ended = notifications,
    sends = network.sends;
  network.pending[0]({ host: { path: 'P2P', rtt: 5 } });
  await Promise.resolve();
  await Promise.resolve();
  network.onWelcome({ ...identity, id: 'late' });
  network.onRoster({ players: [], venues: [] });
  network.onStatus('Connected');
  t.mock.timers.tick(10000);
  assert.equal(runtime.view.identity?.id, 'phone');
  assert.equal(runtime.view.status, 'Session ended');
  assert.equal(network.sends, sends);
  assert.equal(notifications, ended);
  assert.equal(listeners, 0);
  runtime.close();
  runtime.close();
  runtime.start();
  assert.equal(network.closes, 1);
  assert.equal(network.connects, 1);
  network.onWarning('late');
  assert.equal(notifications, ended);
});
