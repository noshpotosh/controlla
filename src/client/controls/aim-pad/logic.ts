import { clamp, round } from '../kit/geometry.ts';
import type { Vector } from '../api.ts';

export interface AimPadPoint extends Vector {
  width: number;
  height: number;
}

/** Absolute positions fill a square output range, even on a rectangular pad. */
export function aimPadVector(point: AimPadPoint): Vector | null {
  if (
    ![point.x, point.y, point.width, point.height].every(Number.isFinite) ||
    point.width <= 0 ||
    point.height <= 0
  )
    return null;
  return {
    x: round(clamp((point.x / point.width) * 2 - 1)),
    y: round(clamp((point.y / point.height) * 2 - 1)),
  };
}

/** A pad owns one retained position; finishing a gesture never emits a reset. */
export class AimPadInput {
  private current: Vector = { x: 0, y: 0 };
  constructor(private emit: (value: Vector) => void) {}
  setEmitter(emit: (value: Vector) => void): void {
    this.emit = emit;
  }
  point(): Vector {
    return { ...this.current };
  }
  private update(next: Vector) {
    if (next.x === this.current.x && next.y === this.current.y) return;
    this.current = { ...next };
    this.emit({ ...next });
  }
  move(point: AimPadPoint): void {
    const next = aimPadVector(point);
    if (next) this.update(next);
  }
  key(key: string): boolean {
    const direction: Record<string, Vector> = {
      ArrowLeft: { x: -1, y: 0 },
      ArrowRight: { x: 1, y: 0 },
      ArrowUp: { x: 0, y: -1 },
      ArrowDown: { x: 0, y: 1 },
    };
    if (key === 'Home') this.update({ x: 0, y: 0 });
    else if (Object.hasOwn(direction, key)) {
      const delta = direction[key];
      this.update({
        x: round(clamp(this.current.x + delta.x * 0.1)),
        y: round(clamp(this.current.y + delta.y * 0.1)),
      });
    } else return false;
    return true;
  }
  end(): void {
    // Release, cancellation, lost capture and unmount all retain the last sample.
  }
}
