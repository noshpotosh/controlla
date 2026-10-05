import type {
  GameContext,
  GameInput,
  GameInstance,
  Outcome,
} from '../../api/index.ts';

export interface KartController {
  connected: boolean;
  mask: number;
  stickX: number;
  stickY: number;
  cStickX: number;
  cStickY: number;
  triggerLeft: number;
  triggerRight: number;
  analogA: number;
  analogB: number;
}
export interface DoubleDashState {
  controllers: KartController[];
}
export const neutralController = (): KartController => ({
  connected: false,
  mask: 0,
  stickX: 128,
  stickY: 128,
  cStickX: 128,
  cStickY: 128,
  triggerLeft: 0,
  triggerRight: 0,
  analogA: 0,
  analogB: 0,
});
const vector = (value: unknown): { x: number; y: number } => {
  if (
    !value ||
    typeof value !== 'object' ||
    !('x' in value) ||
    !('y' in value) ||
    typeof value.x !== 'number' ||
    typeof value.y !== 'number' ||
    !Number.isFinite(value.x) ||
    !Number.isFinite(value.y)
  )
    return { x: 0, y: 0 };
  return {
    x: Math.max(-1, Math.min(1, value.x)),
    y: Math.max(-1, Math.min(1, value.y)),
  };
};

/** The room owns seat assignment and input; the local game runtime owns racing. */
export class DoubleDash implements GameInstance<DoubleDashState> {
  private loaded = false;
  private context: GameContext | null = null;
  private disconnected = new Set<string>();
  private state: DoubleDashState = { controllers: [] };
  load() {
    this.loaded = true;
  }
  ready() {
    return this.loaded;
  }
  start(context: GameContext) {
    if (!this.loaded) throw new Error('Double Dash must load before starting.');
    this.context = context;
    this.disconnected.clear();
    this.state.controllers = context.players.map(() => neutralController());
  }
  tick(input: GameInput) {
    if (!this.context) return [];
    this.state.controllers = this.context.players.map((player) => {
      if (this.disconnected.has(player.id) || input.phase !== 'running')
        return neutralController();
      const values = input.values[player.id] ?? {};
      const current = (name: string) => {
        const sample = values[name];
        return sample && input.time - (sample.observedAt ?? sample.time) < 250
          ? sample.value
          : undefined;
      };
      const steer = vector(current('steer')),
        menu = vector(current('navigate')),
        options = vector(current('options'));
      const gas = current('accelerate') === true,
        brake = current('brake') === true,
        drift = current('drift') === true,
        item = current('item') === true;
      const mask =
        (gas ? 1 : 0) |
        (brake ? 2 : 0) |
        (item ? 4 : 0) |
        (options.y > 0.5 ? 128 : 0) |
        (drift ? 64 : 0) |
        (options.y < -0.5 ? 16 : 0) |
        (menu.y < -0.5 ? 256 : 0) |
        (menu.y > 0.5 ? 512 : 0) |
        (menu.x < -0.5 ? 1024 : 0) |
        (menu.x > 0.5 ? 2048 : 0);
      return {
        ...neutralController(),
        connected: player.connected,
        mask,
        stickX: Math.round(128 + steer.x * 127),
        stickY: Math.round(128 - steer.y * 127),
        triggerRight: drift ? 255 : 0,
        analogA: gas ? 255 : 0,
        analogB: brake ? 255 : 0,
      };
    });
    return [];
  }
  // Race results remain in the game; do not invent Controlla points.
  finalize(): Outcome[] {
    return (
      this.context?.players.map((player) => ({
        playerId: player.id,
        placement: 1,
        score: 0,
      })) ?? []
    );
  }
  snapshot() {
    return structuredClone(this.state);
  }
  disconnect(id: string) {
    this.disconnected.add(id);
    const port =
      this.context?.players.findIndex((player) => player.id === id) ?? -1;
    if (port >= 0) this.state.controllers[port] = neutralController();
  }
  reconnect(id: string) {
    this.disconnected.delete(id);
  }
  dispose() {
    this.context = null;
    this.loaded = false;
    this.state.controllers = [];
  }
}
export function isDoubleDashState(value: unknown): value is DoubleDashState {
  if (
    !value ||
    typeof value !== 'object' ||
    !('controllers' in value) ||
    !Array.isArray(value.controllers) ||
    value.controllers.length > 4
  )
    return false;
  return value.controllers.every(
    (controller) =>
      controller &&
      typeof controller === 'object' &&
      typeof controller.connected === 'boolean' &&
      Number.isInteger(controller.mask) &&
      controller.mask >= 0 &&
      controller.mask <= 4095 &&
      [
        'stickX',
        'stickY',
        'cStickX',
        'cStickY',
        'triggerLeft',
        'triggerRight',
        'analogA',
        'analogB',
      ].every(
        (field) =>
          Number.isInteger(controller[field]) &&
          controller[field] >= 0 &&
          controller[field] <= 255,
      ),
  );
}
