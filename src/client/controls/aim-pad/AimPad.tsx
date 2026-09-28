'use client';
import { useEffect, useState } from 'react';
import { ControlFrame } from '../kit/ControlFrame.tsx';
import { useTrackedPointer } from '../kit/useTrackedPointer.ts';
import type { Vector } from '../api.ts';
import type { ControlViewProps } from '../types.ts';
import { AimPadInput } from './logic.ts';

export function AimPad({ widget, port, props }: ControlViewProps) {
  const [point, setPoint] = useState<Vector>({ x: 0, y: 0 });
  const [pad] = useState(
    () =>
      new AimPadInput((value) => {
        setPoint({ ...value });
        port.value(value);
      }),
  );
  // Designer rotation can replace a port without remounting the control.
  // Each old component keeps its own pad and cannot adopt a replacement's port.
  useEffect(() => {
    pad.setEmitter((value) => {
      setPoint({ ...value });
      port.value(value);
    });
  }, [pad, port]);
  const { active, handlers } = useTrackedPointer({
    onStart(point) {
      port.haptic(6);
      pad.move(point);
    },
    onMove: (point) => pad.move(point),
    onEnd: () => pad.end(),
  });
  return (
    <ControlFrame
      widget={widget}
      active={active}
      hint={props.hint}
      bare={props.bare}
      tabIndex={0}
      role="application"
      aria-roledescription="aim pad"
      aria-label={`${widget.label || 'Aim'}: use arrow keys to move, Home to center`}
      aria-keyshortcuts="ArrowLeft ArrowRight ArrowUp ArrowDown Home"
      onKeyDown={(event) => {
        if (pad.key(event.key)) event.preventDefault();
      }}
      {...handlers}
    >
      <span className="ctl-aim-pad__grid" aria-hidden />
      <span
        className="ctl-aim-pad__target"
        aria-hidden
        style={{
          left: `${(point.x + 1) * 50}%`,
          top: `${(point.y + 1) * 50}%`,
        }}
      />
    </ControlFrame>
  );
}
