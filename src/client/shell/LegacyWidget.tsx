'use client';
// Legacy widgets that have not been ported to the controls library
// (src/client/controls) yet. ControllerSurface places each one in its layout cell;
// port a type by adding it to the library and deleting its branch here.
import {
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { Hammer } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import type { Widget, ControlPort } from '../controls/api.ts';
import type { PhoneActions } from './ports.ts';
const clamp = (x: number) => Math.max(-1, Math.min(1, x));
export function LegacyWidget({
  widget: w,
  port,
  previewPoint,
  chopCount,
  sensorHz,
}: {
  widget: Widget;
  port: ControlPort;
  previewPoint: PhoneActions['previewPoint'];
  chopCount?: PhoneActions['chopCount'];
  sensorHz: number;
}) {
  const [progress, setProgress] = useState(0),
    [text, setText] = useState(''),
    [angle, setAngle] = useState(0);
  const canvas = useRef<HTMLCanvasElement>(null),
    dial = useRef({ last: 0, angle: 0 }),
    active = useRef<number | null>(null);
  const point = (e: ReactPointerEvent<HTMLElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return {
      x: clamp(((e.clientX - r.left) / r.width) * 2 - 1),
      y: clamp(((e.clientY - r.top) / r.height) * 2 - 1),
    };
  };
  const move = (e: ReactPointerEvent<HTMLElement>) => {
    if (active.current !== e.pointerId) return;
    const p = point(e);
    if (w.type === 'dial') {
      const a = Math.atan2(p.y, p.x),
        delta = Math.atan2(
          Math.sin(a - dial.current.last),
          Math.cos(a - dial.current.last),
        );
      dial.current.angle += delta;
      setAngle(dial.current.angle);
      dial.current.last = a;
      port.value(dial.current.angle);
    }
    if (w.type === 'draw-canvas') {
      const c = canvas.current,
        ctx = c?.getContext('2d');
      if (c && ctx) {
        ctx.fillStyle = '#d5ff70';
        ctx.beginPath();
        ctx.arc(
          ((p.x + 1) * c.width) / 2,
          ((p.y + 1) * c.height) / 2,
          3 + e.pressure * 5,
          0,
          Math.PI * 2,
        );
        ctx.fill();
      }
      port.value({
        x: (p.x + 1) / 2,
        y: (p.y + 1) / 2,
        pressure: e.pressure,
        phase: 'move',
      });
    }
  };
  const down = (e: ReactPointerEvent<HTMLElement>) => {
    e.preventDefault();
    if (active.current !== null) return;
    active.current = e.pointerId;
    e.currentTarget.setPointerCapture(e.pointerId);
    if (w.type === 'dial') {
      const p = point(e);
      dial.current.last = Math.atan2(p.y, p.x);
    }
    move(e);
  };
  const up = (e: ReactPointerEvent<HTMLElement>) => {
    if (active.current === e.pointerId) active.current = null;
  };
  if (w.type === 'slider')
    return (
      <div className="widget">
        <label id={w.id}>{w.label}</label>
        <div style={{ width: '80%' }}>
          <Slider
            aria-labelledby={w.id}
            min={0}
            max={1}
            step={0.01}
            value={[progress]}
            onValueChange={(v) => {
              const p = Array.isArray(v) ? v[0] : v;
              setProgress(p);
              port.value(p);
            }}
          />
        </div>
      </div>
    );
  if (w.type === 'text')
    return (
      <form
        className="widget"
        onSubmit={(e) => {
          e.preventDefault();
          port.value(text.slice(0, 120));
        }}
      >
        <label htmlFor={w.id}>{w.label}</label>
        <input
          id={w.id}
          maxLength={120}
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <Button type="submit">Send</Button>
      </form>
    );
  if (w.type === 'chop')
    return <ChopTile label={w.label} port={port} chopCount={chopCount} />;
  if (w.type === 'pointer' || w.type === 'tilt' || w.type === 'shake')
    return (
      <div className="widget">
        <span className="widget-glyph">
          {w.type === 'pointer' ? '⊕' : w.type === 'tilt' ? '↔' : '↯'}
        </span>
        {w.type === 'pointer' ? (
          <PointerPreview previewPoint={previewPoint} />
        ) : null}
        {w.type === 'pointer'
          ? 'Swivel left/right · Tip the top edge up/down'
          : w.type === 'tilt'
            ? 'Tilt to steer'
            : 'Shake your phone'}
        <small>
          {w.type === 'pointer'
            ? 'Push past an edge or tap Recenter to re-center'
            : `${Math.round(sensorHz)} motion samples / sec`}
        </small>
      </div>
    );
  return (
    <fieldset
      className="widget"
      aria-label={w.label}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
      onLostPointerCapture={up}
    >
      {w.type === 'draw-canvas' ? (
        <canvas
          ref={canvas}
          width={500}
          height={300}
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
          }}
        />
      ) : null}
      <span>{w.label}</span>
      {w.type === 'dial' ? (
        <span style={{ transform: `rotate(${angle}rad)` }}>↑</span>
      ) : null}
    </fieldset>
  );
}

/**
 * The swing-to-whack input. Each recognised swing slams the hammer, so players
 * without vibration (every iPhone) still see that it counted. Tapping also whacks.
 */
function ChopTile({
  label,
  port,
  chopCount,
}: {
  label: string;
  port: ControlPort;
  chopCount?: PhoneActions['chopCount'];
}) {
  const [hits, setHits] = useState(0);
  useEffect(() => {
    if (!chopCount) return;
    let seen = chopCount(),
      raf = 0;
    const poll = () => {
      const count = chopCount();
      if (count !== seen) {
        seen = count;
        setHits((n) => n + 1);
      }
      raf = requestAnimationFrame(poll);
    };
    raf = requestAnimationFrame(poll);
    return () => cancelAnimationFrame(raf);
  }, [chopCount]);
  return (
    <button
      type="button"
      className="widget chop-tile"
      aria-label={label}
      onPointerDown={() => {
        port.value(1);
        port.haptic(12);
        setHits((n) => n + 1);
      }}
    >
      <span
        key={hits}
        className={hits ? 'chop-tile__hammer is-hit' : 'chop-tile__hammer'}
      >
        <Hammer strokeWidth={1.75} />
      </span>
      <span className="chop-tile__title">Swing down to {label}!</span>
      <small>Point at the screen, then chop like a hammer · or tap here</small>
    </button>
  );
}

function PointerPreview({
  previewPoint,
}: {
  previewPoint: PhoneActions['previewPoint'];
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current!,
      ctx = canvas.getContext('2d')!;
    let raf = 0;
    const render = () => {
      const p = previewPoint();
      ctx.fillStyle = '#181c35';
      ctx.fillRect(0, 0, 280, 158);
      ctx.strokeStyle = '#d5ff70';
      ctx.lineWidth = 2;
      const x = Math.max(0, Math.min(280, p.x * 280)),
        y = Math.max(0, Math.min(158, p.y * 158));
      ctx.beginPath();
      ctx.arc(x, y, 9, 0, Math.PI * 2);
      ctx.moveTo(x - 14, y);
      ctx.lineTo(x + 14, y);
      ctx.moveTo(x, y - 14);
      ctx.lineTo(x, y + 14);
      ctx.stroke();
      raf = requestAnimationFrame(render);
    };
    raf = requestAnimationFrame(render);
    return () => cancelAnimationFrame(raf);
  }, [previewPoint]);
  return (
    <canvas
      ref={ref}
      width={280}
      height={158}
      style={{ width: '70%', maxHeight: '45%', objectFit: 'contain' }}
      aria-label="Local pointer preview"
    />
  );
}
