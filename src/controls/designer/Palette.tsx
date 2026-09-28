'use client';
// Left rail: touch controls to place (drag onto the phone, or click to drop
// one in the first free spot), and the motion inputs this layout switches on.
import type { WidgetType } from '../../core/types.ts';
import { definitions } from '../registry.ts';
import { MOTION, type MotionInput } from '../layout/schema.ts';
import { DRAG_TYPE } from './Canvas.tsx';

const MOTION_HELP: Record<MotionInput, string> = {
  pointer: 'Aim by pointing the phone',
  tilt: 'Steer by tilting the phone',
  shake: 'A shake counts as a press',
};

export function Palette({
  motion,
  onAdd,
  onMotion,
}: {
  motion: Record<MotionInput, boolean>;
  onAdd: (type: WidgetType) => void;
  onMotion: (input: MotionInput, on: boolean) => void;
}) {
  return (
    <aside className="dz-palette">
      <section>
        <h2>Touch controls</h2>
        {definitions.map((d) => (
          <button
            key={d.type}
            type="button"
            className="dz-tile"
            draggable
            title={d.description}
            onDragStart={(e) => {
              e.dataTransfer.setData(DRAG_TYPE, d.type);
              e.dataTransfer.effectAllowed = 'copy';
            }}
            onClick={() => onAdd(d.type)}
          >
            <strong>{d.displayName}</strong>
            <small>{d.kind}</small>
          </button>
        ))}
      </section>
      <section className="dz-motion">
        <h2>Motion</h2>
        {MOTION.map((m) => (
          <label key={m} className="dz-check">
            <input
              type="checkbox"
              checked={motion[m]}
              onChange={(e) => onMotion(m, e.target.checked)}
            />
            <strong>{m}</strong>
            <small>{MOTION_HELP[m]}</small>
          </label>
        ))}
        <p className="dz-muted dz-small">
          Motion inputs have no on-screen control. A touch control with the same
          name as the game’s input is its fallback when motion is off.
        </p>
      </section>
    </aside>
  );
}
