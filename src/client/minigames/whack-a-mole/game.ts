import type {
  GameContext,
  GameInput,
  GameInstance,
  Outcome,
  Point,
  PresentationEvent,
} from '../../api/index.ts';
import {
  WHACK,
  clamp,
  createRandom,
  frenzyAt,
  holeCount,
  holeLayout,
  moleEnd,
  strike,
  touchedHole,
  upTime,
  type Mole,
  type MoleKind,
  type WhackEffect,
  type WhackState,
} from './model.ts';
export type {
  Hole,
  Mole,
  MoleKind,
  WhackEffect,
  WhackPlayer,
  WhackState,
} from './model.ts';

const emptyState = (): WhackState => ({
  holes: [],
  moles: [],
  effects: [],
  scores: {},
  players: {},
});
const point = (value: unknown): value is Point =>
  !!value &&
  typeof value === 'object' &&
  'x' in value &&
  'y' in value &&
  typeof value.x === 'number' &&
  typeof value.y === 'number' &&
  Number.isFinite(value.x) &&
  Number.isFinite(value.y);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Moles pop out of scattered holes; the earliest whack on each one scores. */
export class WhackAMole implements GameInstance<WhackState> {
  private state = emptyState();
  private context: GameContext | null = null;
  private loaded = false;
  private finalized: Outcome[] | null = null;
  private connected = new Set<string>();
  private lastWhack = new Map<string, number>();
  private roster: string[] = [];
  private random = createRandom(1);
  private nextSpawnAt = Infinity;
  private nextMole = 0;
  private nextEffect = 0;
  private nextEvent = 0;
  private lastPop = -Infinity;

  load(): void {
    this.loaded = true;
  }
  ready(): boolean {
    return this.loaded;
  }
  start(context: GameContext): void {
    if (!this.loaded)
      throw new Error('Whack-a-Mole must load before starting.');
    this.context = context;
    this.state = emptyState();
    this.finalized = null;
    this.connected.clear();
    this.lastWhack.clear();
    this.roster = context.players.map((player) => player.id);
    this.nextMole = this.nextEffect = this.nextEvent = 0;
    this.lastPop = -Infinity;
    const seed = (Math.floor(context.startAt) ^ 0x5bd1e995) >>> 0;
    this.state.holes = holeLayout(
      holeCount(context.players.length),
      createRandom(seed ^ 0x9e3779b9),
    );
    this.random = createRandom(seed);
    this.nextSpawnAt = context.startAt + WHACK.firstSpawn;
    // Defining entries preserves valid IDs such as "__proto__" as own keys.
    this.state.scores = Object.fromEntries(
      context.players.map((player) => [player.id, 0]),
    );
    this.state.players = Object.fromEntries(
      context.players.map((player) => [
        player.id,
        {
          hits: 0,
          golden: 0,
          bombs: 0,
          misses: 0,
          streak: 0,
          bestStreak: 0,
          stunnedUntil: 0,
        },
      ]),
    );
    for (const player of context.players)
      if (player.connected) this.connected.add(player.id);
  }

  private spawn(time: number, events: PresentationEvent[]): void {
    const context = this.context!,
      state = this.state;
    const progress = clamp(
      (time - context.startAt) / (context.endAt - context.startAt),
    );
    const frenzy = time >= frenzyAt(context.endAt);
    const showing = state.moles.filter(
      (mole) =>
        mole.hitAt === undefined &&
        time < Math.max(mole.upAt + WHACK.rise, mole.downAt) + WHACK.hide,
    );
    // Difficulty comes mostly from more moles at once rather than shorter
    // stays: even a solo player starts with two.
    const target = Math.min(
      state.holes.length - 2,
      Math.floor(1.4 + 0.6 * this.roster.length + 2 * progress) +
        (frenzy ? 2 : 0),
    );
    const busy = new Set(
      state.moles
        .filter((mole) => moleEnd(mole) > time)
        .map((mole) => mole.hole),
    );
    const free = state.holes
      .map((_, index) => index)
      .filter((index) => !busy.has(index));
    if (
      showing.length >= target ||
      !free.length ||
      state.moles.length >= WHACK.maxMoles
    ) {
      this.nextSpawnAt = time + 60;
      return;
    }
    const hole = free[Math.floor(this.random() * free.length)];
    const roll = this.random();
    let kind: MoleKind = 'normal';
    if (
      roll < WHACK.goldenChance &&
      !showing.some((mole) => mole.kind === 'golden')
    )
      kind = 'golden';
    else if (
      roll >= WHACK.goldenChance &&
      roll < WHACK.goldenChance + WHACK.bombChance &&
      time - context.startAt >= WHACK.bombsAfter &&
      showing.filter((mole) => mole.kind === 'bomb').length < WHACK.maxBombs
    )
      kind = 'bomb';
    const jitter = kind === 'normal' ? lerp(0.85, 1.15, this.random()) : 1;
    // The hole rumbles first; the mole pops up after the warning.
    const upAt = time + WHACK.warn;
    state.moles.push({
      id: ++this.nextMole,
      hole,
      kind,
      upAt,
      downAt: upAt + WHACK.rise + upTime(kind, progress, frenzy) * jitter,
    });
    // Frenzy spawns can come every 90 ms; keep the pop cue from chattering.
    if (upAt - this.lastPop >= 180) {
      this.lastPop = upAt;
      events.push(this.event('pop', upAt));
    }
    // Pace spawns so about `target` moles are out at once through a mole's stay.
    const stay = WHACK.warn + WHACK.rise + upTime('normal', progress, frenzy);
    this.nextSpawnAt =
      time + Math.max(90, (stay / target) * lerp(0.7, 1.3, this.random()));
  }

