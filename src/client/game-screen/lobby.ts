import type { ReadonlyDeep } from '../api/index.ts';
import type { ScreenFrame } from './port.ts';

const TAU = Math.PI * 2;

/**
 * The lobby before a round: phones that are connected already drive a cursor,
 * so players can feel out motion aiming, Recenter and sensitivity before a game.
 */
export function createLobby() {
  const trails = new Map<string, { x: number; y: number; at: number }[]>();
  return {
    render(
      ctx: CanvasRenderingContext2D,
      frame: ReadonlyDeep<ScreenFrame>,
      width: number,
      height: number,
      message: string,
      reducedMotion = false,
    ) {
      const time = frame.presentationTime;
      ctx.save();
      try {
        ctx.fillStyle = '#181c35';
        ctx.fillRect(0, 0, width, height);
        ctx.textAlign = 'center';
        ctx.fillStyle = '#fff9e8';
        ctx.font = '700 32px system-ui';
        ctx.fillText(message, width / 2, height * 0.42, width - 80);
        ctx.fillStyle = '#9aa3c7';
        ctx.font = '500 21px system-ui';
        ctx.fillText(
          'On your phone, tap Enable motion and point at the screen to try your cursor.',
          width / 2,
          height * 0.42 + 44,
          width - 80,
        );
        const players = frame.localPlayers ?? {};
        for (const id of trails.keys())
          if (!(id in frame.localCursors)) trails.delete(id);
        for (const [id, point] of Object.entries(frame.localCursors)) {
          const player = players[id];
          if (!player || !Number.isFinite(point.x) || !Number.isFinite(point.y))
            continue;
          const x = Math.max(0, Math.min(1, point.x)) * width,
            y = Math.max(0, Math.min(1, point.y)) * height;
          const trail = (trails.get(id) ?? []).filter(
            (entry) => time >= entry.at && time - entry.at < 260,
          );
          trail.push({ x, y, at: time });
          trails.set(id, trail.slice(-24));
          ctx.strokeStyle = player.color;
          ctx.lineCap = 'round';
          if (!reducedMotion)
            for (let i = 1; i < trail.length; i++) {
              ctx.globalAlpha = (i / trail.length) * 0.5;
              ctx.lineWidth = (i / trail.length) * 12;
              ctx.beginPath();
              ctx.moveTo(trail[i - 1].x, trail[i - 1].y);
              ctx.lineTo(trail[i].x, trail[i].y);
              ctx.stroke();
            }
          ctx.globalAlpha = 1;
          ctx.shadowColor = player.color;
          ctx.shadowBlur = reducedMotion ? 0 : 18;
          ctx.lineWidth = 4;
          ctx.beginPath();
          ctx.arc(x, y, 20, 0, TAU);
          ctx.stroke();
          ctx.fillStyle = player.color;
          ctx.beginPath();
          ctx.arc(x, y, 6, 0, TAU);
          ctx.fill();
          ctx.shadowBlur = 0;
          ctx.font = '700 20px system-ui';
          ctx.fillText(
            player.name.slice(0, 16),
            x,
            y > height - 60 ? y - 34 : y + 44,
          );
        }
      } finally {
        ctx.restore();
      }
    },
    clear() {
      trails.clear();
    },
  };
}
