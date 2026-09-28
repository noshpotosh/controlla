import {
  APP_PROTOCOL_VERSION,
  PROTOCOL_MISMATCH,
  PROTOCOL_RELOAD_MESSAGE,
} from '../core/app-protocol.ts';
import type { Identity, Message, Role, Roster } from '../core/types.ts';
import { MAX_MESSAGE_BYTES, messageFits } from './engine/history.ts';
export type Channel = 'ctrl' | 'input' | 'snapshot' | 'events';
const MAX_HISTORY_QUEUE_BYTES = 64 * 1024 * 1024;
const HISTORY_HIGH_WATER_BYTES = 64 * 1024;
const HISTORY_RETRY_MS = 50;
const utf8 = new TextEncoder();
interface HistoryPart {
  serialized: string;
  bytes: number;
}
interface HistoryQueue {
  to: string;
  target: string | null;
  revision: number;
  count: number;
  parts: Map<number, HistoryPart>;
}
function historyPart(data: unknown): {
  revision: number;
  index: number;
  count: number;
  target: string | null;
} | null {
  if (!data || typeof data !== 'object') return null;
  const outer = data as Message;
  const wrapped = outer.type === 'toController';
  const batch = wrapped ? (outer.message as Message | undefined) : outer;
  if (
    !batch ||
    batch.type !== 'progressBatch' ||
    (wrapped && typeof outer.target !== 'string') ||
    !Number.isSafeInteger(batch.revision) ||
    batch.revision < 0 ||
    !Number.isInteger(batch.count) ||
    batch.count < 1 ||
    batch.count > 1024 ||
    !Number.isInteger(batch.index) ||
    batch.index < 0 ||
    batch.index >= batch.count ||
    typeof batch.payload !== 'string' ||
    batch.payload.length > 8192
  )
    return null;
  return {
    revision: batch.revision,
    index: batch.index,
    count: batch.count,
    target: wrapped ? outer.target : null,
  };
}

