import { deadzone, radialClamp, round } from '../kit/geometry.ts';
import type { StickOutput, Vector } from '../api.ts';

/**
 * Stick output for a finger at `finger` with the stick centred at `origin`
 * (both in px). `radius` is the knob's full travel in px.
 */
export function stickVector(
  origin: Vector,
  finger: Vector,
  radius: number,
  zone: number,
): { output: StickOutput; knob: Vector } {
  const knob = radialClamp(
    { x: (finger.x - origin.x) / radius, y: (finger.y - origin.y) / radius },
    1,
  );
  const out = deadzone(knob, zone);
  return { output: { x: round(out.x), y: round(out.y) }, knob };
}

/** Keep a floating origin far enough from the edges that full travel fits. */
export function clampOrigin(
  p: Vector,
  size: { width: number; height: number },
  radius: number,
): Vector {
  const fit = (v: number, span: number) =>
    span < radius * 2 ? span / 2 : Math.min(span - radius, Math.max(radius, v));
  return { x: fit(p.x, size.width), y: fit(p.y, size.height) };
}
