import { dominantDirection, round } from '../kit/geometry.ts';
import type { SwipeOutput } from '../api.ts';

/**
 * Classify a finished swipe. `dx`/`dy` are in px, normalised by the pad's
 * shorter side so a swipe means the same on any phone. Returns null if short.
 */
export function classifySwipe(
  dx: number,
  dy: number,
  durationMs: number,
  size: { width: number; height: number },
  minDistance: number,
): SwipeOutput | null {
  const unit = Math.min(size.width, size.height) || 1,
    x = dx / unit,
    y = dy / unit,
    distance = Math.hypot(x, y);
  if (distance < minDistance) return null;
  return {
    dir: dominantDirection({ x, y }),
    x: round(x),
    y: round(y),
    distance: round(distance),
    velocity: round((distance * 1000) / Math.max(16, durationMs)),
  };
}
