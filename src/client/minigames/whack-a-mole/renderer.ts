import type {
  GameRenderer,
  Point,
  Presentation,
  ReadonlyDeep,
} from '../../api/index.ts';
import type { WhackState } from './model.ts';
import { drawBoard2d } from './board2d.ts';
import { drawHud, drawPops } from './hud.ts';

/** Game-owned presentation. No input, session, or transport capabilities. */
export class WhackAMoleRenderer implements GameRenderer<WhackState> {
  private positions = new Map<string, Point>();
  private round: string | null = null;
  private disposed = false;

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
    const at = Math.min(time, snapshot.endAt);
    // Settling freezes hammers where they were at the cutoff.
    const live =
      snapshot.phase === 'running'
        ? { ...snapshot.cursors, ...localCursors }
        : {};
    for (const player of snapshot.players) {
      const point = live[player.id];
      if (point && Number.isFinite(point.x) && Number.isFinite(point.y))
        this.positions.set(player.id, { x: point.x, y: point.y });
    }
    const cursors = Object.fromEntries(this.positions) as ReadonlyDeep<
      Record<string, Point>
    >;
    ctx.save();
    try {
      ctx.scale(width / 1600, height / 900);
      drawBoard2d(ctx, state, snapshot.players, cursors, at, reducedMotion);
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

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.positions.clear();
    this.round = null;
  }
}
