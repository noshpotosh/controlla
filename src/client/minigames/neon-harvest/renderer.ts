import type {
  GameRenderer,
  Player,
  Point,
  Presentation,
  ReadonlyDeep,
} from '../../api/index.ts';
import {
  HARVEST,
  harvestMultiplier,
  harvestPosition,
  harvestWarmup,
} from './model.ts';
import type {
  HarvestEffect,
  HarvestNode,
  HarvestPlayer,
  NeonHarvestState,
} from './model.ts';

const TAU = Math.PI * 2;
const FONT = '"Trebuchet MS", sans-serif';
const COLORS = {
  mint: '#73ffd1',
  gold: '#ffdf81',
  pink: '#ff4f91',
  blue: '#74cfff',
  violet: '#bd93ff',
};
const text = (
  ctx: CanvasRenderingContext2D,
  value: string,
  x: number,
  y: number,
  size: number,
  color = '#effbff',
  align: CanvasTextAlign = 'left',
  weight = 800,
) => {
  ctx.font = `${weight} ${size}px ${FONT}`;
  ctx.textAlign = align;
  ctx.fillStyle = color;
  ctx.fillText(value, x, y);
};
const circle = (
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
) => {
  ctx.beginPath();
  ctx.arc(x, y, Math.max(0, radius), 0, TAU);
};
const polygon = (
  ctx: CanvasRenderingContext2D,
  sides: number,
  radius: number,
  rotation = 0,
) => {
  ctx.beginPath();
  for (let i = 0; i < sides; i++) {
    const a = rotation + (i / sides) * TAU;
    ctx.lineTo(Math.cos(a) * radius, Math.sin(a) * radius);
  }
  ctx.closePath();
};
const glow = (ctx: CanvasRenderingContext2D, color: string, blur = 16) => {
  ctx.shadowColor = color;
  ctx.shadowBlur = blur;
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
};
const hash = (seed: number) => {
  const value = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
  return value - Math.floor(value);
};

/** Game-owned scenery and effects. No input, session, or transport capabilities. */
export class NeonHarvestRenderer implements GameRenderer<NeonHarvestState> {
  private trails = new Map<string, { x: number; y: number; at: number }[]>();
  private headings = new Map<string, number>();
  private positions = new Map<string, Point>();
  private round: string | null = null;
  private lastTime = -Infinity;
  private background: HTMLCanvasElement | null = null;
  private disposed = false;

  private backdrop(ctx: CanvasRenderingContext2D) {
    if (!this.background) {
      const canvas =
        typeof document === 'undefined'
          ? null
          : document.createElement('canvas');
      if (canvas) {
        canvas.width = 1600;
        canvas.height = 900;
      }
      const cached =
        typeof canvas?.getContext === 'function'
          ? canvas.getContext('2d')
          : null;
      const c = cached ?? ctx;
      c.fillStyle = '#030712';
      c.fillRect(0, 0, 1600, 900);
      for (const [x, y, color] of [
        [350, 400, '#0d536a'],
        [1230, 250, '#30215b'],
        [820, 760, '#113136'],
      ] as const) {
        const mist = c.createRadialGradient(x, y, 0, x, y, 720);
        mist.addColorStop(0, color);
        mist.addColorStop(1, '#03071200');
        c.fillStyle = mist;
        c.fillRect(0, 0, 1600, 900);
      }
      // The arena curves over a wire globe, like a lit orbital shell.
      c.save();
      c.beginPath();
      c.ellipse(800, 444, 770, 306, 0, 0, TAU);
      c.clip();
      const planet = c.createRadialGradient(660, 340, 20, 800, 620, 820);
      planet.addColorStop(0, '#123346');
      planet.addColorStop(0.8, '#061523');
      planet.addColorStop(1, '#030712');
      c.fillStyle = planet;
      c.fillRect(0, 130, 1600, 640);
      c.lineWidth = 1;
      for (let longitude = -8; longitude <= 8; longitude++) {
        c.strokeStyle = '#498f9c24';
        c.beginPath();
        for (let i = 0; i <= 50; i++) {
          const latitude = -Math.PI / 2 + (i / 50) * Math.PI;
          const x =
            800 +
            Math.sin(((longitude / 9) * Math.PI) / 2) *
              Math.cos(latitude) *
              770;
          const y = 444 + Math.sin(latitude) * 306;
          if (i === 0) c.moveTo(x, y);
          else c.lineTo(x, y);
        }
        c.stroke();
      }
      for (let i = -6; i <= 6; i++) {
        const y = 444 + i * 44;
        const extent = Math.sqrt(Math.max(0, 1 - ((y - 444) / 306) ** 2)) * 770;
        c.strokeStyle = '#498f9c24';
        c.beginPath();
        c.ellipse(800, y, extent, 24 * (1 - Math.abs(i) / 8), 0, 0, Math.PI);
        c.stroke();
      }
      c.restore();
      c.strokeStyle = '#6adcda35';
      c.lineWidth = 2;
      c.beginPath();
      c.ellipse(800, 444, 770, 306, 0, 0, TAU);
      c.stroke();
      for (let i = 0; i < 230; i++) {
        const x = hash(i + 1) * 1600,
          y = hash(i + 301) * 900;
        c.globalAlpha = 0.12 + hash(i + 91) * 0.55;
        c.fillStyle = i % 4 ? '#9fc8eb' : '#d9efff';
        const size = i % 23 ? 1 : 2.5;
        c.fillRect(x, y, size, size);
      }
      c.globalAlpha = 1;
      this.background = cached ? canvas : null;
    }
    if (this.background) ctx.drawImage(this.background, 0, 0);
  }

