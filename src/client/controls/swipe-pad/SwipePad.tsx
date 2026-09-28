'use client';
import { useState } from 'react';
import { ChevronUp } from 'lucide-react';
import { ControlFrame } from '../kit/ControlFrame.tsx';
import { useTrackedPointer } from '../kit/useTrackedPointer.ts';
import type { SwipeDirection } from '../api.ts';
import type { ControlViewProps } from '../types.ts';
import type { SwipePadProps } from './definition.ts';
import { classifySwipe } from './logic.ts';

const TRAIL = 14;
const ROTATION: Record<SwipeDirection, number> = {
  up: 0,
  right: 90,
  down: 180,
  left: 270,
};

export function SwipePad({
  widget,
  port,
  props,
}: ControlViewProps<SwipePadProps>) {
  const [trail, setTrail] = useState<{ x: number; y: number }[]>([]),
    [flash, setFlash] = useState<{ dir: SwipeDirection; n: number } | null>(
      null,
    );
  const { active, handlers } = useTrackedPointer({
    onStart(p) {
      setTrail([{ x: p.x, y: p.y }]);
    },
    onMove(p) {
      setTrail((t) => [...t.slice(-(TRAIL - 1)), { x: p.x, y: p.y }]);
    },
    onEnd(p, start, cancelled) {
      setTrail([]);
      if (cancelled) return;
      const swipe = classifySwipe(
        p.x - start.x,
        p.y - start.y,
        p.time - start.time,
        p,
        props.minDistance ?? 0.12,
      );
      if (!swipe) return;
      port.value(swipe);
      port.press(true);
      port.press(false);
      port.haptic(14);
      setFlash((f) => ({ dir: swipe.dir, n: (f?.n ?? 0) + 1 }));
    },
  });
  return (
    <ControlFrame
      widget={widget}
      active={active}
      hint={props.hint}
      bare={props.bare}
      shape={props.shape}
      appearance={props.appearance}
      color={props.color}
      {...handlers}
    >
      <span className="ctl-swipe-pad__dots" />
      {flash && (
        <span
          key={flash.n}
          className="ctl-swipe-pad__flash"
          style={{ rotate: `${ROTATION[flash.dir]}deg` }}
        >
          <ChevronUp strokeWidth={2.5} />
        </span>
      )}
      <svg className="ctl-swipe-pad__trail" aria-hidden>
        {trail.slice(1).map((pt, i) => (
          <line
            key={i}
            x1={trail[i].x}
            y1={trail[i].y}
            x2={pt.x}
            y2={pt.y}
            style={{ opacity: (i + 1) / trail.length }}
            strokeWidth={2 + ((i + 1) / trail.length) * 7}
          />
        ))}
      </svg>
    </ControlFrame>
  );
}
