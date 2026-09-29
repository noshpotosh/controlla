import type { Player, ReadonlyDeep } from '../../api/index.ts';
import { WHACK, clamp, type WhackEffect, type WhackState } from './model.ts';
import { PALETTE } from './palette.ts';
export { PALETTE } from './palette.ts';

export const FONT =
  '"Baloo 2", "Trebuchet MS", "Arial Rounded MT Bold", sans-serif';
const TAU = Math.PI * 2;

export function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

/** Chunky toy lettering: a dark outline under a bright fill. */
export function label(
  ctx: CanvasRenderingContext2D,
  value: string,
  x: number,
  y: number,
  size: number,
  fill: string,
  align: CanvasTextAlign = 'center',
  outline: string | null = PALETTE.navy,
) {
  ctx.font = `800 ${size}px ${FONT}`;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  if (outline) {
    ctx.lineJoin = 'round';
    ctx.lineWidth = Math.max(3, size * 0.16);
    ctx.strokeStyle = outline;
    ctx.strokeText(value, x, y);
  }
  ctx.fillStyle = fill;
  ctx.fillText(value, x, y);
}

/** A faceted wooden plaque with a lighter top bevel. */
export function plaque(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  face: string,
  edge: string,
) {
  ctx.save();
  ctx.fillStyle = 'rgba(20, 16, 40, 0.28)';
  roundRect(ctx, x + 3, y + 7, w, h, 16);
  ctx.fill();
  ctx.fillStyle = edge;
  roundRect(ctx, x, y + 5, w, h, 16);
  ctx.fill();
  ctx.fillStyle = face;
  roundRect(ctx, x, y, w, h, 16);
  ctx.fill();
  ctx.fillStyle = 'rgba(255, 255, 255, 0.22)';
  roundRect(ctx, x + 6, y + 5, w - 12, h * 0.36, 11);
  ctx.fill();
  ctx.restore();
}

function flame(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(size / 20, size / 20);
  ctx.fillStyle = '#ff7a1a';
  ctx.beginPath();
  ctx.moveTo(0, -12);
  ctx.bezierCurveTo(9, -3, 10, 4, 6, 9);
  ctx.bezierCurveTo(3, 12, -3, 12, -6, 9);
  ctx.bezierCurveTo(-10, 4, -7, -2, -3, -5);
  ctx.bezierCurveTo(-2, -1, 0, 0, 1, -2);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = PALETTE.gold;
  ctx.beginPath();
  ctx.ellipse(0, 5, 3.5, 5, 0, 0, TAU);
  ctx.fill();
  ctx.restore();
}

function crown(ctx: CanvasRenderingContext2D, x: number, y: number) {
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = PALETTE.gold;
  ctx.strokeStyle = PALETTE.navy;
  ctx.lineWidth = 3;
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(-15, 8);
  ctx.lineTo(-17, -8);
  ctx.lineTo(-7, 0);
  ctx.lineTo(0, -11);
  ctx.lineTo(7, 0);
  ctx.lineTo(17, -8);
  ctx.lineTo(15, 8);
  ctx.closePath();
  ctx.stroke();
  ctx.fill();
  ctx.restore();
}

export interface HudInput {
  players: ReadonlyDeep<Player[]>;
  state: ReadonlyDeep<WhackState>;
  time: number;
  startAt: number;
  endAt: number;
  reducedMotion: boolean;
}

