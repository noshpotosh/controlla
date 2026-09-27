import type { GameState, Player, Point } from '../core/types.ts';

/** Render-only game module. It cannot access Session or transport state. */
export class MinigameRenderer {
  private state: GameState | null = null;
  applySnapshot(state: GameState) {
    this.state = structuredClone(state);
  }
  render(
    ctx: CanvasRenderingContext2D,
    players: Player[],
    time: number,
    D: number,
  ) {
    const state = this.state;
    if (!state) return;
    const W = 1600,
      H = 900;
    const circle = (p: Point, r: number, color: string) => {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(p.x * W, p.y * H, r, 0, Math.PI * 2);
      ctx.fill();
    };
    const label = (
      text: string,
      x: number,
      y: number,
      size = 26,
      color = '#fff9e8',
      align: CanvasTextAlign = 'center',
    ) => {
      ctx.font = `800 ${size}px "Trebuchet MS", sans-serif`;
      ctx.fillStyle = color;
      ctx.textAlign = align;
      ctx.fillText(text, x, y);
    };
    label(
      `${state.gameId === 'tilt-rally' ? 'TILT RALLY' : 'LATENCY LAB'} / ${state.mode.toUpperCase()}`,
      40,
      55,
      22,
      '#b8bed5',
      'left',
    );
    label(
      `${Math.max(0, Math.ceil((state.endAt - time + D) / 1000))}s`,
      W - 40,
      55,
      28,
      '#d5ff70',
      'right',
    );
    if (state.gameId === 'tilt-rally') {
      const lane = 0.5 + 0.32 * Math.sin((time - D - state.startAt) / 2300);
      ctx.fillStyle = '#d5ff7014';
      ctx.fillRect(0, (lane - 0.12) * H, W, 0.24 * H);
      ctx.setLineDash([12, 12]);
      ctx.strokeStyle = '#d5ff70';
      ctx.beginPath();
      ctx.moveTo(0, lane * H);
      ctx.lineTo(W, lane * H);
      ctx.stroke();
      ctx.setLineDash([]);
      label(
        'Stay in the moving lane. Swipe for a boost.',
        W / 2,
        H - 40,
        22,
        '#b8bed5',
      );
      for (const [id, p] of Object.entries(state.racers)) {
        const player = players.find((p) => p.id === id);
        circle(p, 18, player?.color ?? '#fff');
        label(player?.name ?? '', p.x * W, p.y * H - 30, 18, player?.color);
      }
    } else if (state.mode === 'tracking') {
      circle(state.target, 42, '#d5ff70');
      circle(state.target, 10, '#20283a');
      label('Keep your crosshair on the target.', W / 2, H - 40, 24, '#b8bed5');
    } else if (state.mode === 'strobe') {
      label(
        'Press FIRE to switch the screen.',
        W / 2,
        H / 2,
        42,
        state.flash ? '#172411' : '#d5ff70',
      );
    } else if (state.promptId && time >= state.targetAt) {
      circle(state.target, 64, '#d5ff70');
      label('FIRE', state.target.x * W, state.target.y * H + 10, 28, '#15220c');
    } else label('Wait for the target…', W / 2, H / 2, 42, '#b8bed5');
  }
}
