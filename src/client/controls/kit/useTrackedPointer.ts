'use client';
// The one pointer-tracking implementation every control uses: captures a
// single finger, ignores extra touches, and always reports an end (even on
// cancel, lost capture or unmount) so no control can leave an input stuck.
import {
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { toLocal } from '../layout/rotation.ts';
import { useRotation } from './rotation-context.ts';

export interface TrackedPoint {
  /** px from the element's top-left, in its own (unrotated) frame. */
  x: number;
  y: number;
  width: number;
  height: number;
  /** performance.now() */
  time: number;
}

export interface TrackCallbacks {
  onStart?(p: TrackedPoint): void;
  onMove?(p: TrackedPoint, start: TrackedPoint): void;
  onEnd?(p: TrackedPoint, start: TrackedPoint, cancelled: boolean): void;
}

export function useTrackedPointer(callbacks: TrackCallbacks) {
  const [active, setActive] = useState(false),
    rotation = useRotation();
  const track = useRef<{
      id: number;
      start: TrackedPoint;
      last: TrackedPoint;
    } | null>(null),
    cb = useRef(callbacks);
  useEffect(() => {
    cb.current = callbacks;
  });
  useEffect(
    () => () => {
      const t = track.current;
      track.current = null;
      if (t) cb.current.onEnd?.(t.last, t.start, true);
    },
    [],
  );
  const local = (e: ReactPointerEvent<HTMLElement>): TrackedPoint => {
    // Measure from the centre so a rotated control (whose bounding box is
    // turned) still gets coordinates in its own frame.
    const el = e.currentTarget,
      r = el.getBoundingClientRect(),
      width = el.offsetWidth,
      height = el.offsetHeight,
      off = toLocal(
        {
          x: e.clientX - (r.left + r.width / 2),
          y: e.clientY - (r.top + r.height / 2),
        },
        rotation,
      );
    return {
      x: width / 2 + off.x,
      y: height / 2 + off.y,
      width,
      height,
      time: performance.now(),
    };
  };
  const end = (e: ReactPointerEvent<HTMLElement>, cancelled: boolean) => {
    const t = track.current;
    if (!t || t.id !== e.pointerId) return;
    track.current = null;
    setActive(false);
    const p = cancelled ? t.last : local(e);
    cb.current.onEnd?.(p, t.start, cancelled);
  };
  const handlers = {
    onPointerDown(e: ReactPointerEvent<HTMLElement>) {
      e.preventDefault();
      if (track.current) return;
      e.currentTarget.setPointerCapture(e.pointerId);
      const p = local(e);
      track.current = { id: e.pointerId, start: p, last: p };
      setActive(true);
      cb.current.onStart?.(p);
    },
    onPointerMove(e: ReactPointerEvent<HTMLElement>) {
      const t = track.current;
      if (!t || t.id !== e.pointerId) return;
      t.last = local(e);
      cb.current.onMove?.(t.last, t.start);
    },
    onPointerUp: (e: ReactPointerEvent<HTMLElement>) => end(e, false),
    onPointerCancel: (e: ReactPointerEvent<HTMLElement>) => end(e, true),
    onLostPointerCapture: (e: ReactPointerEvent<HTMLElement>) => end(e, true),
    onContextMenu: (e: { preventDefault(): void }) => e.preventDefault(),
  };
  return { active, handlers };
}
