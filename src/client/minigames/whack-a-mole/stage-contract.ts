import type { Player, Point, ReadonlyDeep } from '../../api/index.ts';
import type { WhackState } from './model.ts';

/**
 * The boundary between the eager renderer and the lazily loaded 3D stage. It
 * holds no three.js types, so the renderer (and the headless engine that
 * reaches it through the catalog) never depends on three.
 */
export interface StageFrame {
  state: ReadonlyDeep<WhackState>;
  players: ReadonlyDeep<Player[]>;
  /** Hammer positions in normalized screen space. */
  cursors: ReadonlyDeep<Record<string, Point>>;
  time: number;
  endAt: number;
  reducedMotion: boolean;
  /** Backbuffer size in physical pixels. */
  width: number;
  height: number;
}

export interface StageLabel {
  playerId: string;
  /** Normalized screen position just under the player's hammer. */
  x: number;
  y: number;
}

export interface Stage {
  /** The WebGL canvas the renderer copies onto the game canvas after each render. */
  readonly canvas: HTMLCanvasElement;
  /** Draws a frame; null means the stage can no longer render (context lost). */
  render(frame: StageFrame): readonly StageLabel[] | null;
  dispose(): void;
}
