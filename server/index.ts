import {
  APP_PROTOCOL_VERSION,
  PROTOCOL_MISMATCH,
  PROTOCOL_RELOAD_MESSAGE,
} from '../src/core/app-protocol.ts';
import { createServer } from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import { RoomRegistry, RateLimiter, type Room } from './rooms.ts';
const port = Number(process.env.SIGNAL_PORT ?? 8787),
  registry = new RoomRegistry();
const sockets = new Map<string, WebSocket>();
const joins = new RateLimiter(30, 60000),
  globalJoins = new RateLimiter(500, 60000);
const origins = (
  process.env.ALLOWED_ORIGINS ?? 'http://localhost:3000,http://127.0.0.1:3000'
).split(',');
const iceServers = JSON.parse(
  process.env.ICE_SERVERS ?? '[{"urls":"stun:stun.l.google.com:19302"}]',
);
const server = createServer((req, res) => {
  res.writeHead(req.url === '/health' ? 200 : 404, {
    'Content-Type': 'application/json',
  });
  res.end(
    JSON.stringify({ ok: req.url === '/health', rooms: registry.rooms.size }),
  );
});
const wss = new WebSocketServer({
  noServer: true,
  maxPayload: 65536,
  perMessageDeflate: false,
});
server.on('upgrade', (req, socket, head) => {
  if (req.url !== '/signal' || !origins.includes(req.headers.origin ?? '')) {
    socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
});
const send = (ws: WebSocket | undefined, data: unknown) => {
  if (ws?.readyState === WebSocket.OPEN && ws.bufferedAmount < 2 ** 20)
    ws.send(JSON.stringify(data));
};
const roster = (room: Room) => {
  const data = { type: 'roster', ...registry.roster(room) };
  for (const id of room.members.keys()) send(sockets.get(id), data);
};
wss.on('connection', (ws, req) => {
  let room: Room | undefined,
    id: string | undefined,
    alive = true,
    rejectedProtocol = false;
  const budget = new RateLimiter(1500, 1000);
  const ip = req.socket.remoteAddress ?? 'unknown';
  const joinTimeout = setTimeout(() => {
    if (!id) ws.close(1008, 'Join required');
  }, 10000);
  const heartbeat = setInterval(() => {
    if (!alive) {
      ws.terminate();
      return;
    }
    alive = false;
    ws.ping();
  }, 5000);
  ws.on('pong', () => {
    alive = true;
  });
  ws.on('message', (raw) => {
    if (rejectedProtocol) return;
    try {
      if (!budget.allow('socket')) throw new Error('Message rate exceeded');
      const msg = JSON.parse(
        (Buffer.isBuffer(raw)
          ? raw
          : Array.isArray(raw)
            ? Buffer.concat(raw)
            : Buffer.from(raw)
        ).toString(),
      );
      if (!msg || typeof msg.type !== 'string')
        throw new Error('Invalid message');
      if (msg.type === 'join' && !id) {
        if (msg.protocolVersion !== APP_PROTOCOL_VERSION) {
          rejectedProtocol = true;
          send(ws, {
            type: 'error',
            code: PROTOCOL_MISMATCH,
            message: PROTOCOL_RELOAD_MESSAGE,
          });
          ws.close(1008, 'App version mismatch');
          return;
        }
        if (!joins.allow(ip) || !globalJoins.allow('global'))
          throw new Error('Too many join attempts. Wait a minute.');
        const result = registry.join(msg);
        room = result.room;
        id = result.member.id;
        const previous = sockets.get(id);
        sockets.set(id, ws);
        previous?.close(1000, 'Replaced by resumed device');
        clearTimeout(joinTimeout);
        send(ws, {
          type: 'welcome',
          protocolVersion: APP_PROTOCOL_VERSION,
          identity: result.identity,
          iceServers,
        });
        roster(room);
        return;
      }
      if (!room || !id || room.ended) throw new Error('Join a room first');
      if (msg.type === 'signal' || msg.type === 'relay') {
        if (typeof msg.to !== 'string' || !registry.canRoute(room, id, msg.to))
          throw new Error('Invalid peer route');
        if (
          msg.type === 'relay' &&
          !['ctrl', 'input', 'snapshot', 'events'].includes(msg.channel)
        )
          throw new Error('Invalid channel');
        const target = sockets.get(msg.to);
        if (msg.channel === 'input' || msg.channel === 'snapshot') {
          if (target && target.bufferedAmount > 65536) return;
        }
        send(target, { ...msg, from: id, to: undefined });
      } else if (msg.type === 'leave') ws.close(1000, 'Left room');
    } catch (error) {
      send(ws, {
        type: 'error',
        message: error instanceof Error ? error.message : 'Invalid request',
      });
    }
  });
  ws.on('close', () => {
    clearInterval(heartbeat);
    clearTimeout(joinTimeout);
    if (!room || !id || sockets.get(id) !== ws) return;
    sockets.delete(id);
    registry.disconnect(room, id);
    if (room.ended) {
      for (const memberId of room.members.keys()) {
        send(sockets.get(memberId), {
          type: 'ended',
          reason: 'The host screen disconnected. The session has ended.',
        });
        sockets.get(memberId)?.close(1000, 'Session ended');
      }
    } else roster(room);
  });
  ws.on('error', () => ws.close());
});
const disconnectSweep = setInterval(() => {
  for (const room of registry.rooms.values()) {
    const ids = registry.expireDisconnected(room);
    for (const id of ids) {
      send(sockets.get(id), {
        type: 'ended',
        reason:
          'This device or its screen did not reconnect within 60 seconds. Join again from a screen.',
      });
      sockets.get(id)?.close(1000, 'Resume grace expired');
    }
    if (ids.length) roster(room);
  }
}, 1000);
const sweep = setInterval(() => {
  for (const room of registry.rooms.values())
    if (Date.now() - room.created > 12 * 3600000) {
      room.ended = true;
      registry.rooms.delete(room.code);
      for (const id of room.members.keys()) {
        send(sockets.get(id), {
          type: 'ended',
          reason: 'This session expired after 12 hours.',
        });
        sockets.get(id)?.close();
      }
    }
}, 60000);
server.listen(port, '0.0.0.0', () =>
  console.log(
    `Controlla signaling ready at ws://localhost:${(server.address() as { port: number }).port}/signal`,
  ),
);
process.on('SIGTERM', () => {
  clearInterval(sweep);
  clearInterval(disconnectSweep);
  for (const ws of sockets.values()) ws.close(1001, 'Service stopping');
  wss.close();
  server.close();
});
