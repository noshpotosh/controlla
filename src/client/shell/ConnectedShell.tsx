'use client';
import { useEffect, useSyncExternalStore, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { RoomScreen } from './RoomScreen.tsx';
import { ControllerScreen } from './ControllerScreen.tsx';
import type { SessionPort, GameChoice } from './ports.ts';
import type { AppExtensions } from './extensions.ts';

export function ConnectedShell({
  session,
  games,
  screen,
  leave,
  extensions,
}: {
  session: SessionPort;
  games: readonly GameChoice[];
  screen: ReactNode;
  leave(this: void): void;
  extensions?: AppExtensions;
}) {
  const v = useSyncExternalStore(
    session.subscribe,
    session.getSnapshot,
    session.getSnapshot,
  );
  const me = v.identity;
  useEffect(() => {
    const context = (
      document as Document & {
        modelContext?: {
          registerTool: (
            tool: unknown,
            options: { signal: AbortSignal },
          ) => void | Promise<void>;
        };
      }
    ).modelContext;
    if (!context?.registerTool) return;
    const abort = new AbortController();
    try {
      void Promise.resolve(
        context.registerTool(
          {
            name: 'read_party_room',
            description:
              'Read the current room, connected players, phase, and diagnostics without exposing resume tokens.',
            inputSchema: {
              type: 'object',
              properties: {},
              additionalProperties: false,
            },
            annotations: { readOnlyHint: true, untrustedContentHint: true },
            execute(input: unknown) {
              if (
                !input ||
                typeof input !== 'object' ||
                Object.keys(input).length
              )
                throw new Error('Expected an empty object');
              return {
                room: session.getSnapshot().identity?.room,
                role: session.getSnapshot().identity?.role,
                roster: session.getSnapshot().roster,
                phase: session.getSnapshot().phase,
                status: session.getSnapshot().status,
                D: session.getSnapshot().D,
              };
            },
          },
          { signal: abort.signal },
        ),
      ).catch(() => {});
    } catch {
      /* Optional browser standard. */
    }
    return () => abort.abort();
  }, [session]);
  if (!me)
    return (
      <main className="shell">
        <header className="topbar">
          <span className="brand">
            controlla<span>●</span>
          </span>
        </header>
        <section className="entry">
          <div>
            <h1>{v.status}</h1>
            <p className="note">Connecting to your room.</p>
            {v.warning && (
              <p className="error" role="alert">
                {v.warning}
              </p>
            )}
            <Button className="action" onClick={leave}>
              Back to setup
            </Button>
          </div>
        </section>
      </main>
    );
  return me.role === 'controller' ? (
    <ControllerScreen
      view={v}
      phone={session.phone}
      motion={session.motion}
      exportSummary={session.room.exportSummary}
      leave={leave}
      panel={extensions?.controllerPanel}
    />
  ) : (
    <RoomScreen
      view={v}
      actions={session.room}
      host={session.host}
      games={games}
      screen={screen}
      leave={leave}
    />
  );
}