  render({
    context: ctx,
    snapshot,
    time,
    width,
    height,
    localCursors = {},
    reducedMotion = false,
  }: Presentation<NeonHarvestState>): void {
    if (
      this.disposed ||
      !snapshot.state ||
      !['running', 'settling'].includes(snapshot.phase)
    )
      return;
    const state = snapshot.state;
    if (this.round !== snapshot.roundId || time < this.lastTime) {
      this.round = snapshot.roundId;
      this.trails.clear();
      this.headings.clear();
      this.positions.clear();
    }
    this.lastTime = time;
    if (reducedMotion) {
      this.trails.clear();
      this.headings.clear();
    }
    const at = Math.min(time, snapshot.endAt);
    const motion = reducedMotion ? 0 : at;
    const remaining = Math.max(0, Math.ceil((snapshot.endAt - at) / 1000));
    const participants = snapshot.players.filter((player) =>
      Object.hasOwn(state.players, player.id),
    );
    const active = new Set(
      participants
        .filter((player) => player.connected)
        .map((player) => player.id),
    );
    for (const map of [this.trails, this.headings, this.positions])
      for (const id of map.keys()) if (!active.has(id)) map.delete(id);
    const positions =
      snapshot.phase === 'running'
        ? { ...snapshot.cursors, ...localCursors }
        : snapshot.cursors;
    ctx.save();
    try {
      ctx.scale(width / 1600, height / 900);
      this.backdrop(ctx);
      // Cosmetic orbital movement stops under reduced motion; gameplay positions do not.
      ctx.save();
      ctx.translate(800, 440);
      ctx.scale(1, 0.4);
      ctx.strokeStyle = '#739fb91f';
      ctx.lineWidth = 2;
      for (let i = 0; i < 3; i++) {
        ctx.beginPath();
        ctx.arc(
          0,
          0,
          805 + i * 24,
          motion / 20000 + i * 2,
          motion / 20000 + i * 2 + 1.2,
        );
        ctx.stroke();
      }
      ctx.restore();
      for (const node of state.nodes.slice(0, HARVEST.maxNodes))
        if (at >= node.bornAt && at < node.expiresAt)
          this.node(ctx, node, at, motion, reducedMotion);
      const visible = state.effects
        .filter(
          (effect) =>
            at >= effect.at && at - effect.at < HARVEST.effectLifetime,
        )
        .slice(-HARVEST.maxEffects);
      const pickups = new Set(
        visible
          .filter((effect) => effect.kind === 'pickup')
          .slice(-24)
          .map((effect) => effect.id),
      );
      for (const effect of visible)
        if (effect.kind !== 'pickup' || pickups.has(effect.id)) {
          const player = participants.find(
            (candidate) => candidate.id === effect.playerId,
          );
          this.effect(
            ctx,
            effect,
            at,
            player?.color ?? COLORS.mint,
            reducedMotion,
          );
        }
      for (const player of participants) {
        if (!player.connected) continue;
        const point =
          snapshot.phase === 'settling'
            ? (this.positions.get(player.id) ?? positions[player.id])
            : positions[player.id];
        if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y))
          continue;
        this.positions.set(player.id, { x: point.x, y: point.y });
        this.ship(
          ctx,
          player,
          state.players[player.id],
          point,
          at,
          reducedMotion,
        );
      }
      this.hud(
        ctx,
        snapshot.players,
        state,
        remaining,
        at,
        snapshot.endAt - snapshot.startAt,
      );
    } finally {
      ctx.restore();
    }
  }

  private node(
    ctx: CanvasRenderingContext2D,
    node: ReadonlyDeep<HarvestNode>,
    time: number,
    motion: number,
    reducedMotion: boolean,
  ): void {
    const point = harvestPosition(node, time);
    const ready = Math.min(
      1,
      Math.max(0, time - node.bornAt) / harvestWarmup(node),
    );
    const fade = Math.max(0, Math.min(1, (node.expiresAt - time) / 500));
    ctx.save();
    ctx.translate(point.x * 1600, point.y * 900);
    ctx.globalAlpha = fade * (0.35 + ready * 0.65);
    ctx.lineWidth = 2;
    if (node.kind === 'spark' || node.kind === 'gold') {
      const gold = node.kind === 'gold',
        radius = gold ? 11 : 6;
      glow(
        ctx,
        gold ? COLORS.gold : COLORS.mint,
        reducedMotion ? 0 : gold ? 22 : 16,
      );
      ctx.rotate(
        Math.PI / 4 +
          (reducedMotion ? 0 : Math.sin(motion / 1300 + node.id) * 0.2),
      );
      ctx.fillRect(-radius, -radius, radius * 2, radius * 2);
      ctx.fillStyle = '#f2ffe9';
      ctx.fillRect(-radius / 2, -radius / 2, radius, radius);
      ctx.shadowBlur = 0;
      ctx.globalAlpha *= 0.6;
      ctx.strokeRect(
        -radius - 5,
        -radius - 5,
        radius * 2 + 10,
        radius * 2 + 10,
      );
    } else if (ready < 1) {
      ctx.strokeStyle = COLORS.pink;
      ctx.setLineDash([5, 7]);
      circle(ctx, 0, 0, reducedMotion ? 32 : 47 - ready * 15);
      ctx.stroke();
      ctx.setLineDash([]);
      text(ctx, '!', 0, 8, 22, COLORS.pink, 'center');
    } else {
      glow(ctx, COLORS.pink, reducedMotion ? 0 : 18);
      ctx.rotate((reducedMotion ? 0 : motion / 2800) + node.id);
      for (let i = 0; i < 8; i++) {
        ctx.save();
        ctx.rotate((i / 8) * TAU);
        ctx.fillRect(16, -3, 13, 6);
        ctx.restore();
      }
      polygon(ctx, 8, 18);
      ctx.fillStyle = '#3a1638';
      ctx.fill();
      ctx.stroke();
      circle(ctx, 0, 0, 6);
      ctx.fillStyle = '#ffc0dc';
      ctx.fill();
    }
    ctx.restore();
  }

  private effect(
    ctx: CanvasRenderingContext2D,
    effect: ReadonlyDeep<HarvestEffect>,
    time: number,
    playerColor: string,
    reducedMotion: boolean,
  ): void {
    const elapsed = (time - effect.at) / HARVEST.effectLifetime;
    const color = effect.kind === 'ouch' ? COLORS.pink : playerColor;
    ctx.save();
    ctx.translate(effect.x * 1600, effect.y * 900);
    ctx.globalAlpha = 1 - elapsed;
    glow(ctx, color, reducedMotion ? 0 : 12);
    ctx.lineWidth = 2;
    if (effect.kind === 'pulse') {
      const radius =
        HARVEST.pulseRadius * (reducedMotion ? 1 : Math.min(1, elapsed * 3.2));
      ctx.lineWidth = 5 * (1 - elapsed) + 1;
      circle(ctx, 0, 0, radius);
      ctx.stroke();
      ctx.globalAlpha *= 0.35;
      circle(ctx, 0, 0, radius * 0.88);
      ctx.stroke();
    } else {
      circle(
        ctx,
        0,
        0,
        reducedMotion ? 22 : 12 + elapsed * (effect.kind === 'ouch' ? 58 : 42),
      );
      ctx.stroke();
      ctx.shadowBlur = 0;
      if (!reducedMotion && effect.kind === 'pickup')
        for (let i = 0; i < 7; i++) {
          const angle = hash(effect.id * 71 + i) * TAU;
          const spread =
            65 * Math.sqrt(elapsed) * (0.25 + hash(i + effect.id) * 0.75);
          ctx.fillStyle = i % 3 ? color : '#f0fdff';
          ctx.fillRect(
            Math.cos(angle) * spread,
            Math.sin(angle) * spread + elapsed * elapsed * 38,
            3,
            3,
          );
        }
    }
    ctx.globalAlpha = 1 - elapsed;
    ctx.shadowBlur = 0;
    const caption =
      effect.kind === 'ouch'
        ? `${effect.points < 0 ? `${effect.points} / ` : ''}CHAIN LOST`
        : effect.points > 0
          ? `+${effect.points}`
          : '';
    if (caption)
      text(
        ctx,
        caption,
        0,
        -30 - (reducedMotion ? 0 : elapsed * 32),
        20,
        color,
        'center',
      );
    ctx.restore();
  }

  private hud(
    ctx: CanvasRenderingContext2D,
    players: ReadonlyDeep<Player[]>,
    state: ReadonlyDeep<NeonHarvestState>,
    remaining: number,
    time: number,
    duration: number,
  ): void {
    ctx.fillStyle = '#050c19ed';
    ctx.fillRect(0, 0, 1600, 126);
    text(ctx, 'NEON HARVEST', 40, 63, 38);
    text(ctx, 'SWEEP THE LIGHT', 42, 95, 16, '#79b7cb', 'left', 600);
    text(
      ctx,
      `WAVE ${String(state.wave).padStart(2, '0')}`,
      800,
      52,
      25,
      COLORS.mint,
      'center',
    );
    text(
      ctx,
      'SPARKS + GOLD / AVOID MINES / TAP PULSE',
      800,
      85,
      16,
      '#a4bdd2',
      'center',
      600,
    );
    text(
      ctx,
      String(remaining).padStart(2, '0'),
      1520,
      80,
      62,
      '#effbff',
      'right',
    );
    text(ctx, 'SEC', 1533, 78, 16, '#a4bdd2');
    ctx.fillStyle = '#162535';
    ctx.fillRect(40, 118, 1520, 3);
    ctx.fillStyle = COLORS.mint;
    ctx.fillRect(
      40,
      118,
      1520 *
        Math.min(1, Math.max(0, (remaining * 1000) / Math.max(1, duration))),
      3,
    );
    const participants = players.filter((player) =>
      Object.hasOwn(state.players, player.id),
    );
    const columns = Math.max(1, Math.min(4, participants.length));
    participants.forEach((player, index) => {
      const width = 1520 / columns,
        x = 40 + (index % columns) * width;
      const y =
        participants.length > 4 ? 718 + Math.floor(index / 4) * 75 : 787;
      this.panel(
        ctx,
        player,
        state.players[player.id],
        state.scores[player.id] ?? 0,
        x,
        y,
        width - 12,
        time,
      );
    });
    text(
      ctx,
      'MOVE TO COLLECT · BUILD YOUR CHAIN · PULSE COLLECTS LIGHT AND CLEARS MINES',
      800,
      887,
      17,
      '#adc5d8',
      'center',
      600,
    );
  }

  private panel(
    ctx: CanvasRenderingContext2D,
    player: ReadonlyDeep<Player>,
    state: ReadonlyDeep<HarvestPlayer>,
    score: number,
    x: number,
    y: number,
    width: number,
    time: number,
  ): void {
    const chain =
      time - state.lastPickupAt <= HARVEST.chainWindow ? state.chain : 0;
    ctx.fillStyle = '#060e1de8';
    ctx.fillRect(x, y, width, 68);
    ctx.fillStyle = player.color;
    ctx.fillRect(x, y, 3, 68);
    const name =
      player.name.length > 13 ? player.name.slice(0, 12) + '…' : player.name;
    text(
      ctx,
      `${name}${player.connected ? '' : ' · OFF'}`,
      x + 13,
      y + 22,
      18,
      player.color,
    );
    text(
      ctx,
      String(Math.round(score)),
      x + width - 14,
      y + 24,
      27,
      '#effbff',
      'right',
    );
    text(
      ctx,
      state.stunnedUntil > time
        ? 'STUNNED'
        : `${harvestMultiplier(chain)}× / ${chain} CHAIN`,
      x + 13,
      y + 43,
      15,
      state.stunnedUntil > time ? COLORS.pink : '#adc5d8',
    );
    const cooldown = Math.max(0, state.pulseReadyAt - time);
    text(
      ctx,
      cooldown ? `PULSE ${Math.ceil(cooldown / 1000)}s` : 'PULSE READY',
      x + width - 14,
      y + 43,
      14,
      cooldown ? '#8b9eb4' : COLORS.mint,
      'right',
    );
    text(
      ctx,
      `${state.collected} COLLECTED · BEST CHAIN ${state.bestChain}`,
      x + 13,
      y + 60,
      13,
      '#82aec4',
      'left',
      600,
    );
    ctx.fillStyle = COLORS.mint;
    ctx.fillRect(
      x + 4,
      y + 66,
      (width - 4) * (1 - Math.min(1, cooldown / HARVEST.pulseCooldown)),
      2,
    );
  }

  private ship(
    ctx: CanvasRenderingContext2D,
    player: ReadonlyDeep<Player>,
    state: ReadonlyDeep<HarvestPlayer>,
    point: ReadonlyDeep<Point>,
    time: number,
    reducedMotion: boolean,
  ): void {
    const x = Math.max(0, Math.min(1600, point.x * 1600)),
      y = Math.max(0, Math.min(900, point.y * 900));
    const trail = reducedMotion
      ? []
      : (this.trails.get(player.id) ?? []).filter(
          (entry) => time >= entry.at && time - entry.at < 220,
        );
    const previous = trail.at(-1);
    if (!reducedMotion && (!previous || previous.x !== x || previous.y !== y)) {
      trail.push({ x, y, at: time });
      this.trails.set(player.id, trail.slice(-20));
    }
    ctx.save();
    ctx.lineCap = 'round';
    ctx.strokeStyle = player.color;
    if (!reducedMotion)
      for (let i = 1; i < trail.length; i++) {
        ctx.globalAlpha = (i / trail.length) * 0.5;
        ctx.lineWidth = (i / trail.length) * 10;
        ctx.beginPath();
        ctx.moveTo(trail[i - 1].x, trail[i - 1].y);
        ctx.lineTo(trail[i].x, trail[i].y);
        ctx.stroke();
      }
    const stunned = state.stunnedUntil > time;
    ctx.globalAlpha = stunned ? 0.5 : 1;
    ctx.translate(x, y);
    ctx.lineWidth = 2;
    if (state.chain && time - state.lastPickupAt < HARVEST.chainWindow) {
      ctx.strokeStyle = player.color;
      ctx.beginPath();
      ctx.arc(
        0,
        0,
        26,
        -Math.PI / 2,
        -Math.PI / 2 +
          TAU *
            Math.max(0, 1 - (time - state.lastPickupAt) / HARVEST.chainWindow),
      );
      ctx.stroke();
    }
    let angle = reducedMotion ? 0 : (this.headings.get(player.id) ?? 0);
    if (
      !reducedMotion &&
      previous &&
      Math.hypot(x - previous.x, y - previous.y) > 0.3
    ) {
      const target = Math.atan2(y - previous.y, x - previous.x) + Math.PI / 2;
      angle +=
        Math.atan2(Math.sin(target - angle), Math.cos(target - angle)) *
        Math.min(1, Math.max(0, time - previous.at) / 65);
      this.headings.set(player.id, angle);
    }
    ctx.save();
    ctx.rotate(angle);
    glow(ctx, stunned ? COLORS.pink : player.color, reducedMotion ? 0 : 18);
    ctx.fillStyle = player.color;
    ctx.beginPath();
    ctx.moveTo(0, -20);
    ctx.lineTo(17, 17);
    ctx.lineTo(0, 10);
    ctx.lineTo(-17, 17);
    ctx.closePath();
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#eafbff';
    ctx.beginPath();
    ctx.moveTo(0, -12);
    ctx.lineTo(5, 8);
    ctx.lineTo(-5, 8);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#99eaff';
    ctx.fillRect(
      -5,
      16,
      3,
      reducedMotion ? 8 : 8 + hash(Math.floor(time / 45)) * 14,
    );
    ctx.fillRect(
      2,
      16,
      3,
      reducedMotion ? 8 : 8 + hash(Math.floor(time / 45) + 1) * 14,
    );
    ctx.restore();
    text(
      ctx,
      player.name.slice(0, 16),
      Math.max(80, Math.min(1520, x)) - x,
      y > 675 ? -45 : 49,
      18,
      player.color,
      'center',
    );
    ctx.restore();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.trails.clear();
    this.headings.clear();
    this.positions.clear();
    if (this.background) {
      this.background.width = 0;
      this.background.height = 0;
      this.background = null;
    }
    this.round = null;
  }
}
