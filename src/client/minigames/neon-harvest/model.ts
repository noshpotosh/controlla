import type { Point } from '../../api/index.ts';

export const HARVEST = {
  duration: 45_000,
  chainWindow: 2400,
  pulseCooldown: 6000,
  pulseRadius: 170,
  mineWarmup: 1100,
  sparkWarmup: 250,
  stun: 1000,
  effectLifetime: 900,
  maxNodes: 70,
  maxEffects: 96,
} as const;

export interface HarvestNode extends Point {
  id: number;
  kind: 'spark' | 'gold' | 'mine';
  bornAt: number;
  expiresAt: number;
}
export interface HarvestPlayer {
  chain: number;
  bestChain: number;
  collected: number;
  mineHits: number;
  lastPickupAt: number;
  stunnedUntil: number;
  pulseReadyAt: number;
}
export interface HarvestEffect extends Point {
  id: number;
  at: number;
  kind: 'pickup' | 'ouch' | 'pulse';
  playerId: string;
  points: number;
}
export interface NeonHarvestState {
  scores: Record<string, number>;
  nodes: HarvestNode[];
  effects: HarvestEffect[];
  wave: number;
  players: Record<string, HarvestPlayer>;
}

export const clamp = (value: number, low = 0, high = 1) =>
  Math.min(high, Math.max(low, value));
export const harvestMultiplier = (chain: number) =>
  Math.min(5, 1 + Math.floor(chain / 5));
export const harvestWarmup = (node: HarvestNode) =>
  node.kind === 'mine' ? HARVEST.mineWarmup : HARVEST.sparkWarmup;
export const harvestRadius = (node: HarvestNode) =>
  node.kind === 'mine' ? 33 : node.kind === 'gold' ? 35 : 29;

/** Analytic positions match host collision and delayed display time. */
export function harvestPosition(node: HarvestNode, time: number): Point {
  const age = Math.max(0, time - node.bornAt) / 1000;
  const drift = node.kind === 'mine' ? 1 : 0.18;
  return {
    x: node.x + (Math.sin(age * 0.8 + node.id) * 38 * drift) / 1600,
    y: node.y + (Math.sin(age * 1.1 + node.id * 2) * 30 * drift) / 900,
  };
}
export const harvestDistance = (a: Point, b: Point) =>
  Math.hypot((a.x - b.x) * 1600, (a.y - b.y) * 900);

/** Sweeps use the scene's 1600 × 900 aspect ratio, not normalized distance. */
export function sweepDistance(from: Point, to: Point, point: Point): number {
  const dx = (to.x - from.x) * 1600,
    dy = (to.y - from.y) * 900;
  const length = dx * dx + dy * dy;
  const ratio = length
    ? clamp(
        ((point.x - from.x) * 1600 * dx + (point.y - from.y) * 900 * dy) /
          length,
      )
    : 0;
  return harvestDistance(
    {
      x: from.x + (to.x - from.x) * ratio,
      y: from.y + (to.y - from.y) * ratio,
    },
    point,
  );
}
