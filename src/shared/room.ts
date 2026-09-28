/** Room contracts shared by browsers and signaling; no platform dependencies. */
export type Role = 'host' | 'display' | 'controller';
export interface Player {
  id: string;
  venueId: string;
  seat: number;
  name: string;
  color: string;
  connected: boolean;
  disconnectedAt?: number;
}
export interface Venue {
  id: string;
  name: string;
  connected: boolean;
}
export interface Roster {
  players: Player[];
  venues: Venue[];
}
export interface Identity {
  id: string;
  role: Role;
  room: string;
  venueId: string;
  token: string;
  hostId: string;
}
export const COLORS = [
  '#b6ff65',
  '#74d9ff',
  '#ff91bc',
  '#ffc66e',
  '#b7a0ff',
  '#72f0cd',
  '#ff8066',
  '#eaf1ff',
];
