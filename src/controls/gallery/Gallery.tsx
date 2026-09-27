'use client';
// /?role=gallery — every control and layout, live, with a readout of exactly
// what a game would receive. Needs no room: controls talk to a mock port.
import { useState, type CSSProperties } from 'react';
import { COLORS, type Widget } from '../../core/types.ts';
import { ControllerSurface } from '../ControllerSurface.tsx';
import { LAYOUTS, type LayoutPreset } from '../layouts.ts';
import { definitions } from '../registry.ts';
import type { ControlDefinition, ControlPort } from '../types.ts';

/** Demo configurations shown for each control type. */
const OPTIONS: Record<string, { name: string; widget: Partial<Widget> }[]> = {
  button: [
    { name: 'Accent', widget: { label: 'Fire', props: { icon: 'fire' } } },
    {
      name: 'Neutral',
      widget: { label: 'Block', variant: 'neutral', props: { icon: 'block' } },
    },
    {
      name: 'Danger',
      widget: { label: 'Cut', variant: 'danger', props: { icon: 'cancel' } },
    },
    { name: 'Letter', widget: { label: 'A' } },
  ],
  dpad: [
    { name: '4-way', widget: { label: 'Move' } },
    { name: '8-way', widget: { label: 'Move', props: { directions: 8 } } },
  ],
  stick: [
    { name: 'Floating', widget: { label: 'Move' } },
    { name: 'Fixed', widget: { label: 'Move', props: { floating: false } } },
  ],
  'swipe-pad': [{ name: 'Default', widget: { label: 'Throw' } }],
  'hold-meter': [
    { name: '1 s', widget: { label: 'Power' } },
    { name: '2 s', widget: { label: 'Power', props: { holdMs: 2000 } } },
  ],
};

type Demo = Omit<Widget, 'id' | 'action'> & { action: string };
const LAYOUT_DEMOS: Record<Exclude<LayoutPreset, 'custom'>, Demo[]> = {
  single: [{ type: 'stick', label: 'Move', action: 'move' }],
  stack: [
    { type: 'stick', label: 'Move', action: 'move' },
    { type: 'button', label: 'Jump', action: 'jump', props: { icon: 'jump' } },
  ],
  duo: [
    { type: 'button', label: 'Fire', action: 'fire', props: { icon: 'fire' } },
    {
      type: 'button',
      label: 'Block',
      action: 'block',
      variant: 'neutral',
      props: { icon: 'block' },
    },
  ],
  gamepad: [
    { type: 'dpad', label: 'Move', action: 'move' },
    { type: 'button', label: 'Jump', action: 'jump', props: { icon: 'jump' } },
    {
      type: 'hold-meter',
      label: 'Power',
      action: 'power',
      props: { hint: '' },
    },
  ],
};

interface Reading {
  value?: unknown;
  presses: number;
  held: boolean;
  at: number;
}

function useReadings() {
  const [readings, setReadings] = useState<Record<string, Reading>>({});
  const update = (id: string, change: (r: Reading) => Partial<Reading>) =>
    setReadings((all) => {
      const r = all[id] ?? { presses: 0, held: false, at: 0 };
      return { ...all, [id]: { ...r, ...change(r), at: performance.now() } };
    });
  const portFor = (w: Widget): ControlPort => ({
    value: (value) => update(w.id, () => ({ value })),
    press: (down) =>
      update(w.id, (r) => ({
        held: down,
        presses: down && !r.held ? r.presses + 1 : r.presses,
      })),
    haptic: (ms = 10) => navigator.vibrate?.(ms),
  });
  return { readings, portFor };
}

export function Gallery() {
  // ?tab=layouts&layout=duo&landscape deep-links a view (handy for sharing).
  const [tab, setTab] = useState<'controls' | 'layouts'>(() =>
      param('tab') === 'layouts' ? 'layouts' : 'controls',
    ),
    [color, setColor] = useState(0);
  const accent = COLORS[color];
  return (
    <main
      className="ctl-gallery"
      style={{ '--ctl-accent': accent } as CSSProperties}
    >
      <header className="ctl-gallery__head">
        <p className="ctl-gallery__eyebrow">Controlla controls</p>
        <h1>Controller kit</h1>
        <p className="ctl-gallery__lede">
          Every input a game can ask for. Play with them; the readout shows
          exactly what the game receives.
        </p>
        <div className="ctl-gallery__row">
          {COLORS.map((c, i) => (
            <button
              key={c}
              type="button"
              aria-pressed={i === color}
              aria-label={`Player ${i + 1} colour`}
              className="ctl-gallery__swatch"
              style={{ background: c }}
              onClick={() => setColor(i)}
            />
          ))}
        </div>
        <div className="ctl-gallery__tabs" role="tablist">
          {(['controls', 'layouts'] as const).map((t) => (
            <button
              key={t}
              type="button"
              role="tab"
              aria-selected={tab === t}
              onClick={() => setTab(t)}
            >
              {t === 'controls' ? 'Controls' : 'Layouts'}
            </button>
          ))}
        </div>
      </header>
      {tab === 'controls' ? (
        definitions.map((d) => (
          <ControlCard key={d.type} definition={d} accent={accent} />
        ))
      ) : (
        <LayoutPreview accent={accent} />
      )}
    </main>
  );
}

