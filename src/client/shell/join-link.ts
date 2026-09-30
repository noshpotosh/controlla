// One link joins a room from any device: `/K7QMX` is the invite, and
// `/K7QMX/2` (the QR on screen 2) also says which screen you are looking at.
import {
  MAX_SCREENS,
  ROOM_CODE,
  type ScreenPreview,
} from '../../shared/room.ts';

export interface JoinPath {
  room?: string;
  screen?: number;
}
export function parseJoinPath(pathname: string): JoinPath {
  const [code, screen, ...rest] = pathname.split('/').filter(Boolean);
  const room = code?.toUpperCase();
  if (!room || rest.length || !ROOM_CODE.test(room)) return {};
  const index = Number(screen);
  return screen !== undefined &&
    Number.isInteger(index) &&
    index >= 1 &&
    index <= MAX_SCREENS
    ? { room, screen: index }
    : { room };
}
export const roomPath = (room: string, screen?: number) =>
  `/${room.toUpperCase()}${screen ? `/${screen}` : ''}`;

/** Phones hold the controller; anything larger or mouse-driven is a screen. */
export const isPhoneLike = ({
  coarse,
  shortSide,
}: {
  coarse: boolean;
  shortSide: number;
}) => coarse && shortSide < 600;

export type ScreenChoice =
  | { kind: 'hinted' | 'sameNetwork' | 'only'; screen: ScreenPreview }
  | { kind: 'pick' };
/**
 * The screen a phone most likely faces: the one its QR named, else the only
 * one on its Wi-Fi, else the only one in the room (to be confirmed), else ask.
 */
export function chooseScreen(
  screens: readonly ScreenPreview[],
  hint?: number,
): ScreenChoice {
  const hinted = hint && screens.find((s) => s.index === hint);
  if (hinted) return { kind: 'hinted', screen: hinted };
  const near = screens.filter((s) => s.sameNetwork);
  if (near.length === 1) return { kind: 'sameNetwork', screen: near[0] };
  if (screens.length === 1) return { kind: 'only', screen: screens[0] };
  return { kind: 'pick' };
}
/** Screens that arrived after `known` first, then same Wi-Fi, then by number. */
export function orderScreens(
  screens: readonly ScreenPreview[],
  known?: ReadonlySet<string>,
): ScreenPreview[] {
  const rank = (s: ScreenPreview) =>
    (known && !known.has(s.id) ? 0 : 2) + (s.sameNetwork ? 0 : 1);
  return [...screens].sort((a, b) => rank(a) - rank(b) || a.index - b.index);
}
/** While a phone waits for its own screen: the newcomer that is probably it. */
export function arrival(
  screens: readonly ScreenPreview[],
  known: ReadonlySet<string>,
): ScreenPreview | undefined {
  const fresh = screens.filter((s) => !known.has(s.id)),
    near = fresh.filter((s) => s.sameNetwork);
  return near.length === 1
    ? near[0]
    : fresh.length === 1
      ? fresh[0]
      : undefined;
}

/** Signaling rides on this page's origin unless `?signal=` overrides it. */
export function signalEndpoint(
  place: Pick<Location, 'protocol' | 'host' | 'search'>,
) {
  return (
    new URLSearchParams(place.search).get('signal') ??
    `${place.protocol === 'https:' ? 'wss' : 'ws'}://${place.host}/signal`
  );
}
