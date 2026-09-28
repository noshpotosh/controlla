'use client';
import { useRef, useState } from 'react';
import { ControlFrame } from '../kit/ControlFrame.tsx';
import {
  useTrackedPointer,
  type TrackedPoint,
} from '../kit/useTrackedPointer.ts';
import type { ControlViewProps, StickOutput, Vector } from '../types.ts';
import type { StickProps } from './definition.ts';
import { clampOrigin, stickVector } from './logic.ts';

/** Knob travel as a fraction of the frame's shorter side. */
const TRAVEL = 0.3;

export function Stick({ widget, port, props }: ControlViewProps<StickProps>) {
  const [view, setView] = useState<{ origin: Vector | null; knob: Vector }>({
      origin: null,
      knob: { x: 0, y: 0 },
    }),
    origin = useRef<Vector>({ x: 0, y: 0 }),
    last = useRef<StickOutput>({ x: 0, y: 0 });
  const radius = (p: TrackedPoint) => Math.min(p.width, p.height) * TRAVEL;
  const emit = (out: StickOutput) => {
    if (out.x === last.current.x && out.y === last.current.y) return;
    last.current = out;
    port.value(out);
  };
  const move = (p: TrackedPoint) => {
    const { output, knob } = stickVector(
      origin.current,
      p,
      radius(p),
      props.deadzone ?? 0.12,
    );
    setView({ origin: origin.current, knob });
    emit(output);
  };
  const { active, handlers } = useTrackedPointer({
    onStart(p) {
      origin.current =
        props.floating === false
          ? { x: p.width / 2, y: p.height / 2 }
          : clampOrigin(p, p, radius(p));
      port.haptic(6);
      move(p);
    },
    onMove: move,
    onEnd() {
      setView({ origin: null, knob: { x: 0, y: 0 } });
      emit({ x: 0, y: 0 });
    },
  });
  // Idle, the stick rests in the centre; while held it sits under the thumb.
  const base = view.origin
    ? { left: `${view.origin.x}px`, top: `${view.origin.y}px` }
    : { left: '50%', top: '50%' };
  return (
    <ControlFrame
      widget={widget}
      active={active}
      hint={props.hint}
      bare={props.bare}
      {...handlers}
    >
      <span className="ctl-stick__base" style={base}>
        <span
          className="ctl-stick__knob"
          style={{
            transform: `translate(calc(${view.knob.x} * var(--ctl-stick-travel)), calc(${view.knob.y} * var(--ctl-stick-travel)))`,
          }}
        />
      </span>
    </ControlFrame>
  );
}
