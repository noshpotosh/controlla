import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import WebSocket from 'ws';
import { Runtime } from '../src/client/runtime.ts';

// Executes the real role routing and Session on actual WebSockets. Browser APIs
// are minimal mocks: this is deliberately NOT a WebRTC or mobile-browser test.
void test(
  'two venues route local cursors, judge input, and restore a reloaded phone',
  { timeout: 18000 },
  async (t) => {
    const child = spawn(
      process.execPath,
      ['--import', 'tsx', 'server/index.ts'],
      {
        env: {
          ...process.env,
          SIGNAL_PORT: '0',
          ALLOWED_ORIGINS: 'http://localhost:3000',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    t.after(() => child.kill('SIGTERM'));
    const endpoint = await new Promise<string>((resolve, reject) => {
      let output = '';
      child.stdout!.on('data', (data) => {
        output += String(data);
        const match = output.match(/ws:\/\/localhost:\d+\/signal/);
        if (match) resolve(match[0]);
      });
      child.once('exit', () => reject(new Error('Signal service stopped')));
    });
    const doc = Object.assign(new EventTarget(), { hidden: false });
    const win = Object.assign(new EventTarget(), { devicePixelRatio: 1 });
    const storage = new Map<string, string>();
    class Socket extends WebSocket {
      constructor(url: string) {
        super(url, { origin: 'http://localhost:3000' });
      }
    }
    class Peer {
      connectionState = 'new';
      localDescription = null;
      remoteDescription = null;
      createDataChannel() {
        return { readyState: 'connecting', bufferedAmount: 0 };
      }
      createOffer() {
        return Promise.reject(
          new Error('Force relay for this integration test'),
        );
      }
      getStats() {
        return Promise.resolve(new Map());
      }
      close() {}
    }
    const globals: Record<string, unknown> = {
      document: doc,
      window: win,
      innerWidth: 800,
      innerHeight: 600,
      devicePixelRatio: 1,
      WebSocket: Socket,
      RTCPeerConnection: Peer,
      localStorage: {
        getItem: (k: string) => storage.get(k) ?? null,
        setItem: (k: string, v: string) => storage.set(k, v),
      },
      navigator: { maxTouchPoints: 1 },
    };
    const runtimes: Runtime[] = [];
    t.after(() => runtimes.forEach((r) => r.close()));
    for (const [key, value] of Object.entries(globals)) {
      const descriptor = Object.getOwnPropertyDescriptor(globalThis, key);
      Object.defineProperty(globalThis, key, {
        configurable: true,
        writable: true,
        value,
      });
      t.after(() => {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else Reflect.deleteProperty(globalThis, key);
      });
    }
    const start = (options: ConstructorParameters<typeof Runtime>[0]) => {
      const runtime = new Runtime(options);
      runtimes.push(runtime);
      runtime.start();
      return runtime;
    };
    const wait = async (predicate: () => boolean, ms = 4000) => {
      const end = Date.now() + ms;
      while (Date.now() < end) {
        if (predicate()) return;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      assert.fail('Role integration timed out');
    };
    const host = start({ role: 'host', endpoint });
    await wait(() => !!host.view.identity);
    const hostIdentity = host.view.identity!;
    const venue = start({
      role: 'display',
      room: hostIdentity.room,
      name: 'Remote',
      endpoint,
    });
    await wait(() => !!venue.view.identity);
    const venueIdentity = venue.view.identity!;
    const a = start({
      role: 'controller',
      room: hostIdentity.room,
      venueId: hostIdentity.id,
      name: 'Ada',
      endpoint,
    });
    const b = start({
      role: 'controller',
      room: hostIdentity.room,
      venueId: venueIdentity.id,
      name: 'Ben',
      endpoint,
    });
    await wait(
      () =>
        !!a.view.config &&
        !!b.view.config &&
        host.view.roster.players.length === 2 &&
        a.clock.samples >= 10 &&
        b.clock.samples >= 10,
    );
    const bId = b.view.identity!.id;
    a.setPoint({ x: 0.2, y: 0.3 });
    b.setPoint({ x: 0.7, y: 0.6 });
    await wait(
      () =>
        host.cursors().some((c) => c.id === a.view.identity!.id) &&
        venue
          .cursors()
          .some((c) => c.id === bId && Math.abs(c.point.x - 0.7) < 0.01),
    );
    assert.equal(
      host.cursors().some((c) => c.id === bId),
      false,
    );
    assert.equal(
      venue
        .cursors()
        .find((c) => c.id === bId)!
        .point.x.toFixed(1),
      '0.7',
    );
    host.startGame('latency-lab', 'reaction');
    await wait(() => host.renderState()?.phase === 'running', 6000);
    await wait(() => {
      const state = host.renderState();
      return (
        !!state && state.promptId > 0 && host.time() > state.targetAt + 100
      );
    }, 4000);
    b.press('fire', true);
    b.press('fire', false);
    await wait(() => (host.renderState()?.scores[bId] ?? 0) > 0);
    const token = b.view.identity!.token;
    b.close();
    await wait(() =>
      host.view.roster.players.some((p) => p.id === bId && !p.connected),
    );
    const returned = start({
      role: 'controller',
      token,
      room: hostIdentity.room,
      venueId: venueIdentity.id,
      name: 'Ben',
      endpoint,
    });
    await wait(
      () =>
        !!returned.view.config &&
        host.view.roster.players.some((p) => p.id === bId && p.connected) &&
        returned.clock.samples >= 10,
    );
    assert.equal(returned.view.identity!.id, bId);
    returned.setPoint({ x: 0.4, y: 0.8 });
    await wait(() => {
      const state = host.renderState();
      return Math.abs((state?.cursors[bId]?.x ?? 0) - 0.4) < 0.01;
    });
    host.close();
    await wait(() => venue.view.ended && returned.view.ended);
    assert.match(venue.view.warning, /host screen disconnected/);
  },
);
