'use client';
// /?role=gallery — every control and layout, live, with a readout of exactly
// what a game would receive, plus the design system they share
// (docs/design/CONTROLLER-DESIGN.md). Needs no room: controls talk to a mock
// port.
import { useState, type CSSProperties } from 'react';
import type {
  Widget,
  LayoutPreset,
  ControlAppearance,
  ControlDefinition,
  ControlShape,
} from '../../controls/api.ts';
import { COLORS } from '../../../shared/room.ts';
import { ControllerSurface } from '../../controls/ControllerSurface.tsx';
import { layoutWidgets } from '../../controls/layout/widgets.ts';

import { LAYOUTS, templateLayout } from '../../controls/layouts.ts';
import { definitions } from '../../controls/registry.ts';

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

const TABS = ['controls', 'layouts', 'design'] as const;
type Tab = (typeof TABS)[number];
const TAB_NAMES: Record<Tab, string> = {
  controls: 'Controls',
  layouts: 'Layouts',
  design: 'Design',
};

export function Gallery() {
  // ?tab=layouts&layout=duo&landscape deep-links a view (handy for sharing).
  const [tab, setTab] = useState<Tab>(() => {
      const t = param('tab');
      return TABS.includes(t as Tab) ? (t as Tab) : 'controls';
    }),
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
          {TABS.map((t) => (
            <button
              key={t}
              type="button"
              role="tab"
              aria-selected={tab === t}
              onClick={() => setTab(t)}
            >
              {TAB_NAMES[t]}
            </button>
          ))}
        </div>
      </header>
      {tab === 'controls' ? (
        definitions.map((d) => (
          <ControlCard key={d.type} definition={d} accent={accent} />
        ))
      ) : tab === 'layouts' ? (
        <LayoutPreview accent={accent} />
      ) : (
        <DesignSheet accent={accent} />
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
    [shape, setShape] = useState<ControlShape>(d.shapes[0]),
    [appearance, setAppearance] = useState<ControlAppearance>(d.appearances[0]),
    { readings, portFor } = useReadings();
  const demo = options[option]?.widget,
    widget: Widget = {
      id: d.type,
      action: d.type,
      type: d.type,
      label: d.displayName,
      rect: [0, 0, 1, 1],
      ...demo,
      props: { ...demo?.props, shape, appearance },
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
      <div className="ctl-gallery__chips">
        {d.shapes.map((s) => (
          <button
            key={s}
            type="button"
            aria-pressed={s === shape}
            onClick={() => setShape(s)}
          >
            {s}
          </button>
        ))}
        <span className="ctl-gallery__chip-gap" />
        {d.appearances.map((a) => (
          <button
            key={a}
            type="button"
            aria-pressed={a === appearance}
            onClick={() => setAppearance(a)}
          >
            {a}
          </button>
        ))}
      </div>
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

const SWATCHES: { group: string; tokens: string[] }[] = [
  {
    group: 'Material',
    tokens: ['--ctl-bg', '--ctl-well', '--ctl-surface', '--ctl-surface-raised'],
  },
  { group: 'Ink', tokens: ['--ctl-ink', '--ctl-ink-muted', '--ctl-ink-faint'] },
  {
    group: 'Tone',
    tokens: ['--ctl-accent', '--ctl-neutral', '--ctl-danger', '--ctl-warning'],
  },
];

/** One sample control, rendered through the real surface at a fixed size. */
function Sample({
  widget,
  accent,
  size,
  width = size,
}: {
  widget: Omit<Widget, 'id' | 'action' | 'rect'>;
  accent: string;
  size: number;
  width?: number;
}) {
  const { portFor } = useReadings();
  return (
    <div className="ctl-gallery__sample" style={{ width, height: size }}>
      <ControllerSurface
        widgets={[{ id: 's', action: 's', rect: [0, 0, 1, 1], ...widget }]}
        accent={accent}
        portFor={portFor}
      />
    </div>
  );
}

/** The design system at a glance: tokens, type, shapes, appearances, sizes. */
function DesignSheet({ accent }: { accent: string }) {
  const shapes: ControlShape[] = ['rounded', 'square', 'circle', 'capsule'],
    appearances: ControlAppearance[] = ['filled', 'tinted', 'plain'];
  return (
    <>
      <section className="ctl-gallery__card">
        <div className="ctl-gallery__card-head">
          <h2>Colour</h2>
        </div>
        <p className="ctl-gallery__desc">
          Graphite material lit from above. The player colour is the only
          saturated hue, and it marks what you&rsquo;re touching.
        </p>
        {SWATCHES.map(({ group, tokens }) => (
          <div key={group} className="ctl-gallery__swatch-row">
            <strong>{group}</strong>
            {tokens.map((t) => (
              <span key={t} className="ctl-gallery__token">
                <span style={{ background: `var(${t})` }} />
                <code>{t.replace('--ctl-', '')}</code>
              </span>
            ))}
          </div>
        ))}
      </section>
      <section className="ctl-gallery__card">
        <div className="ctl-gallery__card-head">
          <h2>Type</h2>
        </div>
        <div className="ctl-gallery__type">
          <span style={{ font: '600 var(--ctl-font-label) var(--ctl-font)' }}>
            Caption — 13 semibold, sentence case
          </span>
          <span
            style={{
              font: 'var(--ctl-font-hint) var(--ctl-font)',
              color: 'var(--ctl-ink-faint)',
            }}
          >
            Hint — 12 regular, faint
          </span>
          <span
            style={{
              font: '600 40px var(--ctl-font-rounded)',
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            A 42%
          </span>
        </div>
      </section>
      <section className="ctl-gallery__card">
        <div className="ctl-gallery__card-head">
          <h2>Shape × appearance</h2>
        </div>
        <p className="ctl-gallery__desc">
          Filled for the primary action, tinted for secondary ones, plain for
          pads. Circles for face buttons, capsules for wide actions.
        </p>
        <div
          className="ctl-gallery__matrix"
          style={{ '--cols': shapes.length } as CSSProperties}
        >
          {appearances.flatMap((appearance) =>
            shapes.map((shape) => (
              <Sample
                key={`${appearance}-${shape}`}
                accent={accent}
                size={112}
                // Capsules round their short sides; show one wide.
                width={shape === 'capsule' ? 200 : 112}
                widget={{
                  type: 'button',
                  label: appearance,
                  props: { shape, appearance, icon: 'jump' },
                }}
              />
            )),
          )}
        </div>
      </section>
      <section className="ctl-gallery__card">
        <div className="ctl-gallery__card-head">
          <h2>Sizes</h2>
        </div>
        <p className="ctl-gallery__desc">
          Controls shrink to a single cell. Below about 84pt the caption hides;
          below 132pt the hint does. Keep small controls for secondary actions.
        </p>
        <div className="ctl-gallery__sizes">
          {[36, 56, 84, 132].map((size) => (
            <Sample
              key={size}
              accent={accent}
              size={size}
              widget={{
                type: 'button',
                label: 'Jump',
                props: { icon: 'jump', hint: 'Tap' },
              }}
            />
          ))}
        </div>
      </section>
    </>
  );
}

function param(name: string) {
  return typeof location === 'undefined'
    ? null
    : new URLSearchParams(location.search).get(name);
}
