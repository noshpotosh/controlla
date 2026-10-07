'use client';
import {
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { Hammer } from 'lucide-react';
import type { ControlPort } from '../api.ts';
import type { MotionControlPort } from '../motion/contracts.ts';
/**
 * The swing-to-whack input: hold to freeze your aim, then swing. Each recognised
 * swing slams the hammer, so players without vibration (every iPhone) still see
 * that it counted.
 */
export function ChopTile({
  label,
  port,
  motion,
}: {
  label: string;
  port: ControlPort;
  motion?: MotionControlPort;
}) {
  const [hits, setHits] = useState(0),
    [held, setHeld] = useState(false);
  const pointer = useRef<number | null>(null);
  const motionRef = useRef(motion);
  useEffect(() => {
    motionRef.current = motion;
  }, [motion]);
  useEffect(() => {
    let seen = motionRef.current?.getSnapshot().activations ?? 0,
      raf = 0;
    const poll = () => {
      const count = motionRef.current?.getSnapshot().activations ?? 0;
      if (count !== seen) {
        seen = count;
        setHits((n) => n + 1);
      }
      raf = requestAnimationFrame(poll);
    };
    raf = requestAnimationFrame(poll);
    return () => cancelAnimationFrame(raf);
  }, []);
  // Never leave the aim frozen if the tile goes away mid-hold.
  useEffect(
    () => () => {
      if (pointer.current !== null)
        motionRef.current?.command({ type: 'cancel' });
    },
    [],
  );
  const release = (e: ReactPointerEvent<HTMLElement>) => {
    if (pointer.current !== e.pointerId) return;
    pointer.current = null;
    setHeld(false);
    motion?.command(
      e.type === 'pointerup'
        ? { type: 'press', down: false }
        : { type: 'cancel' },
    );
  };
  return (
    <button
      type="button"
      className={held ? 'widget chop-tile is-held' : 'widget chop-tile'}
      aria-label={`Hold, then swing to ${label}`}
      aria-pressed={held}
      onContextMenu={(e) => e.preventDefault()}
      onPointerDown={(e) => {
        if (pointer.current !== null) return;
        pointer.current = e.pointerId;
        e.currentTarget.setPointerCapture?.(e.pointerId);
        setHeld(true);
        motion?.command({ type: 'press', down: true });
        port.haptic(8);
      }}
      onPointerUp={release}
      onPointerCancel={release}
      onLostPointerCapture={release}
    >
      <span
        key={hits}
        className={hits ? 'chop-tile__hammer is-hit' : 'chop-tile__hammer'}
      >
        <Hammer strokeWidth={1.75} />
      </span>
      <span className="chop-tile__title">
        {held ? `Swing to ${label}!` : 'Hold, then swing'}
      </span>
      <small>
        {held
          ? 'Your aim is locked while you hold'
          : 'Point at a mole, hold here, then chop like a hammer'}
      </small>
    </button>
  );
}

export function PointerPreview({
  previewPoint,
}: {
  previewPoint: () => Readonly<{ x: number; y: number }>;
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
