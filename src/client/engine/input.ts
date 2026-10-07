/** Adapt a game descriptor to the shared controller resolver. */
import { resolveConfig, defaultCapabilities } from '../controls/resolve.ts';
import type {
  Capabilities,
  ControllerConfig,
  ControllerSpec,
  ControllerRequirements,
} from '../controls/api.ts';
import type { GameDescriptor } from '../api/index.ts';

export function controllerSpec(
  game: GameDescriptor,
  controls: ControllerRequirements = game.controls,
): ControllerSpec {
  return {
    id: game.id,
    name: game.name,
    inputs: controls.inputs,
    ...(controls.controller && { controller: controls.controller }),
  };
}

export function resolveController(
  game: GameDescriptor,
  capabilities: Capabilities = defaultCapabilities(),
  generation = 1,
  controls: ControllerRequirements = game.controls,
): ControllerConfig {
  return resolveConfig(
    controllerSpec(game, controls),
    capabilities,
    generation,
  );
}
