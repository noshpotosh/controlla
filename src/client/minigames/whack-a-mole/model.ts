import type { Point } from '../../api/index.ts';

/** Tunable rules. Distances are logical pixels in the 1600 × 900 scene. */
export const WHACK = {
  duration: 60_000,
  frenzy: 10_000,
  firstSpawn: 500,
  /**
   * A hole rumbles this long before its mole pops up, so players can start
   * aiming: pointing a phone, locking and swinging takes about a second.
   */
  warn: 250,
  rise: 160,
  hide: 180,
  bonk: 650,
  holeRest: 350,
  /** Hittable from shortly after a mole starts rising until partway into hiding. */
  hittableAfter: 40,
  hittableDuring: 90,
  grace: 60,
  recovery: 280,
  /** The hammer head's hit radius at the front of the field, in logical px. */
  hammerRadius: 32,
  stun: 1200,
  bombPenalty: 20,
  points: { normal: 10, golden: 30, bomb: 0 },
  upTime: { normalStart: 1300, normalEnd: 900, golden: 750, bomb: 1600 },
  /** Frenzy speeds normal moles up by this factor; mostly it adds more moles. */
  frenzyPace: 0.9,
  goldenChance: 0.08,
  bombChance: 0.12,
  bombsAfter: 5000,
  maxBombs: 2,
  effectLifetime: 1000,
  maxMoles: 24,
  maxEffects: 64,
} as const;

/** The play field in normalized screen space, clear of the title/timer and score cards. */
export const FIELD = {
  left: 0.075,
  right: 0.925,
  top: 0.33,
  bottom: 0.8,
  /** Front-row hole half-width; holes shrink toward the back like the 3D camera. */
  holeWidth: 80,
  backScale: 0.72,
  /** The 3D camera looks down at about 34°, so holes are squashed ellipses. */
  squash: 0.56,
  /** A mole's body rises this many hole half-widths above the hole centre. */
  reach: 1.55,
  /** Hit shapes are a little larger than the art so phone aim feels fair. */
  hitScale: 1.15,
  /** The hit ellipse reaches a little further below the hole than the rim. */
  below: 1.25,
  padding: 16,
} as const;

/**
 * Where a phone pointer's hammer can go: the field, plus room above the back
 * row to reach risen moles. Overshooting stops here instead of in the scoreboard.
 */
export const AIM_BOUNDS = {
  left: FIELD.left,
  top: FIELD.top - 0.08,
  right: FIELD.right,
  bottom: FIELD.bottom + 0.05,
} as const;

export type MoleKind = 'normal' | 'golden' | 'bomb';

export interface Hole extends Point {
  /** Horizontal and vertical radii and the body height above the centre, in logical px. */
  rx: number;
  ry: number;
  reach: number;
}

export interface Mole {
  id: number;
  hole: number;
  kind: MoleKind;
  upAt: number;
  downAt: number;
  /** Host processing time of the whack, so bonk animations start on screen from impact. */
  hitAt?: number;
  hitBy?: string;
}

export interface WhackPlayer {
  hits: number;
  golden: number;
  bombs: number;
  misses: number;
  streak: number;
  bestStreak: number;
  stunnedUntil: number;
}

export interface WhackEffect extends Point {
  id: number;
  at: number;
  kind: 'bonk' | 'gold' | 'boom' | 'miss';
  playerId: string;
  /** Hole index, or −1 for a whack on open ground. */
  hole: number;
  points: number;
}

export interface WhackState {
  holes: Hole[];
  moles: Mole[];
  effects: WhackEffect[];
  scores: Record<string, number>;
  players: Record<string, WhackPlayer>;
}

export const clamp = (value: number, low = 0, high = 1) =>
  Math.min(high, Math.max(low, value));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Seeded linear congruential generator; every call advances the stream. */
export function createRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

/** Depth factor at a screen height: 1 at the front edge, `backScale` at the back. */
export const depthScale = (y: number) =>
  lerp(FIELD.backScale, 1, clamp((y - FIELD.top) / (FIELD.bottom - FIELD.top)));

export function makeHole(x: number, y: number): Hole {
  const rx = FIELD.holeWidth * depthScale(y);
  return { x, y, rx, ry: rx * FIELD.squash, reach: rx * FIELD.reach };
}

/** The hit shape's bounding box in logical px: the hole ellipse plus the body above it. */
export function holeBounds(hole: Hole) {
  const x = hole.x * 1600,
    y = hole.y * 900,
    halfWidth = hole.rx * FIELD.hitScale;
  return {
    left: x - halfWidth,
    right: x + halfWidth,
    top: y - hole.reach * FIELD.hitScale,
    bottom: y + hole.ry * FIELD.hitScale * FIELD.below,
  };
}