function ControlCard({
  definition: d,
  accent,
}: {
  definition: ControlDefinition;
  accent: string;
}) {
  const options = OPTIONS[d.type] ?? [{ name: 'Default', widget: {} }],
    [option, setOption] = useState(0),
    { readings, portFor } = useReadings();
  const widget: Widget = {
    id: d.type,
    action: d.type,
    type: d.type,
    label: d.displayName,
    ...options[option]?.widget,
  };
  const r = readings[widget.id];
  return (
    <section className="ctl-gallery__card">
      <div className="ctl-gallery__card-head">
        <h2>{d.displayName}</h2>
        <code>{d.type}</code>
        <span className="ctl-gallery__badge">{d.channel}</span>
      </div>
      <p className="ctl-gallery__desc">{d.description}</p>
      {options.length > 1 && (
        <div className="ctl-gallery__chips">
          {options.map((o, i) => (
            <button
              key={o.name}
              type="button"
              aria-pressed={i === option}
              onClick={() => setOption(i)}
            >
              {o.name}
            </button>
          ))}
        </div>
      )}
      <div className="ctl-gallery__stage">
        <ControllerSurface
          key={option}
          layout="single"
          widgets={[{ ...widget, slot: 'primary' }]}
          accent={accent}
          portFor={portFor}
        />
      </div>
      <Readout reading={r} />
      <p className="ctl-gallery__output">
        <strong>Game receives</strong> {d.output}
      </p>
    </section>
  );
}

function Readout({ reading }: { reading?: Reading }) {
  return (
    <output
      className="ctl-gallery__readout"
      data-held={reading?.held || undefined}
    >
      <span>
        <b>value</b>
        {reading?.value === undefined ? '—' : JSON.stringify(reading.value)}
      </span>
      <span>
        <b>presses</b>
        {reading?.presses ?? 0}
        <i className="ctl-gallery__led" aria-hidden />
      </span>
    </output>
  );
}

function LayoutPreview({ accent }: { accent: string }) {
  const presets = Object.keys(LAYOUT_DEMOS) as (keyof typeof LAYOUT_DEMOS)[],
    [preset, setPreset] = useState<keyof typeof LAYOUT_DEMOS>(() => {
      const p = param('layout');
      return p && p in LAYOUT_DEMOS
        ? (p as keyof typeof LAYOUT_DEMOS)
        : 'gamepad';
    }),
    [landscape, setLandscape] = useState(() => param('landscape') !== null),
    { readings, portFor } = useReadings();
  const widgets: Widget[] = LAYOUT_DEMOS[preset].map((w, i) => ({
    ...w,
    id: w.action,
    slot: LAYOUTS[preset][i],
  }));
  return (
    <section className="ctl-gallery__card">
      <div className="ctl-gallery__chips">
        {presets.map((p) => (
          <button
            key={p}
            type="button"
            aria-pressed={p === preset}
            onClick={() => setPreset(p)}
          >
            {p}
          </button>
        ))}
        <button
          type="button"
          aria-pressed={landscape}
          onClick={() => setLandscape((l) => !l)}
        >
          {landscape ? 'Landscape' : 'Portrait'} ⟳
        </button>
      </div>
      <div
        className="ctl-gallery__phone"
        data-landscape={landscape || undefined}
      >
        <ControllerSurface
          layout={preset}
          widgets={widgets}
          accent={accent}
          portFor={portFor}
        />
      </div>
      {widgets.map((w) => (
        <div key={w.id} className="ctl-gallery__readout-row">
          <code>{w.action}</code>
          <Readout reading={readings[w.id]} />
        </div>
      ))}
      <pre className="ctl-gallery__code">
        {manifestSnippet(preset, widgets)}
      </pre>
    </section>
  );
}

function param(name: string) {
  return typeof location === 'undefined'
    ? null
    : new URLSearchParams(location.search).get(name);
}

function manifestSnippet(preset: string, widgets: Widget[]) {
  const inputs = widgets
    .map((w) => {
      const extra = [
        w.variant && `variant: '${w.variant}'`,
        w.props &&
          Object.keys(w.props).length &&
          `props: ${JSON.stringify(w.props)}`,
      ].filter(Boolean);
      return `  ${w.action}: { prefer: '${w.type}', required: true, label: '${w.label}'${extra.length ? ', ' + extra.join(', ') : ''} },`;
    })
    .join('\n');
  return `// In your game's Manifest\nlayout: '${preset}',\ninputs: {\n${inputs}\n},`;
}
