'use client';
// /?role=designer — the controller layout library and editor.
// /?role=designer&layout=<id> opens one layout. Layouts save to
// src/layouts/<id>.json on the dev server; "Test on phone" follows edits live.
import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Copy, Play, Smartphone, Undo2, X } from 'lucide-react';
import { COLORS, type WidgetType } from '../../core/types.ts';
import { layouts } from '../../layouts/index.ts';
import { useReadings } from '../gallery/readings.tsx';
import {
  MENU_CORNERS,
  MOTION,
  type ControllerLayout,
  type GridRect,
  type LayoutItem,
  type MenuCorner,
  type Orientation,
} from '../layout/schema.ts';
import { validateLayout } from '../layout/validate.ts';
import { canSave, saveLayout } from './api.ts';
import { Canvas } from './Canvas.tsx';
import { Inspector } from './Inspector.tsx';
import { Library } from './Library.tsx';
import {
  addItem,
  clampRect,
  removeItem,
  reorient,
  rotateItem,
  updateItem,
} from './model.ts';
import { Palette } from './Palette.tsx';
import { PhoneLink } from './PhoneLink.tsx';

export function Designer({ layoutId }: { layoutId: string | null }) {
  const [open, setOpen] = useState<ControllerLayout | null>(
    () => (layoutId && layouts[layoutId]) || null,
  );
  const go = (layout: ControllerLayout | null) => {
    setOpen(layout);
    const url = new URL(location.href);
    if (layout) url.searchParams.set('layout', layout.id);
    else url.searchParams.delete('layout');
    history.pushState(null, '', url);
  };
  useEffect(() => {
    const back = () => {
      const id = new URLSearchParams(location.search).get('layout');
      setOpen((id && layouts[id]) || null);
    };
    window.addEventListener('popstate', back);
    return () => window.removeEventListener('popstate', back);
  }, []);
  return open ? (
    <Editor key={open.id} initial={open} onBack={() => go(null)} />
  ) : (
    <Library open={go} />
  );
}

const ASPECTS = [
  { name: 'Tall (19.5:9)', value: 19.5 / 9 },
  { name: 'Classic (16:9)', value: 16 / 9 },
];

type SaveState =
  | { kind: 'saved' }
  | { kind: 'pending' }
  | { kind: 'invalid' }
  | { kind: 'offline' }
  | { kind: 'error'; message: string };

