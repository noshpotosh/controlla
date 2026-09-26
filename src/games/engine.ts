import {
  clamp,
  type GameState,
  type Player,
  type Press,
  type InputFrame,
  type GameEvent,
  type Result,
  type ControllerConfig,
} from '../core/types.ts';
export interface GameContract {
  load(): void;
  ready(): boolean;
  configure(
    players: Player[],
    resolvedInputs?: Record<string, ControllerConfig>,
  ): void;
  onPlayerDropped(playerId: string, time: number): void;
  onPlayerReturned(playerId: string): void;
  end(): void;
  start(time: number, mode: string): void;
  frame(
    input: Record<string, InputFrame>,
    presses: Press[],
    time: number,
    dt: number,
    presentationDelay: number,
  ): GameEvent[];
  snapshot(): GameState;
  results(): Result[];
}
export class PartyGame implements GameContract {
  state: GameState;
  players: Player[] = [];
  private reacted = new Set<string>();
  private reactionTimes: Record<string, number[]> = {};
  private squaredErrors: Record<string, number[]> = {};
  private traces: Record<string, { time: number; x: number; y: number }[]> = {};
  private nextPrompt = 0;
  private eventSequence = 0;
  private loaded = false;
  private disconnected = new Map<string, number>();
  resolvedInputs: Record<string, ControllerConfig> = {};
  constructor(
    public gameId: string,
    private dropPolicy: 'pause' | 'substitute' | 'freeze' = 'freeze',
  ) {
    this.state = {
      gameId,
      mode: 'reaction',
      phase: 'lobby',
      startAt: 0,
      endAt: 0,
      target: { x: 0.5, y: 0.5 },
      targetAt: 0,
      promptId: 0,
      scores: {},
      cursors: {},
      racers: {},
      results: [],
      flash: false,
    };
  }
  load() {
    this.loaded = true;
  }
  ready() {
    return this.loaded;
  }
  onPlayerDropped(id: string, time: number) {
    if (this.players.some((p) => p.id === id)) this.disconnected.set(id, time);
  }
  onPlayerReturned(id: string) {
    this.disconnected.delete(id);
  }
  end() {
    this.state.phase = 'results';
    this.state.results = this.results();
  }
  configure(
    players: Player[],
    resolvedInputs: Record<string, ControllerConfig> = {},
  ) {
    this.resolvedInputs = structuredClone(resolvedInputs);
    this.players = structuredClone(players);
    for (const p of players) {
      this.state.scores[p.id] = 0;
      this.state.racers[p.id] = { x: 0.15, y: (p.seat + 0.5) / 8 };
      this.reactionTimes[p.id] = [];
      this.squaredErrors[p.id] = [];
      this.traces[p.id] = [];
    }
  }
  start(time: number, mode: string) {
    this.state.phase = 'countdown';
    this.state.mode = mode;
    this.state.startAt = time + 3000;
    this.state.endAt = time + 33000;
    this.nextPrompt = this.state.startAt + 1000;
  }
  frame(
    input: Record<string, InputFrame>,
    presses: Press[],
    time: number,
    dt: number,
    D: number,
  ): GameEvent[] {
    const s = this.state,
      events: GameEvent[] = [];
    const emit = (kind: GameEvent['kind'], playerId?: string) =>
      events.push({
        id: `${s.startAt}:${++this.eventSequence}`,
        time,
        kind,
        playerId,
      });
    if (
      this.dropPolicy === 'pause' &&
      this.disconnected.size &&
      (s.phase === 'running' || s.phase === 'countdown')
    ) {
      if ([...this.disconnected.values()].some((at) => time - at >= 60000)) {
        this.end();
        emit('end');
        return events;
      }
      s.startAt += dt;
      s.endAt += dt;
      if (s.targetAt) s.targetAt += dt;
      this.nextPrompt += dt;
      return events;
    }
    if (s.phase === 'countdown' && time >= s.startAt) s.phase = 'running';
    if (s.phase !== 'running') return events;
    if (time >= s.endAt) {
      this.end();
      emit('end');
      return events;
    }
    for (const p of this.players) {
      let f = input[p.id];
      if (
        !f &&
        this.dropPolicy === 'substitute' &&
        this.disconnected.has(p.id)
      ) {
        const lane = 0.5 + 0.32 * Math.sin((time - s.startAt) / 2300),
          racer = s.racers[p.id];
        f = {
          seq: 0,
          time,
          generation: 0,
          x:
            s.gameId === 'tilt-rally'
              ? clamp((lane - racer.y) * 5, -1, 1)
              : s.target.x,
          y: s.target.y,
          vx: 0,
          vy: 0,
          buttons: 0,
          edges: [0, 0, 0, 0],
          edgeTimes: [0, 0, 0, 0],
          confidence: 1,
        };
      }
      if (!f) continue;
      s.cursors[p.id] = { x: f.x, y: f.y };
      if (s.gameId === 'tilt-rally') {
        const racer = s.racers[p.id];
        racer.y = clamp(racer.y + f.x * dt * 0.00035, 0.04, 0.96);
        const lane = 0.5 + 0.32 * Math.sin((time - s.startAt) / 2300);
        const accuracy = 1 - Math.min(1, Math.abs(racer.y - lane) * 2);
        racer.x = clamp(racer.x + accuracy * dt * 0.000016, 0, 0.93);
        s.scores[p.id] += (accuracy * dt) / 100;
      } else if (s.mode === 'tracking') {
        const visibleTime = f.time - D - s.startAt;
        const seen = {
          x: 0.5 + 0.3 * Math.sin(visibleTime / 1200),
          y: 0.5 + 0.24 * Math.sin(visibleTime / 1900),
        };
        const e = (f.x - seen.x) ** 2 + (f.y - seen.y) ** 2;
        const trace = this.traces[p.id];
        trace.push({ time: visibleTime, x: f.x, y: f.y });
        if (trace.length > 1800) trace.shift();
        const samples = this.squaredErrors[p.id];
        samples.push(e);
        if (samples.length > 3600) samples.shift();
        s.scores[p.id] += (Math.max(0, 1 - Math.sqrt(e) * 4) * dt) / 100;
      }
    }
    if (s.gameId === 'latency-lab' && s.mode === 'tracking')
      s.target = {
        x: 0.5 + 0.3 * Math.sin((time - s.startAt) / 1200),
        y: 0.5 + 0.24 * Math.sin((time - s.startAt) / 1900),
      };
    if (
      s.gameId === 'latency-lab' &&
      s.mode !== 'tracking' &&
      time >= this.nextPrompt
    ) {
      s.targetAt = time + D + 200;
      s.promptId++;
      s.target = { x: 0.2 + Math.random() * 0.6, y: 0.2 + Math.random() * 0.6 };
      this.nextPrompt = time + 2800 + Math.random() * 1200;
      this.reacted.clear();
      events.push({
        id: `${s.startAt}:${++this.eventSequence}`,
        time: s.targetAt - D,
        kind: 'prompt',
      });
    }
    for (const press of [...presses].sort((a, b) => a.time - b.time)) {
      if (!this.players.some((p) => p.id === press.playerId)) continue;
      if (s.gameId === 'tilt-rally') {
        s.racers[press.playerId].x = clamp(
          s.racers[press.playerId].x + 0.025,
          0,
          0.93,
        );
        s.scores[press.playerId] += 5;
        emit('hit', press.playerId);
      } else if (s.mode === 'strobe') {
        s.flash = !s.flash;
        emit('hit', press.playerId);
      } else if (s.mode === 'tracking') {
        if (Math.hypot(press.x - s.target.x, press.y - s.target.y) < 0.1) {
          s.scores[press.playerId] += 10;
          emit('hit', press.playerId);
        }
      } else {
        const reaction = press.time - s.targetAt;
        if (
          s.promptId > 0 &&
          reaction >= 0 &&
          reaction < 2200 &&
          !this.reacted.has(press.playerId)
        ) {
          this.reacted.add(press.playerId);
          this.reactionTimes[press.playerId].push(reaction);
          s.scores[press.playerId] += Math.max(0, 1000 - reaction);
          emit('hit', press.playerId);
        }
      }
    }
    return events;
  }
  snapshot() {
    return structuredClone(this.state);
  }
  results(): Result[] {
    return Object.entries(this.state.scores)
      .sort((a, b) => b[1] - a[1])
      .map(([playerId, score], i) => {
        const r = this.reactionTimes[playerId] ?? [],
          e = this.squaredErrors[playerId] ?? [];
        const trace = this.traces[playerId] ?? [];
        let phaseLagMs = 0,
          best = Infinity;
        if (trace.length > 60)
          for (let lag = -300; lag <= 300; lag += 10) {
            let sum = 0;
            for (const p of trace)
              sum +=
                (p.x - (0.5 + 0.3 * Math.sin((p.time - lag) / 1200))) ** 2 +
                (p.y - (0.5 + 0.24 * Math.sin((p.time - lag) / 1900))) ** 2;
            if (sum < best) {
              best = sum;
              phaseLagMs = lag;
            }
          }
        return {
          playerId,
          score: Math.round(score),
          rank: i + 1,
          stats: {
            phaseLagMs,
            reactionMs: r.length ? r.reduce((a, b) => a + b) / r.length : 0,
            reactions: r.length,
            rmsAimError: e.length
              ? Math.sqrt(e.reduce((a, b) => a + b) / e.length)
              : 0,
          },
        };
      });
  }
}
