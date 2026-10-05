import type {
  GameDescriptor,
  Point,
  ReadonlyDeep,
  RoundSnapshot,
} from '../api/index.ts';

export function freezeSnapshot<T>(value: T): ReadonlyDeep<T> {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) freezeSnapshot(child);
  }
  return value as ReadonlyDeep<T>;
}

/** Presentation only: no session service, input transport, or authoritative game. */
export function createScreen<S extends object>(descriptor: GameDescriptor<S>) {
  const renderer = descriptor.createRenderer();
  let disposed = false;
  let rendererDisposed = false;
  const disposeRenderer = () => {
    if (rendererDisposed) return;
    rendererDisposed = true;
    renderer.dispose();
  };
  return {
    render(
      context: CanvasRenderingContext2D,
      snapshot: ReadonlyDeep<RoundSnapshot<S>> | null,
      time: number,
      width: number,
      height: number,
      localCursors: ReadonlyDeep<Record<string, Point>> = {},
      delay = 0,
      reducedMotion = false,
      localPressing: ReadonlyDeep<Record<string, boolean>> = {},
    ): readonly string[] {
      if (disposed) return [];
      let markers: readonly string[] = [];
      context.save();
      try {
        context.fillStyle = '#181c35';
        context.fillRect(0, 0, width, height);
        const label = (
          text: string,
          y: number,
          size = 26,
          color = '#fff9e8',
        ) => {
          context.fillStyle = color;
          context.font = `700 ${size}px system-ui`;
          context.textAlign = 'center';
          context.fillText(text, width / 2, y);
        };
        if (!snapshot) {
          label('Waiting for the presentation timeline…', height / 2);
          return [];
        }
        const readonly = freezeSnapshot(
          structuredClone(snapshot) as RoundSnapshot<S>,
        );
        const readonlyLocalCursors = freezeSnapshot(
          Object.fromEntries(
            Object.entries(localCursors)
              .filter(
                ([id, point]) =>
                  snapshot.players.some(
                    (player) => player.id === id && player.connected,
                  ) &&
                  point &&
                  typeof point === 'object' &&
                  Number.isFinite(point.x) &&
                  Number.isFinite(point.y),
              )
              .map(([id, point]) => [id, { x: point.x, y: point.y }]),
          ),
        );
        const readonlyLocalPressing = freezeSnapshot(
          Object.fromEntries(
            Object.entries(localPressing).filter(
              ([id, pressing]) =>
                pressing === true && id in readonlyLocalCursors,
            ),
          ),
        );
        if (snapshot.phase === 'countdown') {
          label(descriptor.name, height * 0.27, 38);
          label(
            String(Math.max(1, Math.ceil((snapshot.startAt - time) / 1000))),
            height * 0.62,
            120,
            '#b6ff65',
          );
        } else if (snapshot.phase === 'results') {
          disposeRenderer();
          label('Round results', height * 0.16, 42, '#b6ff65');
          [...snapshot.outcomes]
            .sort((a, b) => a.placement - b.placement)
            .forEach((outcome, i) => {
              const player = snapshot.players.find(
                (p) => p.id === outcome.playerId,
              );
              label(
                `${outcome.placement}. ${player?.name ?? outcome.playerId} · ${outcome.score} game score · +${snapshot.progress.awards[outcome.playerId] ?? 0} session points · ${snapshot.progress.totals[outcome.playerId] ?? 0} total`,
                height * 0.33 + i * 48,
                24,
                player?.color,
              );
            });
        } else if (snapshot.phase === 'aborted' || snapshot.phase === 'error') {
          disposeRenderer();
          label(
            snapshot.phase === 'aborted'
              ? 'Round aborted · no points awarded'
              : (snapshot.error ?? 'Game failed'),
            height / 2,
          );
        } else {
          context.save();
          try {
            markers =
              (rendererDisposed
                ? undefined
                : renderer.render({
                    context,
                    snapshot: readonly,
                    time: Math.min(time, snapshot.endAt),
                    width,
                    height,
                    delay,
                    localCursors: readonlyLocalCursors,
                    localPressing: readonlyLocalPressing,
                    reducedMotion,
                  })) ?? [];
          } finally {
            context.restore();
          }
          if (snapshot.phase === 'settling')
            label('Finishing round…', height * 0.14, 24);
        }
        if (
          descriptor.presentation.cursors &&
          ['countdown', 'running'].includes(snapshot.phase)
        ) {
          for (const [id, point] of Object.entries({
            ...snapshot.cursors,
            ...readonlyLocalCursors,
          })) {
            const player = snapshot.players.find((p) => p.id === id);
            if (!player?.connected) continue;
            const x = Math.max(0, Math.min(1, point.x)) * width;
            const y = Math.max(0, Math.min(1, point.y)) * height;
            context.strokeStyle = player.color;
            context.lineWidth = 3;
            context.beginPath();
            context.arc(x, y, 13, 0, Math.PI * 2);
            context.moveTo(x - 20, y);
            context.lineTo(x + 20, y);
            context.moveTo(x, y - 20);
            context.lineTo(x, y + 20);
            context.stroke();
            context.font = '18px system-ui';
            context.fillStyle = player.color;
            context.textAlign = 'center';
            context.fillText(player.name, x, y + 34);
          }
        }
        return markers;
      } finally {
        context.restore();
      }
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      disposeRenderer();
    },
  };
}
