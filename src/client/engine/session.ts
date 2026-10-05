import { defaultCapabilities } from '../controls/resolve.ts';
import { defaultGame, findGame, resolveMode } from '../minigames/catalog.ts';
import { resolveController } from './input.ts';
import { RoundRunner } from './round.ts';
import { SessionProgress, completedResults } from './progress.ts';
import { historyMessages, messageFits } from './history.ts';
import type {
  GameInput,
  Point,
  PresentationEvent,
  RoundSnapshot,
  ValueSample,
} from '../api/index.ts';
import { SequenceWindow, decodeInput, type InputFrame } from './protocol.ts';
import { ContinuousBuffer, Equalizer, Samples, now } from './timing.ts';
import { SnapshotEncoder, type Snapshot } from './replication.ts';
import { ARBITRATION_MS } from './arbitration.ts';
import { channelOf, usesPressSlot } from '../controls/registry.ts';
import {
  parseActivationValue,
  parseControlValue,
  valueFitsEnvelope,
} from '../controls/value.ts';
import type { Capabilities, ControllerConfig } from '../controls/api.ts';
import type { Message } from './messages.ts';
import type { Press } from './reliable-input.ts';
import { type Player, type Roster } from '../../shared/room.ts';
export interface SessionPorts {
  toPlayer: (id: string, message: Message) => void;
  toVenue: (id: string, message: Message) => void;
  snapshot: (id: string, message: Message) => void;
  event: (id: string, event: PresentationEvent & { roundId: string }) => void;
  warning: (message: string) => void;
}
export class SessionAuthority {
  private runner: RoundRunner | null = null;
  private readonly progress = new SessionProgress();
  private selectedGame = defaultGame.id;
  private selectedMode = defaultGame.defaultMode;
  private disposed = false;
  private progressRevisionSent = -1;
  private latestMarker: string | null = null;
  private markers = new Map<string, PresentationEvent>();
  private cursors: Record<string, Point> = {};
  private roster: Roster = { players: [], venues: [] };
  private capabilities = new Map<string, Capabilities>();
  private configs = new Map<string, ControllerConfig>();
  private windows = new Map<string, SequenceWindow>();
  private streams = new Map<string, ContinuousBuffer<InputFrame>>();
  private edgeSeen = new Map<string, number>();
  private edges = new Map<string, number[]>();
  private widgetValues = new Map<string, GameInput['values'][string]>();
  private widgetSequences = new Map<
    string,
    Map<string, { generation: number; seq: number }>
  >();
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
  readonly encoder = new SnapshotEncoder<RoundSnapshot>();
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
    const returned = new Set<string>();
    const time = now();
    const clearDisconnectedInput = (id: string) => {
      this.streams.delete(id);
      this.widgetValues.delete(id);
      this.widgetSequences.delete(id);
      delete this.cursors[id];
    };
    for (const old of this.roster.players) {
      const current = roster.players.find((p) => p.id === old.id);
      if (!current?.connected) {
        clearDisconnectedInput(old.id);
        if (old.connected) this.runner?.connection(old.id, false, time);
      } else if (!old.connected) {
        returned.add(old.id);
        this.runner?.connection(old.id, true, time);
      }
    }
    // A removed identity returning is also a reconnect, even without an
    // intermediate disconnected entry retained in the caller's roster.
    for (const player of roster.players)
      if (
        player.connected &&
        this.configs.has(player.id) &&
        !this.roster.players.some(
          (old) => old.id === player.id && old.connected,
        )
      ) {
        if (!returned.has(player.id))
          this.runner?.connection(player.id, true, time);
        returned.add(player.id);
      }
    this.roster = structuredClone(roster);
    for (const v of roster.venues)
      if (v.connected) {
        if (!this.venueDelays.has(v.id))
          this.venueDelays.set(v.id, new Samples());
      } else this.venueDelays.delete(v.id);
    this.equalizer.update(this.venueDelays);
    for (const p of roster.players) {
      if (returned.has(p.id)) {
        this.generation = (this.generation + 1) % 65536;
        this.configurePlayer(p, true);
      } else if (!this.configs.has(p.id)) this.configurePlayer(p);
      if (!p.connected) clearDisconnectedInput(p.id);
    }
  }
  private configurePlayer(p: Player, force = false) {
    const descriptor = findGame(this.selectedGame)!;
    try {
      let config = resolveController(
        descriptor,
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
        this.widgetSequences.delete(p.id);
        this.runner?.clearInput(p.id, now());
        delete this.cursors[p.id];
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
      this.ports.toPlayer(from, this.phaseMessage());
      this.sendProgress(from);
    } else if (
      msg.type === 'ready' &&
      player?.connected &&
      this.configs.has(from) &&
      msg.generation === this.configs.get(from)?.generation
    )
      this.ready.add(from);
    else if (msg.type === 'press' && player)
      this.press({ ...msg.press, playerId: from });
    else if (
      msg.type === 'widget' &&
      player?.connected &&
      this.ready.has(from)
    ) {
      const config = this.configs.get(from);
      const widget = config?.widgets.find((w) => w.action === msg.action);
      if (
        !config ||
        !widget ||
        channelOf(widget.type).channel === 'press' ||
        msg.generation !== config.generation ||
        !Number.isSafeInteger(msg.seq) ||
        msg.seq < 0 ||
        !Number.isFinite(msg.time) ||
        msg.time > time + 100 ||
        time - msg.time > 2000 ||
        !valueFitsEnvelope(msg.value)
      )
        return;
      const value = parseControlValue(widget.type, msg.value);
      if (value === undefined) return;
      const sequences =
        this.widgetSequences.get(from) ??
        new Map<string, { generation: number; seq: number }>();
      const previous = sequences.get(widget.action);
      if (previous?.generation === config.generation && msg.seq <= previous.seq)
        return;
      sequences.set(widget.action, {
        generation: config.generation,
        seq: msg.seq,
      });
      this.widgetSequences.set(from, sequences);
      this.widgetValues.set(from, {
        ...this.widgetValues.get(from),
        [widget.action]: { value, time: msg.time },
      });
    } else if (msg.type === 'clockStats' && player) {
      const m = this.playerMetrics.get(from);
      if (m) m.clock = msg;
    } else if (msg.type === 'venueHello' && venue?.connected) {
      this.ports.toVenue(from, this.phaseMessage());
      this.sendProgress(from);
    } else if (msg.type === 'snapshotAck' && venue && Number.isInteger(msg.id))
      this.encoder.ack(from, msg.id);
    else if (msg.type === 'resync' && venue) this.encoder.acks.delete(from);
    else if (
      msg.type === 'presented' &&
      venue?.connected &&
      msg.roundId === this.runner?.roundId &&
      typeof msg.eventId === 'string' &&
      Number.isFinite(msg.at) &&
      Math.abs(time - msg.at) < 5000
    ) {
      const marker = this.markers.get(msg.eventId);
      if (!marker?.measure || msg.at < marker.time) return;
      const key = `${msg.roundId}:${msg.eventId}`;
      const times = this.presentedTimes.get(key) ?? new Map<string, number>();
      if (times.has(from)) return;
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
    if (!p || !this.ready.has(playerId)) return;
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
      const widget = this.configs
        .get(playerId)
        ?.widgets.filter((w) => usesPressSlot(w.type))[b];
      // A recovered binary edge cannot reconstruct an atomic swipe/charge value.
      if (
        delta > 0 &&
        delta < 128 &&
        widget &&
        channelOf(widget.type).channel === 'press'
      )
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
    const player = this.roster.players.find(
      (candidate) => candidate.id === p.playerId && candidate.connected,
    );
    const config = this.configs.get(p.playerId);
    const widget = config?.widgets.filter((w) => usesPressSlot(w.type))[
      p.button
    ];
    const state = this.runner;
    if (
      !player ||
      !config ||
      !widget ||
      !state ||
      !this.ready.has(p.playerId) ||
      this.pending ||
      !['countdown', 'running', 'settling'].includes(state.phase) ||
      time < state.startAt ||
      p.time < state.startAt ||
      p.time >= state.endAt ||
      time >= state.endAt + ARBITRATION_MS
    )
      return;
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
    const both = channelOf(widget.type).channel === 'both';
    const value =
      both && valueFitsEnvelope(p.value)
        ? parseActivationValue(widget.type, p.value)
        : undefined;
    if ((both && value === undefined) || (!both && p.value !== undefined))
      return;
    const key = `${p.playerId}:${p.generation}:${p.button}:${p.counter}:${Math.round(p.time * 1000)}`;
    if (this.edgeSeen.has(key)) return;
    if (
      state.input(
        {
          playerId: p.playerId,
          name: widget.action,
          time: p.time,
          aim: { x: p.x, y: p.y },
          ...(both ? { value } : {}),
        },
        time,
      )
    )
      this.edgeSeen.set(key, time);
  }
  start(gameId: string, mode: string) {
    if (this.disposed) throw new Error('This session has ended.');
    const descriptor = findGame(gameId);
    if (!descriptor) throw new Error('Unknown minigame');
    const selectedMode = resolveMode(descriptor, mode);
    if (
      this.pending ||
      (this.runner &&
        ['countdown', 'running', 'settling'].includes(this.runner.phase))
    )
      throw new Error('Finish the current round first.');
    const players = this.roster.players.filter((p) => p.connected);
    if (
      players.length < descriptor.players.min ||
      players.length > descriptor.players.max
    )
      throw new Error(
        `${descriptor.name} needs ${descriptor.players.min}–${descriptor.players.max} connected phones.`,
      );
    // Validate every required binding before disturbing the previous round/configuration.
    for (const player of players)
      resolveController(
        descriptor,
        this.capabilities.get(player.id) ?? defaultCapabilities(),
        this.generation,
      );
    const runner = new RoundRunner(descriptor, this.progress, selectedMode);
    this.runner?.dispose();
    this.selectedGame = descriptor.id;
    this.selectedMode = selectedMode;
    this.generation = (this.generation + 1) % 65536;
    this.ready.clear();
    this.windows.clear();
    this.streams.clear();
    this.edges.clear();
    this.edgeSeen.clear();
    this.widgetValues.clear();
    this.widgetSequences.clear();
    this.markers.clear();
    this.presentedTimes.clear();
    this.latestMarker = null;
    this.cursors = {};
    this.runner = runner;
    this.pending = { gameId, mode: selectedMode, at: now() };
    for (const player of players) this.configurePlayer(player, true);
    void this.runner.load();
    this.announce();
  }
  abort() {
    this.pending = null;
    this.runner?.abort();
    this.cursors = {};
    this.announce();
    this.publish(now(), true);
  }
  private phaseMessage(): Message {
    return {
      type: 'phase',
      phase: this.pending ? 'loading' : (this.runner?.phase ?? 'lobby'),
      gameId: this.selectedGame,
      mode: this.selectedMode,
      roundId: this.runner?.roundId ?? null,
      error: this.runner?.error ?? null,
    };
  }
  private sendProgress(id: string) {
    try {
      for (const message of historyMessages(this.progress.view()))
        this.reply(id, message);
    } catch (error) {
      // The host ledger remains intact even if an unusually long session cannot hydrate.
      this.ports.warning(
        error instanceof Error ? error.message : String(error),
      );
    }
  }
  private announce() {
    const message = this.phaseMessage();
    const key = JSON.stringify(message);
    if (key !== this.lastPhase) {
      this.lastPhase = key;
      for (const player of this.roster.players.filter((p) => p.connected))
        this.ports.toPlayer(player.id, message);
      for (const venue of this.roster.venues.filter((v) => v.connected))
        this.ports.toVenue(venue.id, message);
      if (message.error) this.ports.warning(message.error);
    }
    if (this.progress.revision !== this.progressRevisionSent) {
      this.progressRevisionSent = this.progress.revision;
      for (const player of this.roster.players.filter((p) => p.connected))
        this.sendProgress(player.id);
      for (const venue of this.roster.venues.filter((v) => v.connected))
        this.sendProgress(venue.id);
    }
  }
  private publish(time: number, force = false) {
    if (!force && time - this.lastSnapshot < 40) return;
    const state = this.runner?.snapshot(this.cursors);
    if (!state) return;
    this.lastSnapshot = time;
    const snapshot: Snapshot<RoundSnapshot> = {
      id: ++this.snapshotId,
      time,
      state,
    };
    this.encoder.add(snapshot);
    for (const venue of this.roster.venues.filter((v) => v.connected)) {
      const message = {
        type: 'snapshot',
        snapshot: this.encoder.forPeer(venue.id, snapshot),
        delay: this.equalizer.current,
        limitingVenue: this.equalizer.limitingVenue,
      };
      if (!messageFits(message, this.hostId, venue.id, 'snapshot')) {
        this.runner?.abort('Game snapshot exceeds the transport limit.');
        this.ports.warning('Game snapshot exceeds the transport limit.');
        return;
      }
      this.ports.snapshot(venue.id, message);
    }
  }
  tick(time = now()) {
    if (this.disposed || time - this.lastTick < 1000 / 60) return;
    const dt = Math.min(50, Math.max(0, time - this.lastTick));
    this.lastTick = time;
    this.equalizer.tick(dt);
    const previousPhase = this.runner?.phase;
    if (this.pending && this.runner) {
      const players = this.roster.players.filter((p) => p.connected);
      if (this.runner.phase === 'error') this.pending = null;
      else if (time - this.pending.at >= 15000) {
        this.runner.abort(
          'Game or controller configuration did not become ready within 15 seconds. Reconnect and try again.',
        );
        this.pending = null;
      } else if (
        this.runner.loaded &&
        players.length >= this.runner.descriptor.players.min &&
        players.length <= this.runner.descriptor.players.max &&
        players.every((p) => this.ready.has(p.id))
      ) {
        this.runner.begin(players, time);
        this.pending = null;
      }
    }
    const values: Record<string, Record<string, ValueSample>> = {};
    for (const player of this.roster.players.filter(
      (p) => p.connected && this.ready.has(p.id),
    )) {
      const frame = this.streams.get(player.id)?.sample(time);
      const widgets = this.configs.get(player.id)?.widgets ?? [];
      const samples = this.widgetValues.get(player.id) ?? {};
      const active: Record<string, ValueSample> = {};
      // Held buttons are continuous state, separate from timestamped press
      // actions. Retire them promptly when a phone stops sending frames.
      const pressWidgets = widgets.filter((widget) =>
        usesPressSlot(widget.type),
      );
      for (let slot = 0; slot < pressWidgets.length; slot++) {
        const widget = pressWidgets[slot];
        if (!widget.held || channelOf(widget.type).channel !== 'press')
          continue;
        active[widget.action] = {
          value: !!(
            frame &&
            time - frame.time < 250 &&
            frame.buttons & (1 << slot)
          ),
          time: frame?.time ?? time,
        };
      }
      for (const widget of widgets) {
        const sample = samples[widget.action];
        if (
          !sample ||
          (time - sample.time >= 500 && (!frame || time - frame.time >= 500))
        )
          continue;
        const copied = structuredClone(sample);
        if (frame && time - frame.time < 500)
          copied.observedAt = Math.max(sample.time, frame.time);
        if (
          widget.space === 'normalized' &&
          ['stick', 'dpad', 'aim-pad'].includes(widget.type)
        ) {
          const point = copied.value as Point;
          copied.value = { x: (point.x + 1) / 2, y: (point.y + 1) / 2 };
        }
        active[widget.action] = copied;
      }
      // Binary motion has one coordinate pair. Touch values retain their independent channels.
      const primary =
        widgets.find((widget) => ['pointer', 'tilt'].includes(widget.type)) ??
        widgets.find((widget) =>
          ['stick', 'dpad', 'aim-pad'].includes(widget.type),
        );
      if (frame && time - frame.time < 500 && primary) {
        const touch = active[primary.action];
        if (!touch || ['pointer', 'tilt'].includes(primary.type))
          active[primary.action] = {
            value: { x: frame.x, y: frame.y },
            time: frame.time,
          };
      }
      for (const widget of widgets) {
        const sample = active[widget.action];
        const point = sample?.value as Point | undefined;
        if (
          widget.space === 'normalized' &&
          point &&
          typeof point === 'object' &&
          Number.isFinite(point.x) &&
          Number.isFinite(point.y)
        )
          this.cursors[player.id] = { x: point.x, y: point.y };
      }
      values[player.id] = active;
    }
    const events =
      this.runner?.tick(time, dt, values, this.equalizer.current) ?? [];
    for (const [key, at] of this.edgeSeen)
      if (time - at > 3000) this.edgeSeen.delete(key);
    for (const event of events) {
      if (event.measure) {
        this.markers.set(event.id, structuredClone(event));
        this.latestMarker = `${this.runner!.roundId}:${event.id}`;
        while (this.markers.size > 128)
          this.markers.delete(this.markers.keys().next().value!);
      }
      for (const venue of this.roster.venues.filter((v) => v.connected))
        this.ports.event(venue.id, {
          ...event,
          roundId: this.runner!.roundId!,
        });
    }
    this.announce();
    // Publish straight away when something happened, so hits show without
    // waiting for the next 40 ms snapshot.
    this.publish(
      time,
      this.runner?.phase !== previousPhase || events.length > 0,
    );
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
    const times = this.latestMarker
      ? this.presentedTimes.get(this.latestMarker)
      : undefined;
    const venues = this.roster.venues.filter((v) => v.connected);
    if (!times || !venues.every((v) => times.has(v.id))) return null;
    const values = venues.map((v) => times.get(v.id)!);
    return Math.max(...values) - Math.min(...values);
  }
  dispose() {
    if (this.disposed) return;
    this.runner?.dispose();
    this.pending = null;
    this.disposed = true;
  }
  summary() {
    return {
      presentationSpreadMs: this.presentationSpread(),
      completed: completedResults(this.progress.view()),
      progress: this.progress.view(),
      players: [...this.playerMetrics].map(([id, m]) => ({
        id,
        delay: m.ages.summary(),
        loss: this.windows.get(id)?.loss ?? 0,
        substitutions: this.configs.get(id)?.substitutions ?? [],
      })),
    };
  }
}
