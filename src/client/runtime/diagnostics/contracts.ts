import type { Identity } from '../../../shared/room.ts';
import type { Message } from '../../engine/messages.ts';
import type { LinkStats } from '../../transport/contracts.ts';

export interface DiagnosticSnapshot {
  identity: Readonly<
    Pick<Identity, 'role' | 'hostId' | 'venueId' | 'room'>
  > | null;
  clock: { offset: number; error: number; rtt: unknown };
  sensorHz: number;
  pointer: { gain: number; recenters: number };
  path: 'venue' | 'direct-to-session';
  metrics: {
    oneWay: unknown;
    lastBytes: number;
    deltaRatio: number | null;
    starvations: number;
  };
  completed: unknown;
  progress: unknown;
  authority: unknown;
}
export interface DiagnosticPorts {
  snapshot(): DiagnosticSnapshot;
  stats(): Promise<Record<string, LinkStats>>;
  publish(links: Record<string, LinkStats>, message: Message | null): void;
}
