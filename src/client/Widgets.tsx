'use client';
import {
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import type { Widget } from '../core/types.ts';
import type { Runtime } from './runtime.ts';
const clamp = (x: number) => Math.max(-1, Math.min(1, x));
export function WidgetControl({
  widget: w,
  runtime,
}: {
  widget: Widget;
  runtime: Runtime;
}) {
  const [value, setValue] = useState({ x: 0, y: 0 }),
    [progress, setProgress] = useState(0),
    [text, setText] = useState(''),
    [angle, setAngle] = useState(0);
  const start = useRef({ x: 0, y: 0, time: 0 }),
    holding = useRef<ReturnType<typeof setInterval> | null>(null),
    canvas = useRef<HTMLCanvasElement>(null),
    dial = useRef({ last: 0, angle: 0 }),
    active = useRef<number | null>(null);
  const style = {
    left: `${w.rect[0] * 100}%`,
    top: `${w.rect[1] * 100}%`,
    width: `${w.rect[2] * 100}%`,
    height: `${w.rect[3] * 100}%`,
  };
  const clearHold = () => {
    if (holding.current) clearInterval(holding.current);
    holding.current = null;
  };
  useEffect(
    () => () => {
      clearHold();
      runtime.press(w.action, false);
    },
    [runtime, w.action],
  );
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
    setValue(p);
    if (w.type === 'stick') {
      const mag = Math.hypot(p.x, p.y),
        deadzone = w.deadzone ?? 0.08;
      runtime.action(w.action, mag < deadzone ? { x: 0, y: 0 } : p);
    }
    if (w.type === 'dial') {
      const a = Math.atan2(p.y, p.x),
        delta = Math.atan2(
          Math.sin(a - dial.current.last),
          Math.cos(a - dial.current.last),
        );
      dial.current.angle += delta;
      setAngle(dial.current.angle);
      dial.current.last = a;
      runtime.action(w.action, dial.current.angle);
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
      runtime.action(w.action, {
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
    start.current = { x: e.clientX, y: e.clientY, time: performance.now() };
    if (w.type === 'dial') {
      const p = point(e);
      dial.current.last = Math.atan2(p.y, p.x);
    }
    if (w.type === 'button') runtime.press(w.action, true);
    if (w.type === 'hold-meter') {
      clearHold();
      holding.current = setInterval(() => {
        const p = Math.min(
          1,
          (performance.now() - start.current.time) / (w.holdMs ?? 800),
        );
        setProgress(p);
        runtime.action(w.action, p);
        if (p >= 1) {
          clearHold();
        }
      }, 16);
    }
    move(e);
  };
  const up = (e: ReactPointerEvent<HTMLElement>, cancelled = false) => {
    if (active.current !== e.pointerId) return;
    active.current = null;
    clearHold();
    setProgress(0);
    if (w.type === 'button') runtime.press(w.action, false);
    if (w.type === 'stick') {
      setValue({ x: 0, y: 0 });
      runtime.action(w.action, { x: 0, y: 0 });
    }
    if (w.type === 'swipe-pad' && !cancelled) {
      const dt = Math.max(1, performance.now() - start.current.time),
        rect = e.currentTarget.getBoundingClientRect(),
        dx = (e.clientX - start.current.x) / rect.width,
        dy = (e.clientY - start.current.y) / rect.height;
      if (Math.hypot(dx, dy) > 0.08)
        runtime.action(w.action, {
          x: dx,
          y: dy,
          distance: Math.hypot(dx, dy),
          velocity: (Math.hypot(dx, dy) * 1000) / dt,
        });
    }
  };
  if (w.type === 'button')
    return (
      <Button
        className="widget widget-button"
        style={style}
        onPointerDown={down}
        onPointerUp={(e) => up(e)}
        onPointerCancel={(e) => up(e, true)}
        onLostPointerCapture={(e) => up(e, true)}
        onKeyDown={(e) => {
          if (e.key === ' ' || e.key === 'Enter') {
            e.preventDefault();
            runtime.press(w.action, true);
          }
        }}
        onKeyUp={() => runtime.press(w.action, false)}
      >
        {w.label}
        <small>Press to {w.action}</small>
      </Button>
    );
  if (w.type === 'slider')
    return (
      <div className="widget" style={style}>
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
              runtime.action(w.action, p);
            }}
          />
        </div>
      </div>
    );
  if (w.type === 'text')
    return (
      <form
        className="widget"
        style={style}
        onSubmit={(e) => {
          e.preventDefault();
          runtime.action(w.action, text.slice(0, 120));
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
  if (w.type === 'dpad')
    return (
      <div className="widget" style={style}>
        <span>{w.label}</span>
        <div className="dpad">
          {[
            { label: '↑', x: 0, y: -1 },
            { label: '←', x: -1, y: 0 },
            { label: '↓', x: 0, y: 1 },
            { label: '→', x: 1, y: 0 },
          ].map((p) => (
            <Button
              key={p.label}
              aria-label={`${w.label} ${p.label}`}
              onPointerDown={() => runtime.action(w.action, p)}
              onPointerUp={() => runtime.action(w.action, { x: 0, y: 0 })}
              onPointerCancel={() => runtime.action(w.action, { x: 0, y: 0 })}
            >
              {p.label}
            </Button>
          ))}
        </div>
      </div>
    );
  if (w.type === 'pointer' || w.type === 'tilt' || w.type === 'shake')
    return (
      <div className="widget" style={style}>
        <span style={{ fontSize: 56, color: 'var(--primary)' }}>
          {w.type === 'pointer' ? '⊕' : w.type === 'tilt' ? '↔' : '↯'}
        </span>
        {w.type === 'pointer' ? <PointerPreview runtime={runtime} /> : null}
        {w.type === 'pointer'
          ? 'Point the top of your phone at the screen'
          : w.type === 'tilt'
            ? 'Tilt to steer'
            : 'Shake your phone'}
        <small>
          {w.type === 'pointer'
            ? 'Push past an edge or tap Recenter to re-center'
            : `${Math.round(runtime.view.sensorHz)} motion samples / sec`}
        </small>
      </div>
    );
  return (
    <fieldset
      className="widget"
      style={style}
      aria-label={w.label}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={(e) => up(e)}
      onPointerCancel={(e) => up(e, true)}
      onLostPointerCapture={(e) => up(e, true)}
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
      <span>{w.type === 'swipe-pad' ? '↑ SWIPE TO BOOST' : w.label}</span>
      {w.type === 'stick' ? (
        <span
          className="stick-knob"
          style={{
            transform: `translate(${value.x * 45}px,${value.y * 45}px)`,
          }}
        />
      ) : null}
      {w.type === 'hold-meter' ? <progress max={1} value={progress} /> : null}
      {w.type === 'dial' ? (
        <span style={{ transform: `rotate(${angle}rad)` }}>↑</span>
      ) : null}
      <small>
        {w.type === 'stick'
          ? 'Drag to control'
          : w.type === 'swipe-pad'
            ? 'A quick swipe gives you a burst of speed'
            : ''}
      </small>
    </fieldset>
  );
}

function PointerPreview({ runtime }: { runtime: Runtime }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current!,
      ctx = canvas.getContext('2d')!;
    let raf = 0;
    const render = () => {
      const p = runtime.previewPoint();
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
  }, [runtime]);
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
