import type { Player, Point, ReadonlyDeep } from '../../api/index.ts';
import {
  molePose,
  type Hole,
  type Mole,
  type WhackEffect,
  type WhackState,
} from './model.ts';
import { PALETTE } from './hud.ts';

const TAU = Math.PI * 2;
const MOLE = {
  normal: { body: '#9a6a45', belly: '#e9c79c' },
  golden: { body: '#f2b82e', belly: '#ffe9a3' },
  bomb: { body: '#3a3f55', belly: '#6b7190' },
};

/**
 * Flat fallback board: shown while the 3D stage loads, when WebGL is missing, and
 * in headless tests. It uses the same screen-space holes as the host's hit tests.
 */
export function drawBoard2d(
  ctx: CanvasRenderingContext2D,
  state: ReadonlyDeep<WhackState>,
  players: ReadonlyDeep<Player[]>,
  cursors: ReadonlyDeep<Record<string, Point>>,
  time: number,
  reducedMotion: boolean,
) {
  const sky = ctx.createLinearGradient(0, 0, 0, 900);
  sky.addColorStop(0, PALETTE.sky);
  sky.addColorStop(1, PALETTE.skyDark);
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, 1600, 900);
  // Playset: a wooden base with a grassy top.
  ctx.fillStyle = PALETTE.woodDark;
  ctx.beginPath();
  ctx.ellipse(800, 560, 790, 330, 0, 0, TAU);
  ctx.fill();
  ctx.fillStyle = PALETTE.grassDark;
  ctx.beginPath();
  ctx.ellipse(800, 540, 770, 310, 0, 0, TAU);
  ctx.fill();
  ctx.fillStyle = PALETTE.grass;
  ctx.beginPath();
  ctx.ellipse(800, 530, 750, 296, 0, 0, TAU);
  ctx.fill();
  const moles = [...state.moles].sort(
    (a, b) => state.holes[a.hole].y - state.holes[b.hole].y,
  );
  state.holes.forEach((hole, index) => {
    drawHole(ctx, hole);
    for (const mole of moles)
      if (mole.hole === index) drawMole(ctx, hole, mole, time, reducedMotion);
  });
  for (const effect of state.effects)
    drawEffect(ctx, effect, time, reducedMotion);
  for (const player of players) {
    const cursor = cursors[player.id];
    if (!player.connected || !cursor || !state.players[player.id]) continue;
    const slam = state.effects.findLast(
      (effect) => effect.playerId === player.id && time >= effect.at,
    );
    drawHammer(
      ctx,
      cursor,
      player.color,
      slam ? time - slam.at : Infinity,
      state.players[player.id].stunnedUntil > time,
      time,
      reducedMotion,
    );
  }
}

function drawHole(ctx: CanvasRenderingContext2D, hole: ReadonlyDeep<Hole>) {
  const x = hole.x * 1600,
    y = hole.y * 900;
  ctx.fillStyle = PALETTE.wood;
  ctx.beginPath();
  ctx.ellipse(x, y + 4, hole.rx * 1.18, hole.ry * 1.35, 0, 0, TAU);
  ctx.fill();
  ctx.fillStyle = '#2a170c';
  ctx.beginPath();
  ctx.ellipse(x, y, hole.rx, hole.ry, 0, 0, TAU);
  ctx.fill();
}