  private event(kind: string, time: number): PresentationEvent {
    // Short IDs and no player attribution: retained events ride in every snapshot.
    return {
      id: `w${++this.nextEvent}`,
      kind,
      clock: 'presentation',
      time,
    };
  }

  private effect(
    kind: WhackEffect['kind'],
    playerId: string,
    position: Point,
    hole: number,
    time: number,
    points: number,
  ): void {
    this.state.effects.push({
      id: ++this.nextEffect,
      kind,
      playerId,
      x: position.x,
      y: position.y,
      hole,
      at: time,
      points,
    });
  }

  private whack(
    mole: Mole | undefined,
    playerId: string,
    aim: Point,
    hole: number,
    judgedAt: number,
    time: number,
    events: PresentationEvent[],
  ): void {
    const state = this.state,
      player = state.players[playerId];
    if (!mole) {
      player.misses++;
      player.streak = 0;
      this.effect('miss', playerId, aim, hole, time, 0);
      events.push(this.event('whiff', time));
      return;
    }
    const at = state.holes[mole.hole];
    // Impact first: the bonk plays from when this screen learns of it.
    mole.hitAt = time;
    mole.hitBy = playerId;
    if (mole.kind === 'bomb') {
      const deduction = Math.min(WHACK.bombPenalty, state.scores[playerId]);
      state.scores[playerId] -= deduction;
      player.bombs++;
      player.streak = 0;
      player.stunnedUntil = time + WHACK.stun;
      this.effect('boom', playerId, at, mole.hole, time, -deduction);
      events.push(this.event('boom', time));
      return;
    }
    const frenzy = judgedAt >= frenzyAt(this.context!.endAt) ? 2 : 1;
    const points = WHACK.points[mole.kind] * frenzy;
    state.scores[playerId] += points;
    player.hits++;
    if (mole.kind === 'golden') player.golden++;
    player.streak++;
    player.bestStreak = Math.max(player.bestStreak, player.streak);
    const gold = mole.kind === 'golden';
    this.effect(gold ? 'gold' : 'bonk', playerId, at, mole.hole, time, points);
    events.push(this.event(gold ? 'gold' : 'bonk', time));
  }

  tick(input: GameInput): readonly PresentationEvent[] {
    const context = this.context;
    if (
      !context ||
      this.finalized ||
      !Number.isFinite(input.time) ||
      input.time < context.startAt ||
      (input.phase === 'running' && input.time > context.endAt)
    )
      return [];
    const state = this.state,
      events: PresentationEvent[] = [];
    // Settling keeps the cutoff scene: no expiry or spawning, only final whacks.
    if (input.phase === 'running' && input.time < context.endAt) {
      state.effects = state.effects.filter(
        (effect) => input.time - effect.at < WHACK.effectLifetime,
      );
      // Keep finished moles briefly so late-arriving whacks are still judged fairly.
      state.moles = state.moles.filter(
        (mole) => input.time < moleEnd(mole) + 500,
      );
      if (input.time >= this.nextSpawnAt) this.spawn(input.time, events);
    }
    const order = (id: string) => this.roster.indexOf(id);
    const actions = [...input.actions].sort(
      (a, b) => a.time - b.time || order(a.playerId) - order(b.playerId),
    );
    for (const action of actions) {
      const player = state.players[action.playerId];
      if (
        !player ||
        !this.connected.has(action.playerId) ||
        action.name !== 'whack' ||
        !Number.isFinite(action.time) ||
        !point(action.aim) ||
        action.time < context.startAt ||
        action.time >= context.endAt ||
        action.time > input.time ||
        action.time <
          (this.lastWhack.get(action.playerId) ?? -Infinity) + WHACK.recovery ||
        action.time < player.stunnedUntil
      )
        continue;
      this.lastWhack.set(action.playerId, action.time);
      const aim = { x: clamp(action.aim.x), y: clamp(action.aim.y) };
      // Judge against what the player saw on a delayed display.
      const seenAt = Math.min(
        input.time,
        Math.max(context.startAt, action.time - input.presentationDelay),
      );
      const mole = strike(aim, state.holes, state.moles, seenAt);
      const hole = mole ? mole.hole : touchedHole(aim, state.holes);
      this.whack(
        mole,
        action.playerId,
        aim,
        hole,
        action.time,
        input.time,
        events,
      );
    }
    state.effects = state.effects.slice(-WHACK.maxEffects);
    return events;
  }

