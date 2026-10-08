import assert from 'node:assert/strict';
import test from 'node:test';
import { spawn } from 'node:child_process';
import WebSocket from 'ws';
import { Runtime } from '../src/client/runtime/runtime.ts';
import { games } from '../src/client/minigames/catalog.ts';
import type { GameDescriptor } from '../src/client/api/index.ts';
import { buttonProbe, type ProbeState } from './fixtures/games.ts';

void test(
  'live two-venue feedback authenticates host delivery, switches turns and restores a returning phone',
  { timeout: 15000 },
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
        return Promise.reject(new Error('Force relay'));
      }
      getStats() {
        return Promise.resolve(new Map());
      }
      close() {}
    }
    const pulses: number[] = [],
      storage = new Map<string, string>();
    for (const [key, value] of Object.entries({
      document: Object.assign(new EventTarget(), { hidden: false }),
      window: Object.assign(new EventTarget(), { devicePixelRatio: 1 }),
      innerWidth: 800,
      innerHeight: 600,
      devicePixelRatio: 1,
      WebSocket: Socket,
      RTCPeerConnection: Peer,
      navigator: {
        maxTouchPoints: 1,
        vibrate: (ms: number) => pulses.push(ms),
      },
      localStorage: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => storage.set(key, value),
      },
    })) {
      const previous = Object.getOwnPropertyDescriptor(globalThis, key);
      Object.defineProperty(globalThis, key, {
        configurable: true,
        writable: true,
        value,
      });
      t.after(() => {
        if (previous) Object.defineProperty(globalThis, key, previous);
        else Reflect.deleteProperty(globalThis, key);
      });
    }
    const descriptor: GameDescriptor<ProbeState> = {
      ...buttonProbe,
      id: 'live-feedback-probe',
      timing: { kind: 'timed', durationMs: 5000 },
      presentation: { cursors: true, phoneFeedback: true },
      setup: ({ players }) =>
        players.map((p, i) => ({
          playerId: p.id,
          role: i ? 'follower' : 'leader',
          controls: buttonProbe.controls,
        })),
      create(options) {
        const game = buttonProbe.create(options);
        let ids: string[] = [],
          turn = 0,
          initial = true;
        return {
          ...game,
          start(context) {
            ids = context.players.map((p) => p.id);
            game.start(context);
          },
          tick(input) {
            const result = game.tick(input);
            if (!initial && input.actions.length === 0) return result;
            if (!initial) turn = 1;
            initial = false;
            return {
              ...result,
              feedback: ids.map((playerId, i) => ({
                playerId,
                enabled: i === turn,
                status: i === turn ? 'Your turn' : 'Wait',
                hapticMs: 20,
              })),
            };
          },
        };
      },
    };
    (games as GameDescriptor[]).push(descriptor);
    t.after(() =>
      (games as GameDescriptor[]).splice(games.indexOf(descriptor), 1),
    );
    const runtimes: Runtime[] = [];
    t.after(() => runtimes.forEach((r) => r.close()));
    const start = (options: ConstructorParameters<typeof Runtime>[0]) => {
      const runtime = new Runtime(options);
      runtimes.push(runtime);
      runtime.start();
      return runtime;
    };
    const wait = async (predicate: () => boolean, ms = 5000) => {
      const deadline = Date.now() + ms;
      while (Date.now() < deadline) {
        if (predicate()) return;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      assert.fail(
        `Live feedback integration timed out: ${JSON.stringify(runtimes.map((r) => ({ role: r.view.identity?.role, status: r.view.status, phase: r.view.phase, warning: r.view.warning, error: r.view.roundError, controllerRole: r.view.controllerRole, feedback: r.view.controllerFeedback, round: r.view.roundId, assigned: r.view.controllerRoundId })))}`,
      );
    };
    const host = start({ role: 'host', endpoint });
    await wait(() => !!host.view.identity);
    const room = host.view.identity!.room;
    const venue = start({ role: 'display', room, name: 'Remote', endpoint });
    await wait(() => !!venue.view.identity);
    const a = start({
      role: 'controller',
      room,
      venueId: host.view.identity!.id,
      name: 'Ada',
      endpoint,
    });
    await wait(() => !!a.view.identity);
    const b = start({
      role: 'controller',
      room,
      venueId: venue.view.identity!.id,
      name: 'Bea',
      endpoint,
    });
    await wait(
      () =>
        !!a.view.config &&
        !!b.view.config &&
        host.view.roster.players.length === 2,
    );
    host.startGame(descriptor.id, 'standard');
    await wait(
      () =>
        a.view.controllerFeedback.status === 'Your turn' &&
        b.view.controllerFeedback.status === 'Wait',
      6000,
    );
    assert.equal(a.view.controllerRole, 'leader');
    assert.equal(b.view.controllerRole, 'follower');
    const roundId = b.view.controllerRoundId,
      bId = b.view.identity!.id;
    const spoof = {
      type: 'feedback',
      roundId,
      generation: b.view.config!.generation,
      revision: 999,
      status: 'Spoof',
      enabled: true,
      hapticMs: 100,
    };
    venue.network.send(bId, 'ctrl', spoof);
    b.network.send(host.view.identity!.id, 'ctrl', {
      type: 'press',
      press: {
        playerId: a.view.identity!.id,
        generation: b.view.config!.generation,
        button: 0,
        counter: 1,
        time: host.time(),
        x: 0.5,
        y: 0.5,
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 250));
    assert.equal(b.view.controllerFeedback.status, 'Wait');
    assert.equal((host.renderState()!.state as ProbeState).scores[bId], 0);
    a.press('fire', true);
    a.press('fire', false);
    await wait(
      () =>
        b.view.controllerFeedback.status === 'Your turn' &&
        a.view.controllerFeedback.status === 'Wait',
    );
    await wait(
      () =>
        (host.renderState()?.state as ProbeState | null)?.scores[
          a.view.identity!.id
        ] === 1,
    );
    const token = b.view.identity!.token,
      oldGeneration = b.view.config!.generation;
    b.close();
    await wait(() =>
      host.view.roster.players.some((p) => p.id === bId && !p.connected),
    );
    const before = pulses.length;
    const returned = start({
      role: 'controller',
      token,
      room,
      venueId: venue.view.identity!.id,
      name: 'Bea',
      endpoint,
    });
    await wait(() => returned.view.controllerFeedback.status === 'Your turn');
    assert.equal(returned.view.controllerRoundId, roundId);
    assert.equal(returned.view.controllerRole, 'follower');
    assert.notEqual(returned.view.config!.generation, oldGeneration);
    assert.equal(
      pulses.length,
      before,
      'reconnect restores state without a retained pulse',
    );
    assert.ok(
      before > 0,
      'live feedback reached the browser vibration adapter',
    );
    host.close();
    await wait(() => returned.view.ended);
    assert.deepEqual(returned.view.controllerFeedback, {
      status: '',
      enabled: true,
    });
  },
);
