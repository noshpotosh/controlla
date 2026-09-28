/** Adapt a game descriptor to the shared controller resolver. */
import { resolveConfig, defaultCapabilities } from '../controls/resolve.ts';
import type {
  Capabilities,
  ControllerConfig,
  ControllerSpec,
} from '../controls/api.ts';
import type { GameDescriptor } from '../api/index.ts';

export function controllerSpec(game: GameDescriptor): ControllerSpec {
  return {
    id: game.id,
    name: game.name,
    inputs: game.controls.inputs,
    ...(game.controls.controller && { controller: game.controls.controller }),
  };
}

export function resolveController(
  game: GameDescriptor,
  capabilities: Capabilities = defaultCapabilities(),
  generation = 1,
): ControllerConfig {
  return resolveConfig(controllerSpec(game), capabilities, generation);
}
