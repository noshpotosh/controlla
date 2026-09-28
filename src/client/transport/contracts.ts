import type { Channel, Message } from '../engine/messages.ts';
import type { Identity, Roster } from '../../shared/room.ts';

export interface LinkStats {
  path: 'connecting' | 'P2P' | 'TURN' | 'WebSocket';
  rtt: number | null;
  localCandidate?: string;
  remoteCandidate?: string;
}
/** Browser transport seam. No gameplay, input processing, or presentation state. */
export interface Transport {
  onWelcome: (identity: Identity) => void;
  onRoster: (roster: Roster) => void;
  onMessage: (from: string, channel: Channel, data: Message | ArrayBuffer) => void;
  onWarning: (message: string) => void;
  onEnded: (reason: string) => void;
  onStatus: (status: string) => void;
  connect(): void;
  send(to: string, channel: Channel, data: unknown): void;
  isOpen(id: string, channel?: Channel): boolean;
  ensureHostFallback(): void;
  stats(): Promise<Record<string, LinkStats>>;
  close(): void;
}
