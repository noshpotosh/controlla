import type {
  ControllerRequirements,
  GameDescriptor,
  ParticipantAssignment,
  Player,
  RoundSetupContext,
} from '../api/index.ts';
import { kindOf } from '../controls/registry.ts';
import { isControlName } from '../controls/layout/schema.ts';
import { isJsonValue } from './json.ts';
const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
export const validSeed = (value: unknown): value is number =>
  typeof value === 'number' &&
  Number.isInteger(value) &&
  value >= 0 &&
  value <= 0xffffffff;
export function freezeRoundData<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.freeze(value);
    for (const child of Object.values(value)) freezeRoundData(child);
  }
  return value;
}
export function validRequirements(
  value: unknown,
): value is ControllerRequirements {
  if (!record(value) || !record(value.inputs) || !isJsonValue(value, 8 * 1024))
    return false;
  const inputs = Object.entries(value.inputs);
  if (
    inputs.length > 24 ||
    inputs.some(
      ([name, input]) =>
        !isControlName(name) ||
        !record(input) ||
        typeof input.required !== 'boolean' ||
        !kindOf(input.prefer as never) ||
        (input.fallback !== undefined &&
          input.fallback !== null &&
          !kindOf(input.fallback as never)) ||
        ['label', 'slot', 'variant'].some(
          (key) => input[key] !== undefined && typeof input[key] !== 'string',
        ) ||
        ['props', 'motion'].some(
          (key) => input[key] !== undefined && !record(input[key]),
        ),
    )
  )
    return false;
  if (
    value.controller !== undefined &&
    (!record(value.controller) ||
      typeof value.controller.layout !== 'string' ||
      (value.controller.bind !== undefined &&
        (!record(value.controller.bind) ||
          Object.entries(value.controller.bind).some(
            ([action, name]) =>
              !Object.hasOwn(value.inputs as object, action) ||
              typeof name !== 'string' ||
              !isControlName(name),
          ))))
  )
    return false;
  return true;
}
export function validAssignments(
  value: unknown,
  players: readonly { id: string }[],
): value is ParticipantAssignment[] {
  return (
    Array.isArray(value) &&
    value.length === players.length &&
    isJsonValue(value, 24 * 1024) &&
    new Set(value.map((item) => (record(item) ? item.playerId : null))).size ===
      players.length &&
    value.every(
      (item) =>
        record(item) &&
        players.some((player) => player.id === item.playerId) &&
        typeof item.role === 'string' &&
        item.role.trim().length > 0 &&
        item.role.length <= 64 &&
        validRequirements(item.controls),
    )
  );
}
/** Setup is pure and runs once over a detached, frozen ordered roster. */
export function prepareAssignments(
  game: GameDescriptor,
  mode: string,
  players: Player[],
  seed: number,
): ParticipantAssignment[] {
  if (
    !validSeed(seed) ||
    !game.modes.some((choice) => choice.id === mode) ||
    players.length < game.players.min ||
    players.length > game.players.max ||
    players.some(
      (player) =>
        !player.connected ||
        typeof player.id !== 'string' ||
        !player.id.trim() ||
        player.id.length > 160,
    ) ||
    !isJsonValue(players, 8 * 1024) ||
    new Set(players.map((player) => player.id)).size !== players.length
  )
    throw new Error('Invalid round setup context.');
  const context: RoundSetupContext = freezeRoundData({
    mode,
    players: structuredClone(players),
    seed,
  });
  const supplied = game.setup
    ? game.setup(context)
    : players.map((player) => ({
        playerId: player.id,
        role: 'default',
        controls: game.controls,
      }));
  if (!validAssignments(supplied, players))
    throw new Error(
      'Round setup must assign each participant one valid role and controller requirements.',
    );
  return freezeRoundData(
    players.map((player) =>
      structuredClone(
        supplied.find((assignment) => assignment.playerId === player.id)!,
      ),
    ),
  );
}
