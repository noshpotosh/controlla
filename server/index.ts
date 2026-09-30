import {
  APP_PROTOCOL_VERSION,
  PROTOCOL_MISMATCH,
  PROTOCOL_RELOAD_MESSAGE,
} from '../src/shared/app-protocol.ts';
import { createServer } from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import {
  RoomRegistry,
  RateLimiter,
  clientAddress,
  networkKey,
  sameNetwork,
  type Room,
} from './rooms.ts';
const port = Number(process.env.SIGNAL_PORT ?? 8787),
  registry = new RoomRegistry();
const sockets = new Map<string, WebSocket>();
/** Each member's household network key; never sent to any client. */
const networks = new Map<string, string>();
/** Devices looking at a room before joining it, keyed by room code. */
interface Watcher {
  ws: WebSocket;
  network: string;
}
const watchers = new Map<string, Set<Watcher>>();
const MAX_WATCHERS = 16,
  WATCH_MS = 30 * 60000;
const joins = new RateLimiter(30, 60000),
  globalJoins = new RateLimiter(500, 60000),
  watches = new RateLimiter(60, 60000);
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
const preview = (room: Room, watcher: Watcher) => ({
  type: 'room',
  ...registry.preview(room, (id) =>
    sameNetwork(watcher.network, networks.get(id) ?? ''),
  ),
});
const roster = (room: Room) => {
  const data = { type: 'roster', ...registry.roster(room) };
  for (const id of room.members.keys()) send(sockets.get(id), data);
  for (const watcher of watchers.get(room.code) ?? [])
    send(watcher.ws, preview(room, watcher));
};
const endWatchers = (room: Room, reason: string) => {
  for (const { ws } of watchers.get(room.code) ?? []) {
    send(ws, { type: 'ended', reason });
    ws.close(1000, 'Session ended');
  }
  watchers.delete(room.code);
};
wss.on('connection', (ws, req) => {
  let room: Room | undefined,
    id: string | undefined,
    alive = true,
    rejectedProtocol = false,
    watching: { code: string; watcher: Watcher } | undefined,
    watchTimeout: ReturnType<typeof setTimeout> | undefined;
  const budget = new RateLimiter(1500, 1000);
  const ip = req.socket.remoteAddress ?? 'unknown',
    network = networkKey(clientAddress(req.socket.remoteAddress, req.headers));
  const joinTimeout = setTimeout(() => {
    if (!id && !watching) ws.close(1008, 'Join required');
  }, 10000);
  const unwatch = () => {
    if (!watching) return;
    const set = watchers.get(watching.code);
    set?.delete(watching.watcher);
    if (!set?.size) watchers.delete(watching.code);
    watching = undefined;
    clearTimeout(watchTimeout);
  };
  const rejectVersion = (version: unknown) => {
    if (version === APP_PROTOCOL_VERSION) return false;
    rejectedProtocol = true;
    send(ws, {
      type: 'error',
      code: PROTOCOL_MISMATCH,
      message: PROTOCOL_RELOAD_MESSAGE,
    });
    ws.close(1008, 'App version mismatch');
    return true;
  };
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
      if (msg.type === 'watch' && !id) {
        if (rejectVersion(msg.protocolVersion)) return;
        if (!watches.allow(ip))
          throw new Error('Too many room lookups. Wait a minute.');
        const target = registry.find(String(msg.room ?? ''));
        unwatch();
        const set = watchers.get(target.code) ?? new Set<Watcher>();
        if (set.size >= MAX_WATCHERS)
          throw new Error('Too many devices are joining this room. Try again.');
        const watcher = { ws, network };
        set.add(watcher);
        watchers.set(target.code, set);
        watching = { code: target.code, watcher };
        clearTimeout(joinTimeout);
        watchTimeout = setTimeout(
          () => ws.close(1000, 'Watch ended'),
          WATCH_MS,
        );
        send(ws, preview(target, watcher));
        return;
      }
      if (msg.type === 'join' && !id) {
        if (rejectVersion(msg.protocolVersion)) return;
        if (!joins.allow(ip) || !globalJoins.allow('global'))
          throw new Error('Too many join attempts. Wait a minute.');
        const result = registry.join(msg);
        unwatch();
        room = result.room;
        id = result.member.id;
        const previous = sockets.get(id);
        sockets.set(id, ws);
        networks.set(id, network);
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
    unwatch();
    if (!room || !id || sockets.get(id) !== ws) return;
    sockets.delete(id);
    networks.delete(id);
    registry.disconnect(room, id);
    if (room.ended) {
      const reason = 'The host screen disconnected. The session has ended.';
      for (const memberId of room.members.keys()) {
        send(sockets.get(memberId), { type: 'ended', reason });
        sockets.get(memberId)?.close(1000, 'Session ended');
      }
      endWatchers(room, reason);
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
      const reason = 'This session expired after 12 hours.';
      for (const id of room.members.keys()) {
        send(sockets.get(id), { type: 'ended', reason });
        sockets.get(id)?.close();
      }
      endWatchers(room, reason);
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