export interface LinkStats {
  path: 'connecting' | 'P2P' | 'TURN' | 'WebSocket';
  rtt: number | null;
  localCandidate?: string;
  remoteCandidate?: string;
}
class Peer {
  pc: RTCPeerConnection;
  channels = new Map<Channel, RTCDataChannel>();
  candidates: RTCIceCandidateInit[] = [];
  stats: LinkStats = { path: 'connecting', rtt: null };
  constructor(
    public id: string,
    private network: Network,
    initiator: boolean,
  ) {
    this.pc = new RTCPeerConnection({ iceServers: network.iceServers });
    (['ctrl', 'input', 'snapshot', 'events'] as Channel[]).forEach(
      (name, index) => {
        const unreliable = name === 'input' || name === 'snapshot';
        const dc = this.pc.createDataChannel(name, {
          negotiated: true,
          id: index,
          ordered: !unreliable,
          ...(unreliable ? { maxRetransmits: 0 } : {}),
        });
        dc.binaryType = 'arraybuffer';
        dc.onmessage = (e) => {
          try {
            if (
              typeof e.data === 'string' &&
              new TextEncoder().encode(e.data).byteLength > MAX_MESSAGE_BYTES
            )
              throw new Error('Peer message exceeds the transport limit');
            network.deliver(
              id,
              name,
              e.data instanceof ArrayBuffer ? e.data : JSON.parse(e.data),
            );
          } catch {
            network.onWarning('A malformed peer message was ignored.');
          }
        };
        this.channels.set(name, dc);
      },
    );
    this.pc.onicecandidate = (e) => {
      if (e.candidate) network.signal(id, { candidate: e.candidate.toJSON() });
    };
    this.pc.onconnectionstatechange = () => {
      if (this.pc.connectionState === 'failed') this.stats.path = 'WebSocket';
    };
    if (initiator) void this.offer();
  }
  async offer() {
    try {
      await this.pc.setLocalDescription(await this.pc.createOffer());
      this.network.signal(this.id, { description: this.pc.localDescription });
    } catch {
      this.stats.path = 'WebSocket';
    }
  }
  async signal(data: Message) {
    try {
      if (data.description) {
        await this.pc.setRemoteDescription(data.description);
        for (const c of this.candidates) await this.pc.addIceCandidate(c);
        this.candidates = [];
        if (data.description.type === 'offer') {
          await this.pc.setLocalDescription(await this.pc.createAnswer());
          this.network.signal(this.id, {
            description: this.pc.localDescription,
          });
        }
      } else if (data.candidate) {
        if (this.pc.remoteDescription)
          await this.pc.addIceCandidate(data.candidate);
        else this.candidates.push(data.candidate);
      }
    } catch {
      this.stats.path = 'WebSocket';
    }
  }
  send(channel: Channel, data: unknown) {
    const dc = this.channels.get(channel);
    if (dc?.readyState === 'open') {
      if (
        dc.bufferedAmount > 65536 &&
        (channel === 'input' || channel === 'snapshot')
      )
        return true;
      if (dc.bufferedAmount > 2 ** 20) {
        this.network.onWarning('Reliable transport is congested.');
        return false;
      }
      try {
        if (data instanceof ArrayBuffer) dc.send(data);
        else dc.send(JSON.stringify(data));
        return true;
      } catch {
        return false;
      }
    }
    this.stats.path = 'WebSocket';
    return false;
  }
  async measure() {
    try {
      const stats = await this.pc.getStats();
      stats.forEach((s) => {
        if (s.type === 'transport' && s.selectedCandidatePairId) {
          const pair = stats.get(s.selectedCandidatePairId),
            a = stats.get(pair?.localCandidateId),
            b = stats.get(pair?.remoteCandidateId);
          this.stats = {
            path:
              a?.candidateType === 'relay' || b?.candidateType === 'relay'
                ? 'TURN'
                : 'P2P',
            rtt:
              pair?.currentRoundTripTime != null
                ? pair.currentRoundTripTime * 1000
                : null,
            localCandidate: a?.candidateType,
            remoteCandidate: b?.candidateType,
          };
        }
      });
    } catch {
      /* Closed peers are removed by roster updates. */
    }
    return this.stats;
  }
  close() {
    this.pc.close();
  }
}
export class Network {
  ws: WebSocket | null = null;
  identity: Identity | null = null;
  roster: Roster = { players: [], venues: [] };
  peers = new Map<string, Peer>();
  iceServers: RTCIceServer[] = [];
  stopped = false;
  private retry = 0;
  private welcomed = false;
  private incompatible = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private historyTimer: ReturnType<typeof setTimeout> | null = null;
  private historyBytes = 0;
  private readonly historyQueues = new Map<string, HistoryQueue>();
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
  constructor(
    public endpoint: string,
    private request: {
      role: Role;
      room?: string;
      venueId?: string;
      name?: string;
      token?: string;
    },
  ) {}
  connect() {
    if (this.incompatible) return;
    this.clearHistory();
    this.welcomed = false;
    this.stopped = false;
    this.onStatus('Connecting…');
    const socket = new WebSocket(this.endpoint);
    this.ws = socket;
    socket.onopen = () => {
      if (this.ws !== socket || this.stopped) return;
      this.retry = 0;
      this.sendServer({
        type: 'join',
        ...this.request,
        protocolVersion: APP_PROTOCOL_VERSION,
      });
    };
    socket.onmessage = (e) => {
      if (this.ws !== socket || this.stopped) return;
      try {
        const msg = JSON.parse(e.data);
        if (this.stopped) return;
        if (msg.type === 'welcome') {
          if (msg.protocolVersion !== APP_PROTOCOL_VERSION) {
            this.rejectProtocol();
            return;
          }
          this.welcomed = true;
          this.identity = msg.identity;
          this.request.token = msg.identity.token;
          this.iceServers = msg.iceServers;
          this.onStatus('Connected');
          this.onWelcome(msg.identity);
        } else if (msg.type === 'error') {
          if (msg.code === PROTOCOL_MISMATCH) {
            this.rejectProtocol();
            return;
          }
          this.onWarning(msg.message);
          if (!this.welcomed) this.close();
        } else if (!this.welcomed) {
          return;
        } else if (msg.type === 'roster') {
          this.roster = { players: msg.players, venues: msg.venues };
          this.reconcile();
          this.onRoster(this.roster);
        } else if (msg.type === 'signal') {
          void this.peer(msg.from, false).signal(msg.data);
        } else if (msg.type === 'relay') {
          const data = msg.binary ? new Uint8Array(msg.data).buffer : msg.data;
          this.deliver(msg.from, msg.channel, data);
        } else if (msg.type === 'ended') {
          this.stopped = true;
          this.onEnded(msg.reason);
          this.close();
        }
      } catch {
        this.onWarning('Invalid signaling response');
      }
    };
    socket.onclose = () => {
      if (this.ws !== socket) return;
      this.welcomed = false;
      this.clearHistory();
      for (const p of this.peers.values()) p.close();
      this.peers.clear();
      if (this.stopped) return;
      if (this.identity?.role === 'host') {
        this.stopped = true;
        this.onEnded('The host connection closed. This session has ended.');
        return;
      }
      this.onStatus('Reconnecting…');
      this.reconnectTimer = setTimeout(
        () => this.connect(),
        Math.min(5000, 500 * 2 ** this.retry++),
      );
    };
    socket.onerror = () => {
      if (this.ws !== socket || this.stopped) return;
      this.onWarning(
        'Cannot reach the room service. Check the server address and your connection.',
      );
    };
  }
  private rejectProtocol() {
    this.incompatible = true;
    this.welcomed = false;
    this.identity = null;
    this.roster = { players: [], venues: [] };
    this.onWarning(PROTOCOL_RELOAD_MESSAGE);
    this.onStatus('Reload required');
    this.close();
  }
  private allowed(id: string) {
    if (!this.welcomed || this.stopped) return false;
    const me = this.identity;
    if (!me) return false;
    const player = this.roster.players.find((p) => p.id === id),
      venue = this.roster.venues.find((v) => v.id === id);
    return me.role === 'controller'
      ? id === me.venueId || id === me.hostId
      : me.role === 'host'
        ? !!(player || venue)
        : id === me.hostId || player?.venueId === me.id;
  }
  private reconcile() {
    const me = this.identity;
    if (!me) return;
    const wanted =
      me.role === 'controller'
        ? this.roster.venues.some((v) => v.id === me.venueId && v.connected)
          ? [me.venueId]
          : []
        : me.role === 'display'
          ? [
              me.hostId,
              ...this.roster.players
                .filter((p) => p.venueId === me.id && p.connected)
                .map((p) => p.id),
            ]
          : [
              ...this.roster.venues
                .filter((v) => v.connected && v.id !== me.id)
                .map((v) => v.id),
              ...this.roster.players
                .filter((p) => p.venueId === me.id && p.connected)
                .map((p) => p.id),
            ];
    for (const id of wanted) if (id !== me.id) this.peer(id, me.id < id);
    for (const [id, p] of this.peers)
      if (!wanted.includes(id) && id !== me.hostId) {
        p.close();
        this.peers.delete(id);
      }
    this.pruneHistory();
  }
  private historyConnected(to: string, target: string | null): boolean {
    if (!this.allowed(to)) return false;
    const recipient =
      this.roster.players.find((p) => p.id === to) ??
      this.roster.venues.find((v) => v.id === to);
    if (!recipient?.connected) return false;
    if (
      target !== null &&
      !this.roster.players.some(
        (p) => p.id === target && p.connected && p.venueId === to,
      )
    )
      return false;
    return true;
  }
  private dropHistory(key: string): void {
    const queue = this.historyQueues.get(key);
    if (!queue) return;
    for (const part of queue.parts.values()) this.historyBytes -= part.bytes;
    this.historyQueues.delete(key);
  }
  private pruneHistory(): void {
    for (const [key, queue] of this.historyQueues)
      if (!this.historyConnected(queue.to, queue.target)) this.dropHistory(key);
    if (this.historyBytes === 0 && this.historyTimer !== null) {
      clearTimeout(this.historyTimer);
      this.historyTimer = null;
    }
  }
  private clearHistory(): void {
    if (this.historyTimer !== null) clearTimeout(this.historyTimer);
    this.historyTimer = null;
    this.historyQueues.clear();
    this.historyBytes = 0;
  }
  private scheduleHistory(): void {
    if (
      this.historyTimer !== null ||
      !this.historyBytes ||
      this.stopped ||
      !this.welcomed
    )
      return;
    this.historyTimer = setTimeout(() => {
      this.historyTimer = null;
      this.flushHistory();
    }, HISTORY_RETRY_MS);
  }
  private queueHistory(
    to: string,
    data: unknown,
    part: NonNullable<ReturnType<typeof historyPart>>,
  ): void {
    if (!this.historyConnected(to, part.target)) return;
    const key = JSON.stringify([to, part.target]);
    let queue = this.historyQueues.get(key);
    if (queue && part.revision < queue.revision) return;
    if (queue && part.revision > queue.revision) {
      this.dropHistory(key);
      queue = undefined;
    }
    if (queue && part.count !== queue.count) return;
    const serialized = JSON.stringify(data);
    const bytes = utf8.encode(serialized).byteLength;
    const previous = queue?.parts.get(part.index);
    if (
      this.historyBytes - (previous?.bytes ?? 0) + bytes >
      MAX_HISTORY_QUEUE_BYTES
    ) {
      this.onWarning(
        'Session report delivery is full. Reconnect to retry the report.',
      );
      return;
    }
    if (!queue) {
      queue = {
        to,
        target: part.target,
        revision: part.revision,
        count: part.count,
        parts: new Map(),
      };
      this.historyQueues.set(key, queue);
    }
    // Serialized data is immutable even if the caller reuses its message object.
    queue.parts.set(part.index, { serialized, bytes });
    this.historyBytes += bytes - (previous?.bytes ?? 0);
    this.scheduleHistory();
  }
  private flushHistory(): void {
    if (this.stopped || !this.welcomed) {
      this.clearHistory();
      return;
    }
    this.pruneHistory();
    for (const [key, queue] of this.historyQueues) {
      const peer = this.peer(queue.to, this.identity!.id < queue.to);
      for (const [index, part] of queue.parts) {
        if (this.historyQueues.get(key) !== queue) break;
        const dc = peer.channels.get('ctrl');
        try {
          if (dc?.readyState === 'open') {
            // Reserve capacity for configuration, clock, and event traffic. An
            // open congested channel must not spill history onto another route.
            if (dc.bufferedAmount + part.bytes > HISTORY_HIGH_WATER_BYTES)
              break;
            dc.send(part.serialized);
          } else {
            const socket = this.ws;
            const prefix = JSON.stringify({
              type: 'relay',
              to: queue.to,
              channel: 'ctrl',
            }).slice(0, -1);
            const serialized = `${prefix},"data":${part.serialized},"binary":false}`;
            const bytes = utf8.encode(serialized).byteLength;
            if (
              !socket ||
              socket.readyState !== WebSocket.OPEN ||
              socket.bufferedAmount + bytes > HISTORY_HIGH_WATER_BYTES
            )
              break;
            socket.send(serialized);
            peer.stats.path = 'WebSocket';
          }
        } catch {
          break;
        }
        queue.parts.delete(index);
        this.historyBytes -= part.bytes;
      }
    }
    this.scheduleHistory();
  }
  peer(id: string, initiate = false) {
    let p = this.peers.get(id);
    if (!p) {
      p = new Peer(id, this, initiate);
      this.peers.set(id, p);
    }
    return p;
  }
  signal(to: string, data: unknown) {
    this.sendServer({ type: 'signal', to, data });
  }
  deliver(from: string, channel: Channel, data: Message | ArrayBuffer) {
    if (this.allowed(from)) this.onMessage(from, channel, data);
  }
  send(to: string, channel: Channel, data: unknown) {
    if (!this.allowed(to)) return;
    const wireData =
      data instanceof ArrayBuffer ? Array.from(new Uint8Array(data)) : data;
    if (!messageFits(wireData, this.identity!.id, to, channel)) {
      this.onWarning(
        'A message exceeded the transport limit and was not sent.',
      );
      return;
    }
    const part = channel === 'ctrl' ? historyPart(data) : null;
    if (part) {
      this.queueHistory(to, data, part);
      return;
    }
    if (this.peer(to, this.identity!.id < to).send(channel, data)) return;
    this.sendServer(
      {
        type: 'relay',
        to,
        channel,
        data: wireData,
        binary: data instanceof ArrayBuffer,
      },
      channel === 'input' || channel === 'snapshot',
    );
  }
  sendServer(data: unknown, droppable = false) {
    const serialized = JSON.stringify(data);
    if (new TextEncoder().encode(serialized).byteLength > MAX_MESSAGE_BYTES) {
      this.onWarning(
        'A message exceeded the transport limit and was not sent.',
      );
      return;
    }
    if (
      this.ws?.readyState === WebSocket.OPEN &&
      this.ws.bufferedAmount < (droppable ? 65536 : 2 ** 20)
    )
      this.ws.send(serialized);
  }
  isOpen(id: string, channel: Channel = 'input') {
    return this.peers.get(id)?.channels.get(channel)?.readyState === 'open';
  }
  ensureHostFallback() {
    const host = this.identity?.hostId;
    if (host && host !== this.identity?.venueId && !this.peers.has(host))
      this.peer(host, true);
  }
  async stats() {
    const result: Record<string, LinkStats> = {};
    await Promise.all(
      [...this.peers].map(async ([id, p]) => {
        result[id] = await p.measure();
      }),
    );
    return result;
  }
  close() {
    this.stopped = true;
    this.clearHistory();
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    for (const p of this.peers.values()) p.close();
    this.peers.clear();
    this.ws?.close();
  }
}