  finalize(): Outcome[] {
    if (!this.context) throw new Error('Whack-a-Mole has no active round.');
    if (!this.finalized)
      this.finalized = this.context.players.map((player) => {
        const stats = this.state.players[player.id];
        return {
          playerId: player.id,
          score: this.state.scores[player.id],
          placement:
            1 +
            Object.values(this.state.scores).filter(
              (score) => score > this.state.scores[player.id],
            ).length,
          stats: {
            hits: stats.hits,
            golden: stats.golden,
            bombs: stats.bombs,
            misses: stats.misses,
            bestStreak: stats.bestStreak,
          },
        };
      });
    return structuredClone(this.finalized);
  }
  snapshot(): WhackState {
    return structuredClone(this.state);
  }
  disconnect(id: string, _time: number): void {
    this.connected.delete(id);
  }
  reconnect(id: string): void {
    if (this.context?.players.some((player) => player.id === id))
      this.connected.add(id);
  }
  dispose(): void {
    this.loaded = false;
    this.context = null;
    this.state = emptyState();
    this.connected.clear();
    this.lastWhack.clear();
    this.roster = [];
    this.finalized = null;
  }
}

const record = (value: unknown): value is Record<string, unknown> =>
  !!value &&
  typeof value === 'object' &&
  !Array.isArray(value) &&
  (Object.getPrototypeOf(value) === Object.prototype ||
    Object.getPrototypeOf(value) === null);
const finite = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);
const count = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const unit = (value: unknown) => finite(value) && value >= 0 && value <= 1;
const unique = (items: unknown[]) =>
  new Set(items.map((item) => (record(item) ? item.id : null))).size ===
  items.length;

/** Game-owned shape validation; the engine validates the outer envelope and byte budget. */
export function isWhackState(value: unknown): value is WhackState {
  if (
    !record(value) ||
    !record(value.scores) ||
    !record(value.players) ||
    !Array.isArray(value.holes) ||
    value.holes.length < 1 ||
    value.holes.length > 12 ||
    !Array.isArray(value.moles) ||
    value.moles.length > WHACK.maxMoles ||
    !Array.isArray(value.effects) ||
    value.effects.length > WHACK.maxEffects
  )
    return false;
  const ids = Object.keys(value.players),
    holes = value.holes.length;
  if (
    ids.length > 8 ||
    ids.some((id) => !id || id.length > 160) ||
    Object.keys(value.scores).length !== ids.length ||
    !ids.every(
      (id) =>
        Object.hasOwn(value.scores as object, id) &&
        count((value.scores as Record<string, unknown>)[id]),
    )
  )
    return false;
  const player = (item: unknown) =>
    record(item) &&
    ['hits', 'golden', 'bombs', 'misses', 'streak', 'bestStreak'].every((key) =>
      count(item[key]),
    ) &&
    (item.bestStreak as number) >= (item.streak as number) &&
    (item.hits as number) >= (item.bestStreak as number) &&
    (item.hits as number) >= (item.golden as number) &&
    finite(item.stunnedUntil);
  const holeIndex = (index: unknown, allowNone = false) =>
    Number.isSafeInteger(index) &&
    (index as number) >= (allowNone ? -1 : 0) &&
    (index as number) < holes;
  return (
    Object.values(value.players).every(player) &&
    value.holes.every(
      (hole) =>
        record(hole) &&
        unit(hole.x) &&
        unit(hole.y) &&
        ['rx', 'ry', 'reach'].every(
          (key) => finite(hole[key]) && (hole[key] as number) > 0,
        ),
    ) &&
    unique(value.moles) &&
    value.moles.every(
      (mole) =>
        record(mole) &&
        count(mole.id) &&
        mole.id > 0 &&
        holeIndex(mole.hole) &&
        ['normal', 'golden', 'bomb'].includes(mole.kind as string) &&
        finite(mole.upAt) &&
        finite(mole.downAt) &&
        mole.downAt >= mole.upAt &&
        (mole.hitAt === undefined) === (mole.hitBy === undefined) &&
        (mole.hitAt === undefined || finite(mole.hitAt)) &&
        (mole.hitBy === undefined ||
          (typeof mole.hitBy === 'string' && ids.includes(mole.hitBy))),
    ) &&
    unique(value.effects) &&
    value.effects.every(
      (effect) =>
        record(effect) &&
        count(effect.id) &&
        effect.id > 0 &&
        ['bonk', 'gold', 'boom', 'miss'].includes(effect.kind as string) &&
        typeof effect.playerId === 'string' &&
        ids.includes(effect.playerId) &&
        holeIndex(effect.hole, true) &&
        finite(effect.at) &&
        finite(effect.points) &&
        unit(effect.x) &&
        unit(effect.y),
    )
  );
}