export function boundsOverlap(
  a: Hole,
  b: Hole,
  padding: number = FIELD.padding,
) {
  const p = holeBounds(a),
    q = holeBounds(b);
  return !(
    p.right + padding <= q.left ||
    q.right + padding <= p.left ||
    p.bottom + padding <= q.top ||
    q.bottom + padding <= p.top
  );
}

/**
 * Ground distance between two holes, in front-row hole widths. Screen height is
 * foreshortened by the camera, so vertical gaps count for more.
 */
export function groundDistance(a: Point, b: Point) {
  const scale = (depthScale(a.y) + depthScale(b.y)) / 2;
  return (
    Math.hypot((a.x - b.x) * 1600, ((a.y - b.y) * 900) / FIELD.squash) /
    (FIELD.holeWidth * scale)
  );
}

const inField = (hole: Hole) => {
  const box = holeBounds(hole);
  return (
    box.left >= FIELD.left * 1600 &&
    box.right <= FIELD.right * 1600 &&
    box.top >= (FIELD.top - 0.1) * 900 &&
    box.bottom <= (FIELD.bottom + 0.06) * 900
  );
};

/** Hand-placed scattered layouts, used only if sampling keeps failing. */
const CURATED: Record<number, readonly [number, number][]> = {
  8: [
    [0.2, 0.4],
    [0.47, 0.37],
    [0.78, 0.43],
    [0.33, 0.57],
    [0.63, 0.6],
    [0.16, 0.73],
    [0.47, 0.76],
    [0.83, 0.72],
  ],
  11: [
    [0.15, 0.38],
    [0.38, 0.36],
    [0.61, 0.4],
    [0.84, 0.37],
    [0.26, 0.55],
    [0.5, 0.54],
    [0.74, 0.56],
    [0.14, 0.73],
    [0.37, 0.74],
    [0.61, 0.76],
    [0.86, 0.73],
  ],
};

export const holeCount = (players: number) => (players <= 3 ? 8 : 11);

/** Scores holes that line up in a row or column as closer, so layouts avoid grids. */
function alignment(a: Point, b: Point) {
  const dx = Math.abs(a.x - b.x) * 1600,
    dy = Math.abs(a.y - b.y) * 900;
  return (
    (dy < 45 ? 0.4 + (dy / 45) * 0.6 : 1) *
    (dx < 50 ? 0.7 + (dx / 50) * 0.3 : 1)
  );
}

/**
 * Scatter holes with best-candidate sampling: each hole tries many seeded spots
 * and keeps the one farthest from the holes and edges it already has. Hit shapes
 * never overlap, and a hole can't sit directly behind another.
 */
export function holeLayout(count: number, random: () => number): Hole[] {
  const candidates = 60,
    attempts = 40,
    minimum = count > 8 ? 2.35 : 2.6;
  for (let attempt = 0; attempt < attempts; attempt++) {
    const holes: Hole[] = [];
    for (let i = 0; i < count; i++) {
      let best: Hole | null = null,
        bestScore = -Infinity;
      for (let c = 0; c < candidates; c++) {
        const hole = makeHole(
          lerp(FIELD.left, FIELD.right, random()),
          lerp(FIELD.top, FIELD.bottom, random()),
        );
        if (!inField(hole) || holes.some((other) => boundsOverlap(hole, other)))
          continue;
        const edge =
          Math.min(
            hole.x - FIELD.left,
            FIELD.right - hole.x,
            (hole.y - FIELD.top) * 1.6,
            (FIELD.bottom - hole.y) * 1.6,
          ) *
            (1600 / FIELD.holeWidth) *
            2 +
          1;
        const score = Math.min(
          edge,
          ...holes.map(
            (other) => groundDistance(hole, other) * alignment(hole, other),
          ),
        );
        if (score > bestScore) {
          best = hole;
          bestScore = score;
        }
      }
      if (!best) break;
      holes.push(best);
    }
    if (
      holes.length === count &&
      holes.every((a, i) =>
        holes.every((b, j) => i === j || groundDistance(a, b) >= minimum),
      )
    )
      // Back to front, so later holes draw over earlier ones.
      return holes.sort((a, b) => a.y - b.y || a.x - b.x);
  }
  const curated = CURATED[count] ?? CURATED[11];
  return curated.map(([x, y]) => makeHole(x, y));
}

/** The hammer head's radius at a screen height, in logical px. */
export const hammerRadius = (aim: Point) =>
  WHACK.hammerRadius * depthScale(aim.y);

/**
 * How close a hammer head at `aim` comes to a hole's mole, as a fraction: at
 * most 1 means some part of the head overlaps it. The target is the hole
 * opening plus the mole's body above it, which is only as tall as the mole
 * has risen (`height`, 0–1).
 */
