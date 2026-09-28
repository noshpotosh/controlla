'use client';
import { useRef, useState } from 'react';
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
} from 'lucide-react';
import { ControlFrame } from '../kit/ControlFrame.tsx';
import {
  useTrackedPointer,
  type TrackedPoint,
} from '../kit/useTrackedPointer.ts';
import type { DpadOutput } from '../api.ts';
import type { ControlViewProps } from '../types.ts';
import type { DpadProps } from './definition.ts';
import { dpadDirection, sameDirection } from './logic.ts';

const ARMS = [
  { key: 'up', x: 0, y: -1, Icon: ChevronUp },
  { key: 'right', x: 1, y: 0, Icon: ChevronRight },
  { key: 'down', x: 0, y: 1, Icon: ChevronDown },
  { key: 'left', x: -1, y: 0, Icon: ChevronLeft },
] as const;

export function Dpad({ widget, port, props }: ControlViewProps<DpadProps>) {
  const [dir, setDir] = useState<DpadOutput>({ x: 0, y: 0 }),
    last = useRef<DpadOutput>({ x: 0, y: 0 });
  const emit = (next: DpadOutput) => {
    if (sameDirection(next, last.current)) return;
    last.current = next;
    setDir(next);
    port.value(next);
    if (next.x || next.y) port.haptic(8);
  };
  const aim = (p: TrackedPoint) => {
    // The cross is a square centred in the frame; measure from its centre.
    const r = Math.min(p.width, p.height) / 2;
    emit(
      dpadDirection(
        { x: (p.x - p.width / 2) / r, y: (p.y - p.height / 2) / r },
        props.directions ?? 4,
      ),
    );
  };
  const { active, handlers } = useTrackedPointer({
    onStart: aim,
    onMove: aim,
    onEnd: () => emit({ x: 0, y: 0 }),
  });
  return (
    <ControlFrame
      widget={widget}
      active={active}
      hint={props.hint}
      bare={props.bare}
      {...handlers}
    >
      <span className="ctl-dpad__cross">
        {ARMS.map(({ key, x, y, Icon }) => (
          <span
            key={key}
            className={`ctl-dpad__arm ctl-dpad__arm--${key}`}
            data-lit={(x && x === dir.x) || (y && y === dir.y) || undefined}
          >
            <Icon strokeWidth={3} />
          </span>
        ))}
        <span className="ctl-dpad__hub" />
      </span>
    </ControlFrame>
  );
}
