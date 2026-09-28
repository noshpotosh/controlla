import type { Channel, Message } from '../../engine/messages.ts';
import type { Identity } from '../../../shared/room.ts';
import type { CursorObservations } from '../cursor-contracts.ts';

export type RoutingIdentity = Pick<
  Identity,
  'id' | 'role' | 'hostId' | 'venueId'
>;
export type ControllerRoute = 'venue' | 'direct-to-session';
export interface RoutingEnvironment {
  localTime(): number;
  authorityTime(): number;
  /** Schedule after the current stack; callbacks may still run after retirement. */
  defer(callback: () => void): void;
}
export interface RoutingEffects {
  send(to: string, channel: Channel, data: Message | ArrayBuffer): void;
  authorityInput(playerId: string, data: ArrayBuffer): void;
  authorityControl(from: string, message: Message): void;
  display(channel: Channel, message: Message): void;
  controller(message: Message): void;
  cursors: CursorObservations;
  isOpen(id: string): boolean;
  ensureHostFallback(): void;
}
