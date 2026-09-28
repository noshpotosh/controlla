'use client';
import { useEffect, useRef, useState } from 'react';
import { ControlFrame } from '../kit/ControlFrame.tsx';
import { useTrackedPointer } from '../kit/useTrackedPointer.ts';
import type { ControlViewProps } from '../types.ts';
import type { HoldMeterProps } from './definition.ts';
import { chargeAt } from './logic.ts';

// Ring geometry in SVG user units (viewBox 0 0 100 100).
const R = 44,
  CIRCUMFERENCE = 2 * Math.PI * R;

export function HoldMeter({
  widget,
  port,
  props,
}: ControlViewProps<HoldMeterProps>) {
  const [charge, setCharge] = useState(0),
    hold = useRef<{ since: number; charge: number } | null>(null),
    portRef = useRef(port);
  const holdMs = props.holdMs ?? 1000;
  const { active, handlers } = useTrackedPointer({
    onStart(p) {
      hold.current = { since: p.time, charge: 0 };
      port.haptic(8);
    },
    onEnd(_p, _start, cancelled) {
      const final = hold.current?.charge ?? 0;
      hold.current = null;
      setCharge(0);
      if (cancelled) {
        port.value({ charge: 0, released: false });
        return;
      }
      port.value({ charge: final, released: true });
      port.press(true);
      port.press(false);
    },
  });
  useEffect(() => {
    portRef.current = port;
  });
  // Charge on animation frames while held.
  useEffect(() => {
    if (!active) return;
    let raf = 0;
    function tick() {
      const h = hold.current;
      if (!h) return;
      const c = chargeAt(performance.now() - h.since, holdMs);
      if (c !== h.charge) {
        h.charge = c;
        if (c === 1) portRef.current.haptic(24);
        setCharge(c);
        portRef.current.value({ charge: c, released: false });
      }
      if (c < 1) raf = requestAnimationFrame(tick);
    }
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [active, holdMs]);
  return (
    <ControlFrame
      widget={widget}
      active={active}
      hint={props.hint}
      bare={props.bare}
      data-full={charge === 1 || undefined}
      {...handlers}
    >
      <span className="ctl-hold-meter__dial">
        <svg viewBox="0 0 100 100" aria-hidden>
          <circle className="ctl-hold-meter__track" cx="50" cy="50" r={R} />
          <circle
            className="ctl-hold-meter__fill"
            cx="50"
            cy="50"
            r={R}
            strokeDasharray={CIRCUMFERENCE}
            strokeDashoffset={CIRCUMFERENCE * (1 - charge)}
          />
        </svg>
        <span className="ctl-hold-meter__cap">
          <span className="ctl-hold-meter__value">
            {Math.round(charge * 100)}
          </span>
        </span>
      </span>
    </ControlFrame>
  );
}
