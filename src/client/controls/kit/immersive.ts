'use client';
// Landscape controllers lose a third of their height to the browser's
// toolbar. Where the browser allows it (Android Chrome, iPadOS, desktop), the
// first touch in landscape takes the page fullscreen. iPhone Safari has no
// page fullscreen, so there the fix is launching from the Home Screen, where
// the web app manifest opens it without browser chrome.
import { useEffect, useSyncExternalStore } from 'react';

const LANDSCAPE = '(orientation: landscape)';
const STANDALONE = '(display-mode: fullscreen), (display-mode: standalone)';

const subscribeMedia = (query: string) => (change: () => void) => {
  const m = matchMedia(query);
  m.addEventListener('change', change);
  return () => m.removeEventListener('change', change);
};
const useMedia = (query: string) =>
  useSyncExternalStore(
    subscribeMedia(query),
    () => matchMedia(query).matches,
    () => false,
  );

/** Launched from the Home Screen (no browser chrome at all). */
export function isStandalone() {
  return (
    matchMedia(STANDALONE).matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

/** The browser can take the page fullscreen on a tap. */
export const canGoFullscreen = () =>
  typeof document !== 'undefined' && document.fullscreenEnabled === true;

export interface Immersive {
  landscape: boolean;
  /**
   * The browser's toolbar is showing in landscape and only the Home Screen
   * can hide it (iPhone Safari). Show the player how.
   */
  suggestHomeScreen: boolean;
}

/**
 * While `active`, go fullscreen on the first touch after the phone turns to
 * landscape. Players who leave fullscreen aren't pulled back until they
 * rotate again.
 */
export function useImmersive(active = true): Immersive {
  const landscape = useMedia(LANDSCAPE),
    standalone = useMedia(STANDALONE);
  useEffect(() => {
    if (!active || !landscape || !canGoFullscreen() || isStandalone()) return;
    let entered = false;
    const enter = () => {
      if (document.fullscreenElement) return;
      document.documentElement
        .requestFullscreen({ navigationUI: 'hide' })
        .catch(() => {
          /* Refused (e.g. no user activation): try again on the next touch. */
        });
    };
    const stop = () =>
      document.removeEventListener('pointerdown', enter, { capture: true });
    // Once fullscreen, a player who leaves it chose to: stop asking.
    const change = () => {
      if (document.fullscreenElement) entered = true;
      else if (entered) stop();
    };
    // Capture so it runs before a control claims the pointer.
    document.addEventListener('pointerdown', enter, { capture: true });
    document.addEventListener('fullscreenchange', change);
    return () => {
      stop();
      document.removeEventListener('fullscreenchange', change);
    };
  }, [active, landscape]);
  return {
    landscape,
    suggestHomeScreen:
      landscape &&
      !standalone &&
      typeof document !== 'undefined' &&
      !canGoFullscreen() &&
      !(navigator as Navigator & { standalone?: boolean }).standalone,
  };
}