function Editor({
  initial,
  onBack,
}: {
  initial: ControllerLayout;
  onBack: () => void;
}) {
  const [layout, setLayout] = useState(initial),
    [history, setHistory] = useState<ControllerLayout[]>([]),
    [selected, setSelected] = useState<number | null>(null),
    [play, setPlay] = useState(false),
    [aspect, setAspect] = useState(ASPECTS[0].value),
    [color, setColor] = useState(0),
    [phone, setPhone] = useState(false),
    [savedJson, setSavedJson] = useState(() => JSON.stringify(initial)),
    [saveError, setSaveError] = useState(''),
    readings = useReadings();
  const issues = useMemo(() => validateLayout(layout), [layout]),
    invalid = new Set(
      issues.flatMap((i) => (i.item === undefined ? [] : [i.item])),
    );

  /** Apply an edit as one undoable step. */
  const commit = (next: ControllerLayout | null) => {
    if (!next) return;
    setHistory((h) => [...h.slice(-49), layout]);
    setLayout(next);
  };
  const undo = () => {
    const previous = history.at(-1);
    if (!previous) return;
    setHistory((h) => h.slice(0, -1));
    setLayout(previous);
    setSelected(null);
  };
  const add = (type: WidgetType, at?: { x: number; y: number }) => {
    const result = addItem(layout, type, at);
    if (!result) return;
    commit(result.layout);
    setSelected(result.index);
  };

  // Autosave valid layouts to the repo (dev server only).
  useEffect(() => {
    const json = JSON.stringify(layout);
    if (!canSave || json === savedJson || issues.length) return;
    const timer = setTimeout(async () => {
      try {
        await saveLayout(layout);
        setSavedJson(json);
        setSaveError('');
      } catch (e) {
        setSaveError(e instanceof Error ? e.message : String(e));
      }
    }, 400);
    return () => clearTimeout(timer);
  }, [layout, issues.length, savedJson]);
  const dirty = JSON.stringify(layout) !== savedJson,
    status: SaveState = !canSave
      ? { kind: 'offline' }
      : !dirty
        ? { kind: 'saved' }
        : issues.length
          ? { kind: 'invalid' }
          : saveError
            ? { kind: 'error', message: saveError }
            : { kind: 'pending' };

  // Keyboard: arrows move (shift resizes), R rotates, Delete removes, ⌘Z undoes.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('input, select, textarea')) return;
      if ((e.metaKey || e.ctrlKey) && e.key === 'z') {
        e.preventDefault();
        undo();
        return;
      }
      if (selected === null || play) return;
      const item = layout.items[selected];
      if (!item) return;
      const step: Record<string, [number, number]> = {
        ArrowLeft: [-1, 0],
        ArrowRight: [1, 0],
        ArrowUp: [0, -1],
        ArrowDown: [0, 1],
      };
      if (step[e.key]) {
        e.preventDefault();
        const [dx, dy] = step[e.key],
          r = item.rect,
          rect: GridRect = e.shiftKey
            ? { ...r, w: r.w + dx, h: r.h + dy }
            : { ...r, x: r.x + dx, y: r.y + dy };
        commit(
          updateItem(layout, selected, {
            rect: clampRect(rect, layout.grid),
          }),
        );
      } else if (e.key === 'r' || e.key === 'R')
        commit(rotateItem(layout, selected));
      else if (e.key === 'Delete' || e.key === 'Backspace') {
        commit(removeItem(layout, selected));
        setSelected(null);
      } else if (e.key === 'Escape') setSelected(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const motionOn = MOTION.filter((m) => layout.motion[m]);
  return (
    <main className="dz ctl-scope">
      <header className="dz-bar">
        <button type="button" onClick={onBack} title="All layouts">
          <ArrowLeft /> Layouts
        </button>
        <input
          className="dz-name"
          aria-label="Layout name"
          value={layout.name}
          maxLength={60}
          onChange={(e) => setLayout((l) => ({ ...l, name: e.target.value }))}
        />
        <code className="dz-id" title="File name; fixed once created">
          {layout.id}.json
        </code>
        <div className="dz-seg">
          {(['portrait', 'landscape'] as Orientation[]).map((o) => (
            <button
              key={o}
              type="button"
              aria-pressed={layout.orientation === o}
              onClick={() => commit(reorient(layout, o))}
            >
              {o}
            </button>
          ))}
        </div>
        <select
          aria-label="Phone shape"
          value={aspect}
          onChange={(e) => setAspect(Number(e.target.value))}
        >
          {ASPECTS.map((a) => (
            <option key={a.name} value={a.value}>
              {a.name}
            </option>
          ))}
        </select>
        <select
          aria-label="Menu corner"
          value={layout.menu}
          onChange={(e) =>
            commit({ ...layout, menu: e.target.value as MenuCorner })
          }
        >
          {MENU_CORNERS.map((c) => (
            <option key={c} value={c}>
              Menu {c}
            </option>
          ))}
        </select>
        <span className="dz-spacer" />
        <div className="dz-swatches" aria-label="Player colour">
          {COLORS.slice(0, 5).map((c, i) => (
            <button
              key={c}
              type="button"
              aria-label={`Player ${i + 1} colour`}
              aria-pressed={i === color}
              style={{ background: c }}
              onClick={() => setColor(i)}
            />
          ))}
        </div>
        <button
          type="button"
          onClick={undo}
          disabled={!history.length}
          title="Undo (⌘Z)"
        >
          <Undo2 /> Undo
        </button>
        <button
          type="button"
          aria-pressed={play}
          onClick={() => setPlay((p) => !p)}
        >
          <Play /> {play ? 'Playing' : 'Play'}
        </button>
        <SaveBadge state={status} />
        <button
          type="button"
          title="Copy layout JSON"
          onClick={() =>
            void navigator.clipboard.writeText(
              JSON.stringify(layout, null, 2) + '\n',
            )
          }
        >
          <Copy /> JSON
        </button>
        <button
          type="button"
          className="dz-primary"
          onClick={() => setPhone(true)}
        >
          <Smartphone /> Test on phone
        </button>
      </header>
      <Palette
        motion={layout.motion}
        onAdd={(t) => add(t)}
        onMotion={(m, on) =>
          commit({ ...layout, motion: { ...layout.motion, [m]: on } })
        }
      />
      <section className="dz-stage">
        <Canvas
          layout={layout}
          selected={selected}
          invalid={invalid}
          play={play}
          aspect={aspect}
          accent={COLORS[color]}
          readings={readings}
          onSelect={setSelected}
          onBeginEdit={() => setHistory((h) => [...h.slice(-49), layout])}
          onRect={(i, rect) => setLayout((l) => updateItem(l, i, { rect }))}
          onRotate={(i) => commit(rotateItem(layout, i))}
          onRemove={(i) => {
            commit(removeItem(layout, i));
            setSelected(null);
          }}
          onDropControl={(type, cell) => add(type, cell)}
        />
        <p className="dz-muted dz-help">
          {motionOn.length
            ? `Motion on: ${motionOn.join(', ')} · `
            : 'Touch only · '}
          Drag to move · corners resize · R rotates · arrows nudge (⇧ resizes) ·
          Delete removes · ⌘Z undoes
        </p>
      </section>
      <Inspector
        layout={layout}
        index={selected}
        issues={issues}
        readings={play ? readings.readings : null}
        onChange={(change: Partial<LayoutItem>) =>
          selected !== null && commit(updateItem(layout, selected, change))
        }
      />
      {phone && (
        <dialog open className="dz-modal" aria-label="Test on phone">
          <button
            type="button"
            className="dz-modal__close"
            aria-label="Close"
            onClick={() => setPhone(false)}
          >
            <X />
          </button>
          <h2>Test on phone</h2>
          <PhoneLink layoutId={layout.id} />
        </dialog>
      )}
    </main>
  );
}

function SaveBadge({ state }: { state: SaveState }) {
  const text = {
    saved: 'Saved',
    pending: 'Saving…',
    invalid: 'Fix checks to save',
    offline: 'Dev server only — copy JSON',
    error: state.kind === 'error' ? `Save failed: ${state.message}` : '',
  }[state.kind];
  return (
    <span className="dz-save" data-state={state.kind} title={text}>
      {text}
    </span>
  );
}
