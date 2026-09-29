import type { Point, ReadonlyDeep, RoundSnapshot } from '../api/index.ts';

export interface ScreenFrame {
  snapshot: ReadonlyDeep<RoundSnapshot<object>> | null;
  presentationTime: number;
  delay: number;
  localCursors: Readonly<Record<string, Readonly<Point>>>;
  /** Local players holding a press control, such as a locked aim. */
  localPressing?: Readonly<Record<string, boolean>>;
  /** Who each local cursor belongs to, so the lobby can draw cursors before a round. */
  localPlayers?: Readonly<
    Record<string, Readonly<{ name: string; color: string }>>
  >;
  status:
    | 'ready'
    | 'waiting'
    | 'loading'
    | 'ended'
    | 'error'
    | 'aborted'
    | 'unsupported';
  message: string | null;
}

/** A display can read one coherent frame and acknowledge visible markers only. */
export interface ScreenPort {
  advanceFrame(): ReadonlyDeep<ScreenFrame>;
  presented(roundId: string, eventIds: readonly string[]): void;
}

export const RELOAD_DISPLAY_MESSAGE =
  'This screen cannot display this game version. Reload every screen and phone.';