/** Title, timer, frenzy banner and score cards, drawn over either board. */
export function drawHud(ctx: CanvasRenderingContext2D, input: HudInput) {
  const { players, state, time, endAt, reducedMotion } = input;
  const remaining = Math.max(0, Math.ceil((endAt - time) / 1000));
  const frenzy = endAt - time <= WHACK.frenzy && time < endAt;
  const beat = reducedMotion ? 0 : Math.sin(time / 90);

  // Title sign.
  ctx.save();
  ctx.translate(34, 22);
  ctx.rotate(-0.03);
  plaque(ctx, 0, 0, 356, 84, PALETTE.coral, PALETTE.coralDark);
  label(ctx, 'WHACK-A-MOLE', 178, 44, 46, PALETTE.cream);
  ctx.restore();

  // Timer plaque.
  const timerWidth = 188;
  ctx.save();
  ctx.translate(800, 18);
  if (frenzy && !reducedMotion) ctx.scale(1 + beat * 0.03, 1 + beat * 0.03);
  plaque(
    ctx,
    -timerWidth / 2,
    0,
    timerWidth,
    92,
    frenzy ? PALETTE.gold : PALETTE.cream,
    frenzy ? '#c98d12' : PALETTE.creamShade,
  );
  label(
    ctx,
    `${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, '0')}`,
    0,
    50,
    58,
    remaining <= 10 ? PALETTE.coral : PALETTE.navy,
    'center',
    remaining <= 10 ? PALETTE.navy : null,
  );
  ctx.restore();

  if (frenzy) {
    ctx.save();
    ctx.translate(800, 148);
    ctx.rotate(reducedMotion ? 0 : Math.sin(time / 160) * 0.03);
    label(ctx, 'FRENZY!  2× POINTS', 0, 0, 40, PALETTE.gold);
    ctx.restore();
  }

  // Score cards along the bottom, in stable roster order.
  const participants = players.filter((player) =>
    Object.hasOwn(state.players, player.id),
  );
  if (!participants.length) return;
  const best = Math.max(...participants.map((p) => state.scores[p.id] ?? 0));
  const gap = 12,
    width = Math.min(
      260,
      (1600 - 60 - gap * (participants.length - 1)) / participants.length,
    ),
    total = width * participants.length + gap * (participants.length - 1),
    height = 74,
    y = 900 - height - 16;
  participants.forEach((player, index) => {
    const x = 800 - total / 2 + index * (width + gap);
    const stats = state.players[player.id],
      score = state.scores[player.id] ?? 0;
    const pop = state.effects.findLast(
      (effect) => effect.playerId === player.id && effect.points !== 0,
    );
    const bump =
      pop && !reducedMotion ? Math.max(0, 1 - (time - pop.at) / 260) : 0;
    ctx.save();
    ctx.globalAlpha = player.connected ? 1 : 0.5;
    ctx.translate(x + width / 2, y + height / 2);
    ctx.scale(1 + bump * 0.06, 1 + bump * 0.06);
    ctx.translate(-width / 2, -height / 2);
    plaque(ctx, 0, 0, width, height, PALETTE.cream, PALETTE.creamShade);
    ctx.fillStyle = player.color;
    roundRect(ctx, 8, 8, 16, height - 16, 8);
    ctx.fill();
    const narrow = width < 170;
    ctx.save();
    ctx.beginPath();
    ctx.rect(30, 0, width - 40, height);
    ctx.clip();
    label(
      ctx,
      player.name.slice(0, 14),
      34,
      24,
      narrow ? 17 : 20,
      PALETTE.navy,
      'left',
      null,
    );
    label(ctx, String(score), 34, 52, narrow ? 28 : 32, player.color, 'left');
    ctx.restore();
    if (stats.streak >= 3) {
      flame(ctx, width - 40, 50, 22);
      label(
        ctx,
        `${stats.streak}`,
        width - 22,
        52,
        18,
        PALETTE.navy,
        'center',
        null,
      );
    }
    if (stats.stunnedUntil > time)
      label(ctx, 'DIZZY', width - 34, 22, 15, PALETTE.coral, 'center', null);
    ctx.restore();
    if (score > 0 && score === best) crown(ctx, x + width - 22, y - 4);
  });
}

/** Floating "+10" pops above holes, in the whacker's colour. */
export function drawPops(
  ctx: CanvasRenderingContext2D,
  state: ReadonlyDeep<WhackState>,
  players: ReadonlyDeep<Player[]>,
  time: number,
  reducedMotion: boolean,
) {
  for (const effect of state.effects) {
    const age = time - effect.at;
    if (age < 0 || age >= WHACK.effectLifetime) continue;
    const text = popText(effect);
    if (!text) continue;
    const hole = effect.hole >= 0 ? state.holes[effect.hole] : undefined;
    const x = effect.x * 1600,
      y = effect.y * 900 - (hole ? hole.reach * 1.1 : 40);
    const color =
      effect.kind === 'boom'
        ? PALETTE.coral
        : effect.kind === 'gold'
          ? PALETTE.gold
          : (players.find((p) => p.id === effect.playerId)?.color ??
            PALETTE.cream);
    const t = age / WHACK.effectLifetime;
    ctx.save();
    ctx.globalAlpha = 1 - clamp((t - 0.6) / 0.4);
    const rise = reducedMotion ? 0 : 60 * (1 - (1 - t) ** 3);
    const scale = reducedMotion
      ? 1
      : 0.6 +
        0.6 * Math.min(1, age / 120) -
        0.2 * Math.min(1, Math.max(0, age - 120) / 200);
    ctx.translate(x, y - rise);
    ctx.scale(scale, scale);
    label(ctx, text, 0, 0, effect.kind === 'gold' ? 50 : 42, color);
    ctx.restore();
  }
}

const popText = (effect: ReadonlyDeep<WhackEffect>) =>
  effect.kind === 'miss'
    ? ''
    : effect.points > 0
      ? `+${effect.points}`
      : effect.points < 0
        ? `${effect.points}`
        : effect.kind === 'boom'
          ? 'BOOM!'
          : '';
