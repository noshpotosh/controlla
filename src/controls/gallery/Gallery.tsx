'use client';
// /?role=gallery — every control and layout, live, with a readout of exactly
// what a game would receive. Needs no room: controls talk to a mock port.
import { useState, type CSSProperties } from 'react';
import { COLORS, type Widget } from '../../core/types.ts';
import { ControllerSurface } from '../ControllerSurface.tsx';
import { layoutWidgets } from '../layout/widgets.ts';
import { LAYOUTS, templateLayout, type LayoutPreset } from '../layouts.ts';
import { definitions } from '../registry.ts';
import type { ControlDefinition } from '../types.ts';
import { Readout, useReadings } from './readings.tsx';

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

export function Gallery() {
  // ?tab=layouts&layout=duo&landscape deep-links a view (handy for sharing).
  const [tab, setTab] = useState<'controls' | 'layouts'>(() =>
      param('tab') === 'layouts' ? 'layouts' : 'controls',
    ),
    [color, setColor] = useState(0);
  const accent = COLORS[color];
  return (
    <main
      className="ctl-gallery ctl-scope"
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
    rect: [0, 0, 1, 1],
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
          widgets={[widget]}
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

function LayoutPreview({ accent }: { accent: string }) {
  const presets = Object.keys(LAYOUTS) as LayoutPreset[],
    [preset, setPreset] = useState<LayoutPreset>(() => {
      const p = param('layout');
      return p && p in LAYOUTS ? (p as LayoutPreset) : 'gamepad';
    }),
    [landscape, setLandscape] = useState(() => param('landscape') !== null),
    { readings, portFor } = useReadings();
  const widgets = layoutWidgets(
    templateLayout(
      preset,
      landscape ? 'landscape' : 'portrait',
      'demo',
      'Demo',
    ),
  );
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
      <p className="ctl-gallery__output">
        These are the templates new layouts start from. Design your own at{' '}
        <code>/?role=designer</code>.
      </p>
    </section>
  );
}

function param(name: string) {
  return typeof location === 'undefined'
    ? null
    : new URLSearchParams(location.search).get(name);
}
