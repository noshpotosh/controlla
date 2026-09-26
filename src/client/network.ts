import type { Identity, Message, Role, Roster } from '../core/types.ts';
export type Channel = 'ctrl' | 'input' | 'snapshot' | 'events';
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
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
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
    this.stopped = false;
    this.onStatus('Connecting…');
    this.ws = new WebSocket(this.endpoint);
    this.ws.onopen = () => {
      this.retry = 0;
      this.sendServer({ type: 'join', ...this.request });
    };
    this.ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.type === 'welcome') {
          this.identity = msg.identity;
          this.request.token = msg.identity.token;
          this.iceServers = msg.iceServers;
          this.onStatus('Connected');
          this.onWelcome(msg.identity);
        } else if (msg.type === 'roster') {
          this.roster = { players: msg.players, venues: msg.venues };
          this.reconcile();
          this.onRoster(this.roster);
        } else if (msg.type === 'signal') {
          void this.peer(msg.from, false).signal(msg.data);
        } else if (msg.type === 'relay') {
          const data = msg.binary ? new Uint8Array(msg.data).buffer : msg.data;
          this.deliver(msg.from, msg.channel, data);
        } else if (msg.type === 'error') {
          this.onWarning(msg.message);
          if (!this.identity) {
            this.stopped = true;
            this.ws?.close();
          }
        } else if (msg.type === 'ended') {
          this.stopped = true;
          this.onEnded(msg.reason);
          this.close();
        }
      } catch {
        this.onWarning('Invalid signaling response');
      }
    };
    this.ws.onclose = () => {
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
    this.ws.onerror = () =>
      this.onWarning(
        'Cannot reach the room service. Check the server address and your connection.',
      );
  }
  private allowed(id: string) {
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
    if (this.peer(to, this.identity!.id < to).send(channel, data)) return;
    this.sendServer(
      {
        type: 'relay',
        to,
        channel,
        data:
          data instanceof ArrayBuffer ? Array.from(new Uint8Array(data)) : data,
        binary: data instanceof ArrayBuffer,
      },
      channel === 'input' || channel === 'snapshot',
    );
  }
  sendServer(data: unknown, droppable = false) {
    if (
      this.ws?.readyState === WebSocket.OPEN &&
      this.ws.bufferedAmount < (droppable ? 65536 : 2 ** 20)
    )
      this.ws.send(JSON.stringify(data));
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
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    for (const p of this.peers.values()) p.close();
    this.peers.clear();
    this.ws?.close();
  }
}
