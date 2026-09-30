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
  /** Screen number 1–8 within the room (the host is 1); drives the emblem. */
  index?: number;
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

/** Room codes avoid 0/O, 1/I/L and U so they survive being read aloud. */
export const ROOM_ALPHABET = '23456789ABCDEFGHJKMNPQRSTVWXYZ';
export const ROOM_CODE = /^[23456789ABCDEFGHJKMNPQRSTVWXYZ]{4,6}$/;
export const MAX_SCREENS = 8;
/** One per screen number, so a phone can match the emblem it sees on the TV. */
export const SCREEN_EMBLEMS = [
  'star',
  'moon',
  'bolt',
  'heart',
  'leaf',
  'flame',
  'anchor',
  'rocket',
] as const;
export type ScreenEmblem = (typeof SCREEN_EMBLEMS)[number];
export const screenEmblem = (index: number): ScreenEmblem =>
  SCREEN_EMBLEMS[(Math.max(1, index) - 1) % SCREEN_EMBLEMS.length];

/** What a not-yet-joined device may learn about a room before choosing a screen. */
export interface ScreenPreview {
  id: string;
  index: number;
  name: string;
  /** The viewer reached signaling from the same network as this screen. */
  sameNetwork: boolean;
}
export interface RoomPreview {
  room: string;
  screens: ScreenPreview[];
  /** No phone seats are free. */
  full: boolean;
}
