/** Compatibility adapter; authors do not consume legacy frame/config types. */
import {
  gameLayout,
  resolveConfig,
  defaultCapabilities,
} from '../../core/config.ts';
import {
  checkAssignment,
  validateLayout,
} from '../../controls/layout/validate.ts';
import type {
  Capabilities,
  ControllerConfig,
  Manifest,
} from '../../core/types.ts';
import type { GameDescriptor } from '../api/index.ts';

export function controllerManifest(game: GameDescriptor): Manifest {
  return {
    id: game.id,
    name: game.name,
    players: game.players,
    ...game.controls,
    expectedDurationSec: game.durationMs / 1000,
    scoring: 'points',
    onPlayerDropped: 'freeze',
    retroactiveInput: false,
    interpolatable: [],
    discrete: [],
  };
}

export function resolveController(
  game: GameDescriptor,
  capabilities: Capabilities = defaultCapabilities(),
  generation = 1,
): ControllerConfig {
  const manifest = controllerManifest(game),
    layout = gameLayout(manifest);
  const issues = [
    ...validateLayout(layout),
    ...checkAssignment(manifest, layout),
  ];
  if (issues.length)
    throw new Error(issues.map((issue) => issue.message).join(' '));
  return resolveConfig(manifest, capabilities, generation);
}
