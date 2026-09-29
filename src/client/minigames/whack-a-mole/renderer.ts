import type {
  GameRenderer,
  Player,
  Point,
  Presentation,
  ReadonlyDeep,
} from '../../api/index.ts';
import { hammerRadius, type WhackState } from './model.ts';
import type { Stage, StageLabel } from './stage-contract.ts';
import { drawBoard2d } from './board2d.ts';
import { PALETTE, drawHud, drawPops, label, roundRect } from './hud.ts';

/**
 * Game-owned presentation. No input, session, or transport capabilities.
 *
 * The 3D stage (and three.js with it) loads lazily in the browser, so phones and
 * the headless engine never fetch it. Until it is ready, without WebGL, or if
 * it fails, the flat 2D board draws the same screen-space holes instead.
 */
export class WhackAMoleRenderer implements GameRenderer<WhackState> {
  private positions = new Map<string, Point>();
  private round: string | null = null;
  private lastTime = 0;
  private disposed = false;
  private stage: Stage | null = null;
  private failed = false;

  constructor() {
    if (typeof document === 'undefined' || typeof window === 'undefined') {
      this.failed = true;
      return;
    }
    import('./stage/stage.ts').then(
      ({ createStage }) => {
        const stage = createStage();
        if (this.disposed) stage?.dispose();
        else if (stage) this.stage = stage;
        else this.failed = true;
      },
      () => {
        this.failed = true;
      },
    );
  }

  render({
    context: ctx,
    snapshot,
    time,
    width,
    height,
    localCursors = {},
    reducedMotion = false,
  }: Presentation<WhackState>): void {
    if (
      this.disposed ||
      !snapshot.state ||
      !['running', 'settling'].includes(snapshot.phase)
    )
      return;
    const state = snapshot.state;
    if (this.round !== snapshot.roundId) {
      this.round = snapshot.roundId;
      this.positions.clear();
    }
    const dt = Math.min(0.1, Math.max(0, (time - this.lastTime) / 1000));
    this.lastTime = time;
    const glide = reducedMotion ? 1 : 1 - Math.exp(-dt / 0.035);
    const at = Math.min(time, snapshot.endAt);
    // Settling freezes hammers where they were at the cutoff.
    const live =
      snapshot.phase === 'running'
        ? { ...snapshot.cursors, ...localCursors }
        : {};
    for (const player of snapshot.players) {
      const point = live[player.id];
      if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y))
        continue;
      // Phone Wi-Fi delivers cursor packets in bursts; glide over them, but
      // jump straight to a far-away point such as after Recenter.
      const last = this.positions.get(player.id);
      this.positions.set(
        player.id,
        last && Math.hypot(point.x - last.x, point.y - last.y) < 0.25
          ? {
              x: last.x + (point.x - last.x) * glide,
              y: last.y + (point.y - last.y) * glide,
            }
          : { x: point.x, y: point.y },
      );
    }
    const cursors = Object.fromEntries(this.positions) as ReadonlyDeep<
      Record<string, Point>
    >;
    ctx.save();
    try {
      ctx.scale(width / 1600, height / 900);
      const labels = this.draw3d(
        ctx,
        state,
        snapshot.players,
        cursors,
        at,
        snapshot.endAt,
        reducedMotion,
      );
      if (!labels)
        drawBoard2d(ctx, state, snapshot.players, cursors, at, reducedMotion);
      drawReticles(ctx, state, snapshot.players, cursors);
      if (labels) drawLabels(ctx, labels, snapshot.players);
      drawPops(ctx, state, snapshot.players, at, reducedMotion);
      drawHud(ctx, {
        players: snapshot.players,
        state,
        time: at,
        startAt: snapshot.startAt,
        endAt: snapshot.endAt,
        reducedMotion,
      });
    } finally {
      ctx.restore();
    }
  }

  /** Renders and composites the 3D stage; null means draw the 2D board instead. */
  private draw3d(
    ctx: CanvasRenderingContext2D,
    state: ReadonlyDeep<WhackState>,
    players: ReadonlyDeep<Player[]>,
    cursors: ReadonlyDeep<Record<string, Point>>,
    time: number,
    endAt: number,
    reducedMotion: boolean,
  ): readonly StageLabel[] | null {
    const stage = this.stage,
      canvas = ctx.canvas as HTMLCanvasElement | undefined;
    if (this.failed || !stage || !canvas || typeof ctx.drawImage !== 'function')
      return null;
    try {
      const labels = stage.render({
        state,
        players,
        cursors,
        time,
        endAt,
        reducedMotion,
        width: canvas.width || 1600,
        height: canvas.height || 900,
      });
      if (!labels) throw new Error('The 3D stage lost its context.');
      ctx.drawImage(stage.canvas, 0, 0, 1600, 900);
      return labels;
    } catch {
      // Failure stays local to this display: keep playing on the 2D board.
      this.failed = true;
      this.stage = null;
      stage.dispose();
      return null;
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.positions.clear();
    this.round = null;
    this.stage?.dispose();
    this.stage = null;
  }
}

/** Each hammer's hit area at its cursor: any part of this ring touching a mole counts. */
function drawReticles(
  ctx: CanvasRenderingContext2D,
  state: ReadonlyDeep<WhackState>,
  players: ReadonlyDeep<Player[]>,
  cursors: ReadonlyDeep<Record<string, Point>>,
) {
  ctx.save();
  ctx.lineWidth = 3;
  for (const player of players) {
    const aim = cursors[player.id];
    if (!player.connected || !aim || !state.players[player.id]) continue;
    const x = aim.x * 1600,
      y = aim.y * 900,
      radius = hammerRadius(aim);
    ctx.globalAlpha = 0.5;
    ctx.strokeStyle = PALETTE.navy;
    ctx.beginPath();
    ctx.arc(x, y, radius + 1.5, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 0.9;
    ctx.strokeStyle = player.color;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = player.color;
    ctx.beginPath();
    ctx.arc(x, y, 3.5, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

/** Small name tags under each hammer, so eight players can find themselves. */
function drawLabels(
  ctx: CanvasRenderingContext2D,
  labels: readonly StageLabel[],
  players: ReadonlyDeep<Player[]>,
) {
  ctx.save();
  for (const tag of labels) {
    const player = players.find((p) => p.id === tag.playerId);
    if (!player) continue;
    const name = player.name.slice(0, 12),
      x = tag.x * 1600,
      y = Math.min(tag.y * 900 + 26, 790);
    ctx.font = `800 17px "Baloo 2", "Trebuchet MS", sans-serif`;
    const w = ctx.measureText(name).width + 18;
    ctx.globalAlpha = 0.92;
    ctx.fillStyle = PALETTE.navy;
    roundRect(ctx, x - w / 2, y - 13, w, 26, 13);
    ctx.fill();
    ctx.globalAlpha = 1;
    label(ctx, name, x, y + 1, 17, player.color, 'center', null);
  }
  ctx.restore();
}
