import { PartyGame } from '../games/engine.ts';
import { defaultCapabilities, manifests, resolveConfig } from './config.ts';
import { SequenceWindow, decodeInput } from './protocol.ts';
import { ContinuousBuffer, Equalizer, Samples } from './timing.ts';
import { SnapshotEncoder } from './snapshots.ts';
import {
  now,
  type Capabilities,
  type ControllerConfig,
  type GameEvent,
  type InputFrame,
  type Message,
  type Player,
  type Press,
  type Result,
  type Roster,
  type Snapshot,
} from './types.ts';
export interface SessionPorts {
  toPlayer: (id: string, message: Message) => void;
  toVenue: (id: string, message: Message) => void;
  snapshot: (id: string, message: Message) => void;
  event: (id: string, event: GameEvent) => void;
  warning: (message: string) => void;
}
export class SessionAuthority {
  private game = new PartyGame('latency-lab');
  private roster: Roster = { players: [], venues: [] };
  private capabilities = new Map<string, Capabilities>();
  private configs = new Map<string, ControllerConfig>();
  private windows = new Map<string, SequenceWindow>();
  private streams = new Map<string, ContinuousBuffer<InputFrame>>();
  private edgeSeen = new Map<string, number>();
  private edges = new Map<string, number[]>();
  private pendingPresses: Press[] = [];
  private widgetValues = new Map<string, Record<string, unknown>>();
  private ready = new Set<string>();
  private pending: { gameId: string; mode: string; at: number } | null = null;
  private lastTick = now() - 1000 / 60;
  private bootIds = new Map<string, string>();
  private presentedTimes = new Map<string, Map<string, number>>();
  private lastSnapshot = 0;
  private snapshotId = 0;
  private generation = 0;
  private lastTelemetry = 0;
  private lastPhase = 'lobby';
  private histories: { gameId: string; results: Result[] }[] = [];
  readonly encoder = new SnapshotEncoder();
  readonly equalizer = new Equalizer();
  readonly venueDelays = new Map<string, Samples>();
  readonly playerMetrics = new Map<
    string,
    {
      ages: Samples;
      count: number;
      start: number;
      lastAt: number;
      confidence: number;
      clock?: Message;
    }
  >();
  constructor(
    private hostId: string,
    private ports: SessionPorts,
  ) {
    this.venueDelays.set(hostId, new Samples());
    this.venueDelays.get(hostId)!.add(0);
  }
  setRoster(roster: Roster) {
    for (const old of this.roster.players) {
      const current = roster.players.find((p) => p.id === old.id);
      if (old.connected && !current?.connected)
        this.game.onPlayerDropped(old.id, now());
      else if (!old.connected && current?.connected)
        this.game.onPlayerReturned(old.id);
    }
    this.roster = structuredClone(roster);
    for (const v of roster.venues)
      if (v.connected) {
        if (!this.venueDelays.has(v.id))
          this.venueDelays.set(v.id, new Samples());
      } else this.venueDelays.delete(v.id);
    this.equalizer.update(this.venueDelays);
    for (const p of roster.players) {
      if (!this.configs.has(p.id)) this.configurePlayer(p);
      if (!p.connected) this.streams.delete(p.id);
    }
  }
  private configurePlayer(p: Player, force = false) {
    const manifest = manifests.find(
      (m) => m.id === (this.pending?.gameId ?? this.game.gameId),
    )!;
    try {
      let config = resolveConfig(
        manifest,
        this.capabilities.get(p.id) ?? defaultCapabilities(),
        this.generation,
      );
      const existing = this.configs.get(p.id);
      const changed =
        existing &&
        JSON.stringify({ ...existing, generation: 0 }) !==
          JSON.stringify({ ...config, generation: 0 });
      if (changed) {
        this.generation = (this.generation + 1) % 65536;
        config.generation = this.generation;
      } else if (existing && !force) config = existing;
      if (!existing || existing.generation !== config.generation) {
        this.ready.delete(p.id);
        this.windows.delete(p.id);
        this.streams.delete(p.id);
        this.edges.delete(p.id);
        this.widgetValues.delete(p.id);
        this.pendingPresses = this.pendingPresses.filter(
          (x) => x.playerId !== p.id,
        );
      }
      this.configs.set(p.id, config);
      this.ports.toPlayer(p.id, { type: 'config', config });
    } catch (error) {
      this.ports.toPlayer(p.id, { type: 'error', message: String(error) });
    }
  }
  control(from: string, msg: Message) {
    const time = now();
    if (msg.type === 'clock') {
      this.reply(from, { type: 'clockReply', t0: msg.t0, t1: time, t2: now() });
      return;
    }
    const player = this.roster.players.find((p) => p.id === from),
      venue = this.roster.venues.find((v) => v.id === from);
    if (
      msg.type === 'capabilities' &&
      player &&
      msg.capabilities?.sensors?.gyro &&
      msg.capabilities?.sensors?.accel
    ) {
      this.capabilities.set(from, msg.capabilities);
      this.configurePlayer(player);
    } else if (msg.type === 'hello' && player) {
      const newBoot =
        typeof msg.bootId === 'string' && this.bootIds.get(from) !== msg.bootId;
      if (newBoot) {
        this.bootIds.set(from, msg.bootId);
        this.generation = (this.generation + 1) % 65536;
      }
      this.configurePlayer(player, newBoot);
      this.ports.toPlayer(from, {
        type: 'phase',
        phase: this.game.state.phase,
        history: this.histories,
      });
    } else if (
      msg.type === 'ready' &&
      player &&
      msg.generation === this.configs.get(from)?.generation
    )
      this.ready.add(from);
    else if (msg.type === 'press' && player)
      this.press({ ...msg.press, playerId: from });
    else if (
      msg.type === 'widget' &&
      player &&
      this.configs.get(from)?.widgets.some((w) => w.action === msg.action) &&
      JSON.stringify(msg.value ?? null).length < 4096
    ) {
      const values = this.widgetValues.get(from) ?? {};
      values[msg.action] = structuredClone(msg.value);
      this.widgetValues.set(from, values);
    } else if (msg.type === 'clockStats' && player) {
      const m = this.playerMetrics.get(from);
      if (m) m.clock = msg;
    } else if (msg.type === 'venueHello' && venue)
      this.ports.toVenue(from, { type: 'history', history: this.histories });
    else if (msg.type === 'snapshotAck' && venue && Number.isInteger(msg.id))
      this.encoder.ack(from, msg.id);
    else if (msg.type === 'resync' && venue) this.encoder.acks.delete(from);
    else if (
      msg.type === 'presented' &&
      venue &&
      Number.isFinite(msg.at) &&
      Math.abs(now() - msg.at) < 5000
    ) {
      const key = `${msg.round}:${msg.promptId}`;
      const times = this.presentedTimes.get(key) ?? new Map<string, number>();
      times.set(from, msg.at);
      this.presentedTimes.set(key, times);
      while (this.presentedTimes.size > 30)
        this.presentedTimes.delete(this.presentedTimes.keys().next().value!);
    } else if (
      msg.type === 'venueStats' &&
      venue &&
      Number.isFinite(msg.delay)
    ) {
      this.venueDelays.get(from)?.add(Math.max(0, Math.min(2000, msg.delay)));
      this.equalizer.update(this.venueDelays);
    }
  }
  private reply(id: string, message: Message) {
    if (this.roster.venues.some((v) => v.id === id))
      this.ports.toVenue(id, message);
    else this.ports.toPlayer(id, message);
  }
  input(playerId: string, buffer: ArrayBuffer) {
    const p = this.roster.players.find((p) => p.id === playerId && p.connected);
    if (!p) return;
    let f: InputFrame;
    try {
      f = decodeInput(buffer, now());
    } catch {
      return;
    }
    if (
      f.generation !== this.configs.get(playerId)?.generation ||
      f.time > now() + 100 ||
      now() - f.time > 2000
    )
      return;
    let window = this.windows.get(playerId);
    if (!window) {
      window = new SequenceWindow();
      this.windows.set(playerId, window);
    }
    if (!window.accept(f.seq)) return;
    let stream = this.streams.get(playerId);
    if (!stream) {
      stream = new ContinuousBuffer();
      this.streams.set(playerId, stream);
    }
    stream.push(f, now());
    const prev = this.edges.get(playerId) ?? [0, 0, 0, 0];
    for (let b = 0; b < 4; b++) {
      const delta = (f.edges[b] - prev[b] + 256) % 256;
      if (delta > 0 && delta < 128)
        this.press({
          playerId,
          generation: f.generation,
          button: b,
          counter: f.edges[b],
          time: f.edgeTimes[b],
          x: f.x,
          y: f.y,
        });
    }
    this.edges.set(playerId, f.edges);
    let metrics = this.playerMetrics.get(playerId);
    if (!metrics) {
      metrics = {
        ages: new Samples(),
        count: 0,
        start: now(),
        lastAt: now(),
        confidence: 0,
      };
      this.playerMetrics.set(playerId, metrics);
    }
    metrics.ages.add(Math.max(0, now() - f.time));
    metrics.count++;
    metrics.lastAt = now();
    metrics.confidence = f.confidence;
  }
  private press(p: Press) {
    const time = now();
    if (
      p.generation !== this.configs.get(p.playerId)?.generation ||
      !Number.isInteger(p.button) ||
      p.button < 0 ||
      p.button > 3 ||
      !Number.isInteger(p.counter) ||
      p.counter < 0 ||
      p.counter > 255 ||
      ![p.time, p.x, p.y].every(Number.isFinite) ||
      p.time > time + 100 ||
      time - p.time > 2000
    )
      return;
    const key = `${p.playerId}:${p.generation}:${p.button}:${p.counter}:${Math.round(p.time)}`;
    if (this.edgeSeen.has(key)) return;
    this.edgeSeen.set(key, time);
    if (this.pendingPresses.length < 256) this.pendingPresses.push(p);
  }
  start(gameId: string, mode: string) {
    if (!manifests.some((m) => m.id === gameId))
      throw new Error('Unknown minigame');
    if (
      this.game.state.phase === 'running' ||
      this.game.state.phase === 'countdown' ||
      this.pending
    )
      throw new Error('Finish the current round first.');
    const players = this.roster.players.filter((p) => p.connected);
    if (players.length < 2)
      throw new Error('Connect at least two phones to start.');
    this.generation = (this.generation + 1) % 65536;
    this.ready.clear();
    this.windows.clear();
    this.streams.clear();
    this.edges.clear();
    this.edgeSeen.clear();
    this.pendingPresses = [];
    this.widgetValues.clear();
    this.pending = { gameId, mode, at: now() };
    for (const p of players) this.configurePlayer(p, true);
  }
  tick(time = now()) {
    if (time - this.lastTick < 1000 / 60) return;
    const dt = Math.min(50, Math.max(0, time - this.lastTick));
    this.lastTick = time;
    this.equalizer.tick(dt);
    if (this.pending) {
      const players = this.roster.players.filter((p) => p.connected);
      if (players.length >= 2 && players.every((p) => this.ready.has(p.id))) {
        this.game = new PartyGame(
          this.pending.gameId,
          manifests.find((m) => m.id === this.pending!.gameId)!.onPlayerDropped,
        );
        this.game.load();
        if (!this.game.ready())
          throw new Error('Minigame did not finish loading');
        this.game.configure(players, Object.fromEntries(this.configs));
        this.game.start(time, this.pending.mode);
        this.pending = null;
      } else if (time - this.pending.at > 15000) {
        this.pending = null;
        this.ports.warning(
          'A phone did not confirm its controller configuration. Reconnect it and try again.',
        );
      }
    }
    const inputs: Record<string, InputFrame> = {};
    for (const [id, stream] of this.streams) {
      const f = stream.sample(time);
      if (f && time - f.time < 500)
        inputs[id] = {
          ...f,
          values: structuredClone(this.widgetValues.get(id) ?? {}),
        };
    }
    // Bounded arbitration window: collect late contenders before judging by timestamp.
    const mature = this.pendingPresses.filter((p) => p.time <= time - 200);
    this.pendingPresses = this.pendingPresses.filter(
      (p) => p.time > time - 200,
    );
    for (const [key, at] of this.edgeSeen)
      if (time - at > 3000) this.edgeSeen.delete(key);
    const events = this.game.frame(
      structuredClone(inputs),
      structuredClone(mature),
      time,
      dt,
      this.equalizer.current,
    );
    if (this.game.state.phase !== this.lastPhase) {
      this.lastPhase = this.game.state.phase;
      if (this.lastPhase === 'results') {
        this.histories.push({
          gameId: this.game.gameId,
          results: this.game.results(),
        });
        this.histories = this.histories.slice(-50);
      }
      for (const p of this.roster.players)
        this.ports.toPlayer(p.id, {
          type: 'phase',
          phase: this.lastPhase,
          history: this.histories,
        });
      for (const v of this.roster.venues)
        this.ports.toVenue(v.id, { type: 'history', history: this.histories });
    }
    for (const event of events)
      for (const v of this.roster.venues.filter((v) => v.connected))
        this.ports.event(v.id, event);
    if (time - this.lastSnapshot >= 40) {
      this.lastSnapshot = time;
      const snapshot: Snapshot = {
        id: ++this.snapshotId,
        time,
        state: this.game.snapshot(),
      };
      this.encoder.add(snapshot);
      for (const v of this.roster.venues.filter((v) => v.connected))
        this.ports.snapshot(v.id, {
          type: 'snapshot',
          snapshot: this.encoder.forPeer(v.id, snapshot),
          delay: this.equalizer.current,
          limitingVenue: this.equalizer.limitingVenue,
        });
    }
    if (time - this.lastTelemetry > 1000) {
      this.lastTelemetry = time;
      const players = this.roster.players.map((p) => {
        const m = this.playerMetrics.get(p.id),
          stream = this.streams.get(p.id);
        return {
          id: p.id,
          name: p.name,
          age: m ? time - m.lastAt : null,
          hz: m ? m.count / Math.max(0.001, (time - m.start) / 1000) : 0,
          loss: this.windows.get(p.id)?.loss ?? 0,
          delay: m?.ages.summary(),
          confidence: m?.confidence ?? 0,
          buffer: stream?.depth ?? 0,
          horizon: stream?.horizon ?? 0,
          clock: m?.clock,
          substitutions: this.configs.get(p.id)?.substitutions ?? [],
        };
      });
      for (const v of this.roster.venues.filter((v) => v.connected))
        this.ports.toVenue(v.id, {
          type: 'telemetry',
          presentationSpreadMs: this.presentationSpread(),
          players,
          venues: [...this.venueDelays].map(([id, s]) => ({
            id,
            ...s.summary(),
          })),
          D: this.equalizer.current,
          limitingVenue: this.equalizer.limitingVenue,
        });
    }
  }
  private presentationSpread() {
    const key = `${this.game.state.startAt}:${this.game.state.promptId}`,
      times = this.presentedTimes.get(key);
    const venues = this.roster.venues.filter((v) => v.connected);
    if (!times || !venues.every((v) => times.has(v.id))) return null;
    const values = venues.map((v) => times.get(v.id)!);
    return Math.max(...values) - Math.min(...values);
  }
  summary() {
    return {
      completed: this.histories,
      players: [...this.playerMetrics].map(([id, m]) => ({
        id,
        delay: m.ages.summary(),
        loss: this.windows.get(id)?.loss ?? 0,
        substitutions: this.configs.get(id)?.substitutions ?? [],
      })),
    };
  }
}