export function contact(
  aim: Point,
  hole: Hole,
  height: number,
  radius = hammerRadius(aim),
): number {
  const dx = (aim.x - hole.x) * 1600,
    dy = (aim.y - hole.y) * 900,
    rx = hole.rx * FIELD.hitScale,
    ry = hole.ry * FIELD.hitScale * FIELD.below;
  // Growing the ellipse by the head's radius approximates their overlap.
  const opening = Math.hypot(dx / (rx + radius), dy / (ry + radius));
  if (height <= 0) return opening;
  // The body: a column with a rounded top, rising from the hole centre.
  const half = rx * 0.85,
    top = hole.reach * FIELD.hitScale * clamp(height),
    y = clamp(dy, -Math.max(0, top - half), 0);
  return Math.min(opening, Math.hypot(dx, dy - y) / (half + radius));
}

/**
 * The mole a whack at `aim` lands on at `time`: any part of the hammer head
 * touching a hittable mole counts, and the closest one wins.
 */
export function strike(
  aim: Point,
  holes: readonly Hole[],
  moles: readonly Mole[],
  time: number,
): Mole | undefined {
  let best: Mole | undefined,
    closest = 1;
  for (const mole of moles) {
    const hole = holes[mole.hole];
    if (!hole || !hittable(mole, time)) continue;
    // A whack in the grace window after hiding still reaches the hole.
    const score = contact(aim, hole, molePose(mole, time).height);
    if (score <= closest) {
      best = mole;
      closest = score;
    }
  }
  return best;
}

/** The hole a hammer head at `aim` touches, closest first, or −1. */
export function touchedHole(
  aim: Point,
  holes: readonly Hole[],
  heightOf: (index: number) => number = () => 0,
): number {
  let found = -1,
    closest = 1;
  holes.forEach((hole, index) => {
    const score = contact(aim, hole, heightOf(index));
    if (score <= closest) {
      found = index;
      closest = score;
    }
  });
  return found;
}

export const frenzyAt = (endAt: number) => endAt - WHACK.frenzy;

export function upTime(kind: MoleKind, progress: number, frenzy: boolean) {
  if (kind === 'golden') return WHACK.upTime.golden;
  if (kind === 'bomb') return WHACK.upTime.bomb;
  return (
    lerp(WHACK.upTime.normalStart, WHACK.upTime.normalEnd, clamp(progress)) *
    (frenzy ? WHACK.frenzyPace : 1)
  );
}

/** Whether a whack judged at `time` can still land on this mole. */
export const hittable = (mole: Mole, time: number) =>
  mole.hitAt === undefined &&
  time >= mole.upAt + WHACK.hittableAfter &&
  time <= mole.downAt + WHACK.hittableDuring + WHACK.grace;

/** When the mole's hole is free again. */
export const moleEnd = (mole: Mole) =>
  (mole.hitAt === undefined
    ? Math.max(mole.upAt + WHACK.rise, mole.downAt) + WHACK.hide
    : mole.hitAt + WHACK.bonk) + WHACK.holeRest;

export interface MolePose {
  /** 0 hidden, 1 fully up. */
  height: number;
  /** `warning`: still underground, its hole rumbling just before it pops up. */
  phase: 'warning' | 'rising' | 'up' | 'hiding' | 'bonked' | 'gone';
  /** Seconds into the current phase. */
  elapsed: number;
}

/** Analytic pose, so every display renders the same mole at its own presentation time. */
export function molePose(mole: Mole, time: number): MolePose {
  if (time < mole.upAt)
    return time >= mole.upAt - WHACK.warn
      ? {
          height: 0,
          phase: 'warning',
          elapsed: (time - mole.upAt + WHACK.warn) / 1000,
        }
      : { height: 0, phase: 'gone', elapsed: 0 };
  if (mole.hitAt !== undefined && time >= mole.hitAt) {
    const elapsed = time - mole.hitAt;
    if (elapsed >= WHACK.bonk) return { height: 0, phase: 'gone', elapsed: 0 };
    // Impact first: the mole is flattened at the rim, then sinks away.
    const sink = clamp((elapsed - WHACK.bonk * 0.55) / (WHACK.bonk * 0.45));
    return {
      height: 0.62 * (1 - sink),
      phase: 'bonked',
      elapsed: elapsed / 1000,
    };
  }
  const risen = time - mole.upAt;
  if (risen < WHACK.rise)
    return {
      height: easeOutBack(risen / WHACK.rise),
      phase: 'rising',
      elapsed: risen / 1000,
    };
  const down = Math.max(mole.upAt + WHACK.rise, mole.downAt);
  if (time < down)
    return { height: 1, phase: 'up', elapsed: (time - mole.upAt) / 1000 };
  const hiding = (time - down) / WHACK.hide;
  if (hiding >= 1) return { height: 0, phase: 'gone', elapsed: 0 };
  return {
    height: 1 - hiding * hiding,
    phase: 'hiding',
    elapsed: (time - down) / 1000,
  };
}

export function easeOutBack(t: number) {
  const c1 = 1.9,
    c3 = c1 + 1,
    u = clamp(t) - 1;
  return 1 + c3 * u * u * u + c1 * u * u;
}
