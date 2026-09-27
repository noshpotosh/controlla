'use client';
import { useEffect, useRef } from 'react';
import { MinigameRenderer } from '../games/renderer.ts';
import type { Runtime } from './runtime.ts';
import type { Point } from '../core/types.ts';
import { PointerSmoother } from '../core/pointer.ts';
export function GameCanvas({ runtime }: { runtime: Runtime }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current!,
      ctx = canvas.getContext('2d')!;
    let raf = 0;
    const renderer = new MinigameRenderer();
    const cursors = new Map<string, PointerSmoother>();
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
    const crosshair = (p: Point, color: string, name: string) => {
      if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return;
      const x = Math.max(0, Math.min(W, p.x * W)),
        y = Math.max(0, Math.min(H, p.y * H));
      ctx.fillStyle = '#181c35b3';
      ctx.beginPath();
      ctx.arc(x, y, 20, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = color;
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(x, y, 19, 0, Math.PI * 2);
      ctx.moveTo(x - 28, y);
      ctx.lineTo(x + 28, y);
      ctx.moveTo(x, y - 28);
      ctx.lineTo(x, y + 28);
      ctx.stroke();
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(x, y, 4, 0, Math.PI * 2);
      ctx.fill();
      label(
        name,
        Math.max(70, Math.min(W - 70, x)),
        y > H - 65 ? y - 40 : y + 44,
        20,
        color,
      );
    };
    const render = (at: number) => {
      const bounds = canvas.getBoundingClientRect(),
        scale = Math.max(
          0.5,
          Math.min(bounds.width / W, bounds.height / H) *
            (window.devicePixelRatio || 1),
        );
      const width = Math.round(W * scale),
        height = Math.round(H * scale);
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      ctx.setTransform(scale, 0, 0, scale, 0, 0);
      const state = runtime.renderState(),
        view = runtime.view;
      ctx.fillStyle = state?.flash ? '#eef4e9' : '#181c35';
      ctx.fillRect(0, 0, W, H);
      if (!state?.flash) {
        ctx.fillStyle = '#303650';
        for (let x = 40; x < W; x += 60)
          for (let y = 30; y < H; y += 60) {
            ctx.beginPath();
            ctx.arc(x, y, 2, 0, Math.PI * 2);
            ctx.fill();
          }
      }
      if (view.ended) {
        ctx.fillStyle = '#181c35';
        ctx.fillRect(0, 0, W, H);
        label('Session ended', W / 2, H / 2 - 40, 64, '#d5ff70');
        label('The host screen disconnected.', W / 2, H / 2 + 30, 30);
        label(
          'Exit fullscreen to save completed results.',
          W / 2,
          H / 2 + 90,
          24,
          '#b5bad2',
        );
      } else if (runtime.calibrationMarkers().length > 0) {
        const points = [
          { x: 0.5, y: 0.5 },
          { x: 0, y: 0 },
          { x: 1, y: 0 },
          { x: 1, y: 1 },
          { x: 0, y: 1 },
        ];
        runtime.calibrationMarkers().forEach((marker, index) => {
          const p = points[marker.step];
          circle(p, 35, marker.color);
          circle(p, 8, '#15200d');
          label(
            `${marker.name}: ${marker.step + 1}/5`,
            W / 2,
            80 + index * 32,
            22,
            marker.color,
          );
        });
        ctx.strokeStyle = '#d5ff70';
        ctx.lineWidth = 4;
        ctx.strokeRect(2, 2, W - 4, H - 4);
        label(
          'Aim at your highlighted point. Tap your phone.',
          W / 2,
          H / 2 + 100,
          30,
        );
        label(
          'Use the corners of this game area, not the physical screen.',
          W / 2,
          H / 2 + 150,
          24,
          '#b5bad2',
        );
      } else if (!state || state.phase === 'lobby') {
        label('Everybody in. Game on.', W / 2, H / 2 - 20, 64, '#fff9e8');
        label(
          'Connect your phones. Pick a game below.',
          W / 2,
          H / 2 + 45,
          26,
          '#b5bad2',
        );
        label('PHONES READY? LET’S PLAY.', W / 2, H - 65, 20, '#d5ff70');
      } else if (state.phase === 'countdown') {
        const remaining = Math.max(
          1,
          Math.ceil((state.startAt - (runtime.time() - view.D)) / 1000),
        );
        label(String(remaining), W / 2, H / 2 + 50, 180, '#d5ff70');
        label('GET READY', W / 2, H / 2 - 140, 26);
      } else if (state.phase === 'results') {
        label('Nicely played!', W / 2, 180, 68, '#d5ff70');
        state.results.forEach((r, i) => {
          const p = view.roster.players.find((p) => p.id === r.playerId);
          label(
            `${r.rank.toString().padStart(2, '0')}  ${p?.name ?? 'Player'}`,
            350,
            290 + i * 58,
            30,
            p?.color ?? '#fff',
            'left',
          );
          label(
            `${r.score} pts`,
            W - 350,
            290 + i * 58,
            30,
            '#fff9e8',
            'right',
          );
        });
      } else {
        renderer.applySnapshot(state);
        renderer.render(ctx, view.roster.players, runtime.time(), view.D);
        if (state.promptId > 0 && runtime.time() >= state.targetAt)
          runtime.presented(state);
      }
      const local = runtime.cursors(),
        localIds = new Set(local.map((c) => c.id));
      if (state && state.gameId !== 'tilt-rally')
        for (const [id, p] of Object.entries(state.cursors))
          if (!localIds.has(id)) {
            const player = view.roster.players.find((p) => p.id === id);
            crosshair(p, player?.color ?? '#fff', player?.name ?? '');
          }
      if (state?.gameId !== 'tilt-rally')
        for (const cursor of local) {
          let smoother = cursors.get(cursor.id);
          if (!smoother) {
            smoother = new PointerSmoother(false);
            cursors.set(cursor.id, smoother);
          }
          crosshair(
            smoother.sample(cursor.point, at),
            cursor.color,
            cursor.name,
          );
        }
      for (const id of cursors.keys())
        if (!localIds.has(id)) cursors.delete(id);
      raf = requestAnimationFrame(render);
    };
    raf = requestAnimationFrame(render);
    return () => cancelAnimationFrame(raf);
  }, [runtime]);
  return (
    <canvas ref={ref} aria-label="Shared game screen with player crosshairs" />
  );
}
