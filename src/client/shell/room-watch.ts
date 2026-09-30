// Looks at a room's screens before joining it, so a phone can pick the one
// in front of it. Separate from the runtime's socket, which opens on join.
import {
  APP_PROTOCOL_VERSION,
  PROTOCOL_MISMATCH,
  PROTOCOL_RELOAD_MESSAGE,
} from '../../shared/app-protocol.ts';
import type { RoomPreview } from '../../shared/room.ts';

export interface RoomWatchEvents {
  preview(this: void, preview: RoomPreview): void;
  /** Terminal: the room ended, does not exist, or cannot be watched. */
  closed(this: void, reason: string): void;
}
export function watchRoom(
  endpoint: string,
  room: string,
  on: RoomWatchEvents,
): () => void {
  let stopped = false,
    retry = 0,
    socket: WebSocket | null = null,
    timer: ReturnType<typeof setTimeout> | undefined;
  const stop = (reason?: string) => {
    if (stopped) return;
    stopped = true;
    clearTimeout(timer);
    socket?.close();
    if (reason !== undefined) on.closed(reason);
  };
  const open = () => {
    let ws: WebSocket;
    try {
      ws = new WebSocket(endpoint);
    } catch {
      stop('Room service address is invalid.');
      return;
    }
    socket = ws;
    ws.onopen = () =>
      ws.send(
        JSON.stringify({
          type: 'watch',
          room,
          protocolVersion: APP_PROTOCOL_VERSION,
        }),
      );
    ws.onmessage = (event) => {
      if (stopped || socket !== ws) return;
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(String(event.data)) as Record<string, unknown>;
      } catch {
        return;
      }
      if (msg.type === 'room') {
        retry = 0;
        on.preview({
          room: String(msg.room),
          screens: Array.isArray(msg.screens) ? msg.screens : [],
          full: msg.full === true,
        });
      } else if (msg.type === 'ended') stop(String(msg.reason));
      else if (msg.type === 'error')
        stop(
          msg.code === PROTOCOL_MISMATCH
            ? PROTOCOL_RELOAD_MESSAGE
            : String(msg.message),
        );
    };
    // Network blips and the service's watch time limit just reconnect.
    ws.onclose = () => {
      if (stopped || socket !== ws) return;
      timer = setTimeout(open, Math.min(5000, 500 * 2 ** retry++));
    };
  };
  open();
  return () => stop();
}
