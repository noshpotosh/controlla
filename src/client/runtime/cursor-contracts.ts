import type { Player, Roster } from '../../shared/room.ts';
import type { InputFrame } from '../engine/protocol.ts';
import type { Message } from '../engine/messages.ts';
/** Observations admitted by routing; playback owns cursor validation and state. */
export interface CursorObservations {
  roster(venueId: string | null, roster: Roster): void;
  configure(playerId: string, message: Message): void;
  input(
    player: Player,
    frame: InputFrame,
    authorityTime: number,
    localTime: number,
  ): void;
  control(player: Player, message: Message): void;
  clear(): void;
}
