import { newer, type InputFrame } from '../../engine/protocol.ts';
import type { Message } from '../../engine/messages.ts';
import type { Player, Roster } from '../../../shared/room.ts';
import type { Point } from '../../../core/types.ts';

/** Immediate local cursor playback; only routing-admitted observations enter here. */
export class CursorPlayback {
  private venueId: string | null = null;
  private roster: Roster = { players: [], venues: [] };
  private terminal = false;
  private localCursors = new Map<
    string,
    { point: Point; at: number; color: string; name: string }
  >();
  // Cursor admission mirrors the local phone's config/ACK and binary ordering.
  // Remote venues observe the same trusted config as they relay it to the phone.
  private cursorInputs = new Map<
    string,
    { generation: number; ready: boolean; seq: number | null }
  >();
  setRoster(venueId: string | null, roster: Roster) {
    if (this.terminal) return;
    this.venueId = venueId;
    this.roster = structuredClone(roster);
    for (const id of this.cursorInputs.keys())
      if (
        !roster.players.some(
          (player) =>
            player.id === id && player.connected && player.venueId === venueId,
        )
      ) {
        this.cursorInputs.delete(id);
        this.localCursors.delete(id);
      }
  }
  configure(playerId: string, message: Message) {
    if (
      this.terminal ||
      !message ||
      message.type !== 'config' ||
      message.config?.schemaVersion !== 1 ||
      !Number.isInteger(message.config.generation) ||
      message.config.generation < 0 ||
      message.config.generation > 65535 ||
      !this.roster.players.some(
        (player) =>
          player.id === playerId &&
          player.connected &&
          player.venueId === this.venueId,
      )
    )
      return;
    const generation = message.config.generation as number;
    if (this.cursorInputs.get(playerId)?.generation === generation) return;
    this.cursorInputs.set(playerId, { generation, ready: false, seq: null });
    this.localCursors.delete(playerId);
  }
  input(player: Player, frame: InputFrame, time: number, localTime: number) {
    if (this.terminal) return;
    const cursor = this.cursorInputs.get(player.id);

    if (
      player.connected &&
      player.venueId === this.venueId &&
      cursor?.ready &&
      frame.generation === cursor.generation &&
      frame.time <= time + 100 &&
      time - frame.time <= 2000 &&
      (cursor.seq === null || newer(frame.seq, cursor.seq))
    ) {
      cursor.seq = frame.seq;
      this.localCursors.set(player.id, {
        point: { x: frame.x, y: frame.y },
        at: localTime,
        color: player.color,
        name: player.name,
      });
    }
  }
  control(player: Player, message: Message) {
    if (this.terminal) return;
    const cursor = this.cursorInputs.get(player.id);
    if (cursor && player.connected && player.venueId === this.venueId) {
      if (message.type === 'ready' && message.generation === cursor.generation)
        cursor.ready = true;
      else if (message.type === 'hello') {
        cursor.ready = false;
        this.localCursors.delete(player.id);
      }
    }
  }
  dispose() {
    this.clear();
    this.terminal = true;
  }
  clear() {
    this.cursorInputs.clear();
    this.localCursors.clear();
  }
  cursors(localTime: number) {
    return Object.freeze(
      [...this.localCursors.entries()]
        .filter(([, c]) => localTime - c.at < 1000)
        .map(([id, c]) =>
          Object.freeze({ id, ...c, point: Object.freeze({ ...c.point }) }),
        ),
    );
  }
}
