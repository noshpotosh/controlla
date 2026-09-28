/** Adapt a game descriptor to the shared controller resolver. */
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
  ControllerSpec,
} from '../../controls/api.ts';
import type { GameDescriptor } from '../api/index.ts';

export function controllerSpec(game: GameDescriptor): ControllerSpec {
  return {
    id: game.id,
    name: game.name,
    ...game.controls,
  };
}

export function resolveController(
  game: GameDescriptor,
  capabilities: Capabilities = defaultCapabilities(),
  generation = 1,
): ControllerConfig {
  const spec = controllerSpec(game),
    layout = gameLayout(spec);
  const issues = [...validateLayout(layout), ...checkAssignment(spec, layout)];
  if (issues.length)
    throw new Error(issues.map((issue) => issue.message).join(' '));
  return resolveConfig(spec, capabilities, generation);
}
