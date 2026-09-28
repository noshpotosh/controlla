'use client';
import { useEffect, useRef } from 'react';
import { games } from './minigames/catalog.ts';
import { createPresenter } from './game-screen/presenter.ts';
import type { ScreenPort } from './game-screen/port.ts';
import { PointerSmoother } from '../core/pointer.ts';

export function GameCanvas({ port }: { port: ScreenPort }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current!,
      ctx = canvas.getContext('2d');
    if (!ctx) return;
    const presenter = createPresenter(games);
    const preference = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    let reducedMotion = preference?.matches ?? false;
    const updateMotionPreference = () => {
      reducedMotion = preference?.matches ?? false;
    };
    preference?.addEventListener('change', updateMotionPreference);
    const cursors = new Map<string, PointerSmoother>();
    let raf = 0;
    const render = (at: number) => {
      const bounds = canvas.getBoundingClientRect();
      const scale = Math.max(
        0.5,
        Math.min(bounds.width / 1600, bounds.height / 900) *
          (window.devicePixelRatio || 1),
      );
      const width = Math.round(1600 * scale),
        height = Math.round(900 * scale);
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      ctx.setTransform(scale, 0, 0, scale, 0, 0);
      const frame = port.advanceFrame();
      const local = Object.fromEntries(
        Object.entries(frame.localCursors).map(([id, point]) => {
          let smoother = cursors.get(id);
          if (!smoother) {
            smoother = new PointerSmoother(false);
            cursors.set(id, smoother);
          }
          return [id, smoother.sample(point, at)];
        }),
      );
      for (const id of cursors.keys()) if (!(id in local)) cursors.delete(id);
      const markers = presenter.render(
        ctx,
        { ...frame, localCursors: local },
        1600,
        900,
        reducedMotion,
      );
      if (frame.snapshot && markers.length)
        port.presented(frame.snapshot.roundId, markers);
      raf = requestAnimationFrame(render);
    };
    raf = requestAnimationFrame(render);
    return () => {
      cancelAnimationFrame(raf);
      preference?.removeEventListener('change', updateMotionPreference);
      presenter.dispose();
    };
  }, [port]);
  return (
    <canvas ref={ref} aria-label="Shared game screen with player cursors" />
  );
}
