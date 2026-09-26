import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import WebSocket from 'ws';
import type { Message } from '../src/core/types.ts';

void test(
  'live signaling supports venue relay, reconnect, isolation, and explicit host termination',
  { timeout: 20000 },
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
    let logs = '';
    const url = await new Promise<string>((resolve, reject) => {
      child.stdout!.on('data', (data) => {
        logs += data.toString();
        const match = logs.match(/ws:\/\/localhost:\d+\/signal/);
        if (match) resolve(match[0]);
      });
      child.once('exit', () => reject(new Error('Service stopped: ' + logs)));
      child.stderr!.on('data', (d) => {
        logs += d.toString();
      });
    });
    const clients: WebSocket[] = [];
    t.after(() => clients.forEach((c) => c.terminate()));
    async function connect(join: object) {
      const ws = new WebSocket(url, { origin: 'http://localhost:3000' });
      clients.push(ws);
      const messages: Message[] = [];
      ws.on('message', (b) =>
        messages.push(
          JSON.parse(
            (Buffer.isBuffer(b)
              ? b
              : Array.isArray(b)
                ? Buffer.concat(b)
                : Buffer.from(b)
            ).toString(),
          ),
        ),
      );
      await once(ws, 'open');
      ws.send(JSON.stringify({ type: 'join', ...join }));
      const welcome = await wait(messages, (m) => m.type === 'welcome');
      return { ws, messages, identity: welcome.identity };
    }
    async function wait(
      messages: Message[],
      predicate: (m: Message) => boolean,
    ) {
      const until = Date.now() + 4000;
      while (Date.now() < until) {
        const index = messages.findIndex(predicate);
        if (index >= 0) return messages.splice(index, 1)[0];
        await new Promise((r) => setTimeout(r, 5));
      }
      throw new Error('Expected signaling response was not received');
    }
    const host = await connect({ role: 'host' }),
      venue = await connect({
        role: 'display',
        room: host.identity.room,
        name: 'Remote',
      }),
      phone = await connect({
        role: 'controller',
        room: host.identity.room,
        venueId: venue.identity.id,
        name: 'Ada',
      });
    phone.ws.send(
      JSON.stringify({
        type: 'relay',
        to: venue.identity.id,
        channel: 'input',
        data: [1, 2, 3],
        binary: true,
      }),
    );
    const frame = await wait(venue.messages, (m) => m.type === 'relay');
    assert.equal(frame.from, phone.identity.id);
    assert.deepEqual(frame.data, [1, 2, 3]);
    const other = await connect({ role: 'display', room: host.identity.room });
    phone.ws.send(
      JSON.stringify({
        type: 'relay',
        to: other.identity.id,
        channel: 'ctrl',
        data: { type: 'illegal' },
      }),
    );
    assert.match(
      (await wait(phone.messages, (m) => m.type === 'error')).message,
      /Invalid peer route/,
    );
    venue.ws.close();
    await once(venue.ws, 'close');
    await wait(
      host.messages,
      (m) =>
        m.type === 'roster' &&
        m.players.some(
          (p: Message) => p.id === phone.identity.id && !p.connected,
        ),
    );
    const resumed = await connect({
      role: 'display',
      token: venue.identity.token,
    });
    assert.equal(resumed.identity.id, venue.identity.id);
    await wait(
      host.messages,
      (m) =>
        m.type === 'roster' &&
        m.players.some(
          (p: Message) => p.id === phone.identity.id && p.connected,
        ),
    );
    host.ws.close();
    const ended = await wait(phone.messages, (m) => m.type === 'ended');
    assert.match(ended.reason, /host screen disconnected/);
  },
);
