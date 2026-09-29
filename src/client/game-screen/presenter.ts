import type { GameDescriptor, ReadonlyDeep } from '../api/index.ts';
import type { ScreenFrame } from './port.ts';
import { RELOAD_DISPLAY_MESSAGE } from './port.ts';
import { createScreen } from './screen.ts';
import { createLobby } from './lobby.ts';

/** Renderer lifetime and render failures belong to this display, never authority. */
export function createPresenter(games: readonly GameDescriptor[]) {
  let mounted: ReturnType<typeof createScreen> | null = null;
  let key: string | null = null;
  let failure: string | null = null;
  const lobby = createLobby();
  const release = () => {
    const old = mounted;
    mounted = null;
    try {
      old?.dispose();
    } catch {
      /* A renderer cannot prevent display cleanup. */
    }
  };
  const label = (
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    message: string,
  ) => {
    ctx.save();
    try {
      ctx.fillStyle = '#181c35';
      ctx.fillRect(0, 0, width, height);
      ctx.fillStyle = '#fff9e8';
      ctx.font = '700 32px system-ui';
      ctx.textAlign = 'center';
      ctx.fillText(message, width / 2, height / 2, width - 80);
    } finally {
      ctx.restore();
    }
  };
  return {
    render(
      ctx: CanvasRenderingContext2D,
      frame: ReadonlyDeep<ScreenFrame>,
      width: number,
      height: number,
      reducedMotion = false,
    ): readonly string[] {
      const snapshot = frame.snapshot;
      if (frame.status === 'waiting' && !snapshot) {
        release();
        lobby.render(
          ctx,
          frame,
          width,
          height,
          frame.message ?? 'Connect your phones. Pick a game below.',
          reducedMotion,
        );
        return [];
      }
      lobby.clear();
      if (frame.status !== 'ready' || !snapshot) {
        release();
        label(
          ctx,
          width,
          height,
          frame.message ??
            (frame.status === 'loading'
              ? 'Preparing round…'
              : 'Connect your phones. Pick a game below.'),
        );
        return [];
      }
      const nextKey = `${snapshot.roundId}:${snapshot.gameId}:${snapshot.mode}`;
      if (nextKey !== key) {
        release();
        key = nextKey;
        failure = null;
      }
      if (failure) {
        label(ctx, width, height, failure);
        return [];
      }
      const descriptor = games.find((game) => game.id === snapshot.gameId);
      if (
        !descriptor ||
        !descriptor.modes.some((mode) => mode.id === snapshot.mode) ||
        snapshot.schemaVersion !== 1
      ) {
        release();
        label(ctx, width, height, RELOAD_DISPLAY_MESSAGE);
        return [];
      }
      try {
        mounted ??= createScreen(descriptor);
        return mounted.render(
          ctx,
          snapshot,
          frame.presentationTime,
          width,
          height,
          frame.localCursors,
          frame.delay,
          reducedMotion,
        );
      } catch (error) {
        release();
        failure = `This screen could not render the game: ${error instanceof Error ? error.message : String(error)}`;
        label(ctx, width, height, failure);
        return [];
      }
    },
    error() {
      return failure;
    },
    dispose() {
      release();
      key = null;
      failure = null;
    },
  };
}