function drawMole(
  ctx: CanvasRenderingContext2D,
  hole: ReadonlyDeep<Hole>,
  mole: ReadonlyDeep<Mole>,
  time: number,
  reducedMotion: boolean,
) {
  const pose = molePose(mole, time);
  if (pose.phase === 'gone' || pose.height <= 0) return;
  const x = hole.x * 1600,
    y = hole.y * 900,
    w = hole.rx * 0.78,
    h = hole.reach * 0.92;
  const colors = MOLE[mole.kind];
  const bonked = pose.phase === 'bonked';
  const squash = bonked ? Math.max(0.55, 1 - pose.elapsed * 3) : 1;
  const bob =
    reducedMotion || pose.phase !== 'up'
      ? 0
      : Math.sin(time / 180 + mole.id) * 3;
  ctx.save();
  // Only the part above the rim shows; the lower half of the hole stays in front.
  ctx.beginPath();
  ctx.rect(
    x - hole.rx * 1.3,
    y - hole.reach * 2,
    hole.rx * 2.6,
    hole.reach * 2,
  );
  ctx.ellipse(x, y, hole.rx, hole.ry, 0, 0, TAU);
  ctx.clip();
  const top = y - h * pose.height * squash + bob;
  ctx.translate(x, top);
  ctx.scale(bonked ? 1 + (1 - squash) * 0.8 : 1, squash);
  ctx.fillStyle = colors.body;
  ctx.beginPath();
  ctx.ellipse(0, h * 0.55, w, h * 0.62, 0, 0, TAU);
  ctx.fill();
  ctx.fillStyle = colors.belly;
  ctx.beginPath();
  ctx.ellipse(0, h * 0.72, w * 0.62, h * 0.4, 0, 0, TAU);
  ctx.fill();
  if (mole.kind === 'bomb') {
    ctx.strokeStyle = '#d9a441';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(0, -2);
    ctx.quadraticCurveTo(10, -18, 4, -26);
    ctx.stroke();
    if (!reducedMotion) {
      ctx.fillStyle = Math.floor(time / 70) % 2 ? '#ffdd55' : '#ff7733';
      ctx.beginPath();
      ctx.arc(4, -28, 6, 0, TAU);
      ctx.fill();
    }
  }
  if (mole.kind === 'golden') {
    ctx.fillStyle = '#fff1a6';
    ctx.beginPath();
    ctx.moveTo(-w * 0.45, h * 0.02);
    ctx.lineTo(-w * 0.3, -h * 0.2);
    ctx.lineTo(0, -h * 0.05);
    ctx.lineTo(w * 0.3, -h * 0.2);
    ctx.lineTo(w * 0.45, h * 0.02);
    ctx.closePath();
    ctx.fill();
  }
  // Face.
  const eye = h * 0.3;
  if (bonked) {
    ctx.strokeStyle = PALETTE.navy;
    ctx.lineWidth = 3;
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(side * w * 0.35 - 6, eye - 6);
      ctx.lineTo(side * w * 0.35 + 6, eye + 6);
      ctx.moveTo(side * w * 0.35 + 6, eye - 6);
      ctx.lineTo(side * w * 0.35 - 6, eye + 6);
      ctx.stroke();
    }
  } else
    for (const side of [-1, 1]) {
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(side * w * 0.35, eye, w * 0.2, 0, TAU);
      ctx.fill();
      ctx.fillStyle = PALETTE.navy;
      ctx.beginPath();
      ctx.arc(side * w * 0.35, eye + 1, w * 0.12, 0, TAU);
      ctx.fill();
    }
  if (mole.kind === 'bomb' && !bonked) {
    ctx.strokeStyle = PALETTE.navy;
    ctx.lineWidth = 4;
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(side * w * 0.55, eye - w * 0.3);
      ctx.lineTo(side * w * 0.15, eye - w * 0.18);
      ctx.stroke();
    }
  }
  ctx.fillStyle = '#ff8fa3';
  ctx.beginPath();
  ctx.ellipse(0, eye + w * 0.32, w * 0.16, w * 0.11, 0, 0, TAU);
  ctx.fill();
  ctx.restore();
  // Front rim over the mole's base.
  ctx.strokeStyle = PALETTE.wood;
  ctx.lineWidth = hole.ry * 0.5;
  ctx.beginPath();
  ctx.ellipse(x, y + 2, hole.rx * 1.05, hole.ry * 1.1, 0, 0.05, Math.PI - 0.05);
  ctx.stroke();
  if (bonked && !reducedMotion) {
    ctx.fillStyle = PALETTE.gold;
    for (let i = 0; i < 3; i++) {
      const a = pose.elapsed * 7 + (i * TAU) / 3;
      star(ctx, x + Math.cos(a) * w, top - 10 + Math.sin(a) * w * 0.3, 8);
    }
  }
}

function star(ctx: CanvasRenderingContext2D, x: number, y: number, r: number) {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5,
      radius = i % 2 ? r * 0.45 : r;
    ctx.lineTo(x + Math.cos(a) * radius, y + Math.sin(a) * radius);
  }
  ctx.closePath();
  ctx.fill();
}

function drawEffect(
  ctx: CanvasRenderingContext2D,
  effect: ReadonlyDeep<WhackEffect>,
  time: number,
  reducedMotion: boolean,
) {
  const age = time - effect.at;
  if (age < 0 || age > 420) return;
  const t = age / 420,
    x = effect.x * 1600,
    y = effect.y * 900;
  ctx.save();
  ctx.globalAlpha = 1 - t;
  ctx.strokeStyle =
    effect.kind === 'boom'
      ? '#ff6a3d'
      : effect.kind === 'gold'
        ? PALETTE.gold
        : '#fff6e0';
  ctx.lineWidth = 6 * (1 - t) + 1;
  ctx.beginPath();
  ctx.ellipse(
    x,
    y,
    30 + (reducedMotion ? 30 : t * 90),
    12 + (reducedMotion ? 12 : t * 36),
    0,
    0,
    TAU,
  );
  ctx.stroke();
  ctx.restore();
}

/** A player's hammer: rests tilted up, slams flat on impact, then recoils. */
export function hammerAngle(sinceSlam: number) {
  if (sinceSlam < 0 || sinceSlam > 330) return -0.7;
  if (sinceSlam < 70) return 0.15;
  const t = (sinceSlam - 70) / 260;
  return 0.15 - 0.85 * (1 - (1 - t) ** 2);
}

function drawHammer(
  ctx: CanvasRenderingContext2D,
  cursor: ReadonlyDeep<Point>,
  color: string,
  sinceSlam: number,
  stunned: boolean,
  time: number,
  reducedMotion: boolean,
) {
  const x = cursor.x * 1600,
    y = cursor.y * 900;
  ctx.save();
  ctx.translate(x + 70, y + 18);
  ctx.rotate(
    hammerAngle(sinceSlam) +
      (stunned && !reducedMotion ? Math.sin(time / 60) * 0.25 : 0),
  );
  ctx.fillStyle = PALETTE.wood;
  ctx.fillRect(-4, -8, 90, 16);
  ctx.translate(-70, -18);
  ctx.fillStyle = PALETTE.navy;
  ctx.fillRect(-40, -8, 80, 52);
  ctx.fillStyle = color;
  ctx.fillRect(-36, -4, 72, 44);
  ctx.fillStyle = 'rgba(255,255,255,0.3)';
  ctx.fillRect(-36, -4, 72, 12);
  ctx.restore();
  ctx.fillStyle = color;
  ctx.globalAlpha = 0.6;
  ctx.beginPath();
  ctx.arc(x, y, 6, 0, TAU);
  ctx.fill();
  ctx.globalAlpha = 1;
}
