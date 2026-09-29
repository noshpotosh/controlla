import type { GameDescriptor } from '../api/index.ts';
import { neonHarvest } from './neon-harvest/index.ts';
import { whackAMole } from './whack-a-mole/index.ts';
/** Bundled descriptors are the single game registration surface. */
export const games: readonly GameDescriptor[] = [neonHarvest, whackAMole];
export const defaultGame = neonHarvest;
export function findGame(id: string): GameDescriptor | undefined {
  return games.find((game) => game.id === id);
}
export function resolveMode(
  game: GameDescriptor,
  mode = game.defaultMode,
): string {
  if (!game.modes.some((choice) => choice.id === mode))
    throw new Error(`Unknown mode ${mode} for ${game.id}.`);
  return mode;
}
