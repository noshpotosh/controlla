import type {
  GameContext,
  GameInput,
  GameInstance,
  Outcome,
  Point,
  PresentationEvent,
} from '../../api/index.ts';
import {
  HARVEST,
  clamp,
  harvestDistance,
  harvestMultiplier,
  harvestPosition,
  harvestRadius,
  harvestWarmup,
  sweepDistance,
  type HarvestEffect,
  type HarvestNode,
  type NeonHarvestState,
} from './model.ts';
export {
  HARVEST,
  harvestMultiplier,
  harvestPosition,
  harvestRadius,
  harvestWarmup,
  sweepDistance,
} from './model.ts';
export type {
  HarvestEffect,
  HarvestNode,
  HarvestPlayer,
  NeonHarvestState,
} from './model.ts';

const emptyState = (): NeonHarvestState => ({
  scores: {},
  nodes: [],
  effects: [],
  wave: 0,
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

/** Simple shared pickups and hazards; lifecycle and finalization belong to the engine. */
export class NeonHarvest implements GameInstance<NeonHarvestState> {
  private state = emptyState();
  private context: GameContext | null = null;
  private loaded = false;
  private finalized: Outcome[] | null = null;
  private connected = new Set<string>();
  private previous = new Map<string, Point & { time: number }>();
  private lastPulse = new Map<string, number>();
  private nextWave = 0;
  private nextNode = 0;
  private nextEffect = 0;
  private nextEvent = 0;
  private seed = 1;

  load(): void {
    this.loaded = true;
  }
  ready(): boolean {
    return this.loaded;
  }
  start(context: GameContext): void {
    if (!this.loaded)
      throw new Error('Neon Harvest must load before starting.');
    this.context = context;
    this.state = emptyState();
    this.finalized = null;
    this.connected.clear();
    this.previous.clear();
    this.lastPulse.clear();
    this.nextWave = context.startAt;
    this.nextNode = this.nextEffect = this.nextEvent = 0;
    this.seed = (Math.floor(context.startAt) ^ 0x7f4a7c15) >>> 0;
    // Defining entries preserves valid IDs such as "__proto__" as own keys.
    this.state.scores = Object.fromEntries(
      context.players.map((player) => [player.id, 0]),
    );
    this.state.players = Object.fromEntries(
      context.players.map((player) => [
        player.id,
        {
          chain: 0,
          bestChain: 0,
          collected: 0,
          mineHits: 0,
          lastPickupAt: 0,
          stunnedUntil: 0,
          pulseReadyAt: 0,
        },
      ]),
    );
    for (const player of context.players) {
      if (player.connected) this.connected.add(player.id);
    }
  }
  private random(): number {
    this.seed = (Math.imul(this.seed, 1664525) + 1013904223) >>> 0;
    return this.seed / 4294967296;
  }
  private spawn(time: number): void {
    const state = this.state;
    state.wave++;
    const count = 7 + Math.min(5, Object.keys(state.players).length);
    const center = {
      x: 0.18 + this.random() * 0.64,
      y: 0.3 + this.random() * 0.29,
    };
    const angle = this.random() * Math.PI * 2;
    for (
      let i = 0;
      i < count && state.nodes.length < HARVEST.maxNodes - 5;
      i++
    ) {
      const a = angle + (i / count) * Math.PI * 1.6,
        radius = 85 + i * 7;
      state.nodes.push({
        id: ++this.nextNode,
        kind: i === count - 1 ? 'gold' : 'spark',
        x: clamp(center.x + (Math.cos(a) * radius) / 1600, 0.06, 0.94),
        y: clamp(center.y + (Math.sin(a) * radius) / 900, 0.21, 0.72),
        bornAt: time,
        expiresAt: time + 9000,
      });
    }
    if (
      state.wave > 1 &&
      state.nodes.length < HARVEST.maxNodes &&
      state.nodes.filter((node) => node.kind === 'mine').length <
        3 + Math.floor(state.wave / 4)
    ) {
      state.nodes.push({
        id: ++this.nextNode,
        kind: 'mine',
        x: clamp(center.x + (this.random() - 0.5) * 0.25, 0.08, 0.92),
        y: clamp(center.y + (this.random() - 0.5) * 0.3, 0.25, 0.7),
        bornAt: time,
        expiresAt: time + 10000,
      });
    }
    this.nextWave =
      time +
      Math.max(
        850,
        1900 - Object.keys(state.players).length * 90 - state.wave * 15,
      );
  }
  private effect(
    kind: HarvestEffect['kind'],
    playerId: string,
    position: Point,
    time: number,
    points = 0,
  ): void {
    this.state.effects.push({
      id: ++this.nextEffect,
      kind,
      playerId,
      ...position,
      at: time,
      points,
    });
  }
  private collect(
    node: HarvestNode,
    id: string,
    position: Point,
    scoreTime: number,
    presentationTime: number,
  ): void {
    const player = this.state.players[id];
    // Late actions change current state; already adjudicated chain expiry is not rolled back.
    if (scoreTime - player.lastPickupAt > HARVEST.chainWindow) player.chain = 0;
    player.chain++;
    player.collected++;
    player.bestChain = Math.max(player.bestChain, player.chain);
    player.lastPickupAt = Math.max(player.lastPickupAt, scoreTime);
    const rush = this.context!.endAt - scoreTime <= 10000 ? 2 : 1;
    const points =
      (node.kind === 'gold' ? 30 : 10) * harvestMultiplier(player.chain) * rush;
    this.state.scores[id] += points;
    this.effect('pickup', id, position, presentationTime, points);
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
      sounded = new Set<string>();
    // Preserve the cutoff scene for the final accepted action batch, including nodes
    // whose expiry lands exactly at the cutoff. No new wave or timer work in settling.
    if (input.phase === 'running' && input.time < context.endAt) {
      state.effects = state.effects.filter(
        (effect) => input.time - effect.at < HARVEST.effectLifetime,
      );
      state.nodes = state.nodes.filter((node) => node.expiresAt > input.time);
      for (const player of Object.values(state.players))
        if (input.time - player.lastPickupAt > HARVEST.chainWindow)
          player.chain = 0;
      if (input.time >= this.nextWave) this.spawn(input.time);
    }
    const paths = new Map<string, { from: Point; to: Point; seenAt: number }>();
    if (input.phase === 'running')
      for (const [id, player] of Object.entries(state.players)) {
        const sample = input.values[id]?.aim;
        const observedAt = sample?.observedAt ?? sample?.time;
        if (
          !this.connected.has(id) ||
          !sample ||
          !point(sample.value) ||
          !Number.isFinite(sample.time) ||
          observedAt === undefined ||
          !Number.isFinite(observedAt) ||
          input.time - observedAt >= 250 ||
          observedAt > input.time + 100 ||
          sample.time > input.time + 100
        ) {
          this.previous.delete(id);
          continue;
        }
        const position = { x: clamp(sample.value.x), y: clamp(sample.value.y) };
        const previous = this.previous.get(id);
        this.previous.set(id, { ...position, time: input.time });
        if (player.stunnedUntil > input.time) continue;
        paths.set(id, {
          from:
            previous && input.time - previous.time < 150 ? previous : position,
          to: position,
          seenAt: Math.min(
            input.time,
            Math.max(context.startAt, observedAt - input.presentationDelay),
          ),
        });
      }
    const removed = new Set<number>();
    for (const action of [...input.actions].sort((a, b) => a.time - b.time)) {
      const player = state.players[action.playerId];
      if (
        !player ||
        !this.connected.has(action.playerId) ||
        action.name !== 'pulse' ||
        !Number.isFinite(action.time) ||
        !point(action.aim) ||
        action.time < context.startAt ||
        action.time >= context.endAt ||
        action.time > input.time ||
        action.time <= (this.lastPulse.get(action.playerId) ?? -Infinity) ||
        action.time < player.pulseReadyAt ||
        action.time < player.stunnedUntil
      )
        continue;
      this.lastPulse.set(action.playerId, action.time);
      player.pulseReadyAt = action.time + HARVEST.pulseCooldown;
      const position = { x: clamp(action.aim.x), y: clamp(action.aim.y) };
      this.effect('pulse', action.playerId, position, input.time);
      sounded.add(action.playerId);
      const seenAt = Math.min(
        input.time,
        Math.max(context.startAt, action.time - input.presentationDelay),
      );
      for (const node of state.nodes) {
        const target = harvestPosition(node, seenAt);
        // Pulse may clear a mine during its warning, after the shared pickup warmup.
        if (
          removed.has(node.id) ||
          seenAt < node.bornAt + HARVEST.sparkWarmup ||
          seenAt >= node.expiresAt ||
          harvestDistance(position, target) > HARVEST.pulseRadius
        )
          continue;
        removed.add(node.id);
        if (node.kind !== 'mine')
          this.collect(node, action.playerId, target, action.time, input.time);
      }
    }
    if (input.phase === 'running') {
      // Hazards win before continuous pickups so sweeping through a mine cannot cash
      // in a trail behind it. Pulses already adjudicated in this tick stay accepted.
      for (const node of state.nodes.filter(
        (node) => node.kind === 'mine' && !removed.has(node.id),
      ))
        for (const [id, path] of paths) {
          const target = harvestPosition(node, path.seenAt);
          if (
            path.seenAt < node.bornAt + harvestWarmup(node) ||
            path.seenAt >= node.expiresAt ||
            sweepDistance(path.from, path.to, target) > harvestRadius(node)
          )
            continue;
          const player = state.players[id];
          player.chain = 0;
          player.mineHits++;
          player.stunnedUntil = input.time + HARVEST.stun;
          const deduction = Math.min(50, state.scores[id]);
          state.scores[id] -= deduction;
          this.effect(
            'ouch',
            id,
            path.to,
            input.time,
            deduction === 0 ? 0 : -deduction,
          );
          sounded.add(id);
          paths.delete(id);
        }
      const ids = Object.keys(state.players);
      for (const node of state.nodes.filter(
        (node) => node.kind !== 'mine' && !removed.has(node.id),
      )) {
        const contenders = [...paths]
          .map(([id, path]) => ({
            id,
            path,
            position: harvestPosition(node, path.seenAt),
          }))
          .filter(
            ({ path, position }) =>
              path.seenAt >= node.bornAt + harvestWarmup(node) &&
              path.seenAt < node.expiresAt &&
              sweepDistance(path.from, path.to, position) <=
                harvestRadius(node),
          );
        contenders.sort(
          (a, b) =>
            sweepDistance(a.path.from, a.path.to, a.position) -
              sweepDistance(b.path.from, b.path.to, b.position) ||
            ((ids.indexOf(a.id) + node.id) % ids.length) -
              ((ids.indexOf(b.id) + node.id) % ids.length),
        );
        const winner = contenders[0];
        if (winner) {
          removed.add(node.id);
          this.collect(
            node,
            winner.id,
            winner.position,
            input.time,
            input.time,
          );
          sounded.add(winner.id);
        }
      }
    }
    state.nodes = state.nodes.filter((node) => !removed.has(node.id));
    state.effects = state.effects.slice(-HARVEST.maxEffects);
    // Hit audio has no player-specific behavior. Keep attribution in game-owned
    // effects instead of repeating potentially long IDs in retained audio history.
    return [...sounded].map(() => ({
      id: `harvest-hit-${++this.nextEvent}`,
      kind: 'hit',
      clock: 'presentation' as const,
      time: input.time,
    }));
  }
  finalize(): Outcome[] {
    if (!this.context) throw new Error('Neon Harvest has no active round.');
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
            collected: stats.collected,
            bestChain: stats.bestChain,
            mineHits: stats.mineHits,
          },
        };
      });
    return structuredClone(this.finalized);
  }
  snapshot(): NeonHarvestState {
    return structuredClone(this.state);
  }
  disconnect(id: string, _time: number): void {
    this.connected.delete(id);
    this.previous.delete(id);
  }
  reconnect(id: string): void {
    this.previous.delete(id);
    if (this.context?.players.some((player) => player.id === id))
      this.connected.add(id);
  }
  dispose(): void {
    this.loaded = false;
    this.context = null;
    this.state = emptyState();
    this.connected.clear();
    this.previous.clear();
    this.lastPulse.clear();
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
/** Game-owned shape validation; the engine validates the outer envelope and byte budget. */
export function isNeonHarvestState(value: unknown): value is NeonHarvestState {
  if (
    !record(value) ||
    !record(value.scores) ||
    !record(value.players) ||
    !count(value.wave) ||
    !Array.isArray(value.nodes) ||
    value.nodes.length > HARVEST.maxNodes ||
    !Array.isArray(value.effects) ||
    value.effects.length > HARVEST.maxEffects
  )
    return false;
  const ids = Object.keys(value.players);
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
    ['chain', 'bestChain', 'collected', 'mineHits'].every((key) =>
      count(item[key]),
    ) &&
    (item.bestChain as number) >= (item.chain as number) &&
    (item.collected as number) >= (item.bestChain as number) &&
    ['lastPickupAt', 'stunnedUntil', 'pulseReadyAt'].every((key) =>
      finite(item[key]),
    );
  return (
    Object.values(value.players).every(player) &&
    new Set(value.nodes.map((node) => (record(node) ? node.id : null))).size ===
      value.nodes.length &&
    value.nodes.every(
      (node) =>
        record(node) &&
        count(node.id) &&
        node.id > 0 &&
        ['spark', 'gold', 'mine'].includes(node.kind as string) &&
        finite(node.bornAt) &&
        finite(node.expiresAt) &&
        node.expiresAt > node.bornAt &&
        point(node),
    ) &&
    new Set(value.effects.map((effect) => (record(effect) ? effect.id : null)))
      .size === value.effects.length &&
    value.effects.every(
      (effect) =>
        record(effect) &&
        count(effect.id) &&
        effect.id > 0 &&
        ['pickup', 'ouch', 'pulse'].includes(effect.kind as string) &&
        typeof effect.playerId === 'string' &&
        ids.includes(effect.playerId) &&
        finite(effect.at) &&
        finite(effect.points) &&
        point(effect),
    )
  );
}
