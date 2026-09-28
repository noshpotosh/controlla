'use client';
// Right rail: edit the selected control (name, look, props from its
// definition's `fields`), or see which games use the layout.
import { useState } from 'react';
import { manifests } from '../../core/config.ts';
import { Readout, type Reading } from '../gallery/readings.tsx';
import { ICONS } from '../kit/icons.ts';
import { definitionFor, definitions } from '../registry.ts';
import type { Field } from '../types.ts';
import { checkAssignment, type LayoutIssue } from '../layout/validate.ts';
import {
  isControlName,
  ROTATIONS,
  type ControllerLayout,
  type LayoutItem,
  type Rotation,
} from '../layout/schema.ts';

const HINT: Field = { key: 'hint', label: 'Hint', type: 'text' };

export function Inspector({
  layout,
  index,
  issues,
  readings,
  onChange,
}: {
  layout: ControllerLayout;
  index: number | null;
  issues: LayoutIssue[];
  /** While playing: what each control is sending. */
  readings: Record<string, Reading> | null;
  onChange: (change: Partial<LayoutItem>) => void;
}) {
  const item = index === null ? null : layout.items[index];
  return (
    <aside className="dz-inspector">
      {readings ? (
        <section>
          <h2>Controls send</h2>
          {layout.items.map((i) => (
            <div key={i.name} className="dz-reading">
              <code>{i.name}</code>
              <Readout reading={readings[i.name]} />
            </div>
          ))}
        </section>
      ) : item ? (
        // Keyed by index so the name draft resets when the selection changes.
        <ItemFields
          key={index}
          item={item}
          layout={layout}
          onChange={onChange}
        />
      ) : (
        <GamesPanel layout={layout} />
      )}
      <section>
        <h2>Checks</h2>
        {issues.length ? (
          <ul className="dz-issues">
            {issues.map((issue, i) => (
              <li key={i} data-selected={issue.item === index || undefined}>
                {issue.message}
              </li>
            ))}
          </ul>
        ) : (
          <p className="dz-ok">Layout looks good.</p>
        )}
      </section>
    </aside>
  );
}

/** Which games use this layout, and whether it still fits their inputs. */
function GamesPanel({ layout }: { layout: ControllerLayout }) {
  const games = manifests.filter((m) => m.controller?.layout === layout.id);
  return (
    <section>
      <h2>Used by</h2>
      {games.length ? (
        games.map((g) => {
          const problems = checkAssignment(g, layout);
          return (
            <div key={g.id} className="dz-game">
              <strong>{g.name}</strong>
              <span className="dz-muted dz-small">
                Inputs: {Object.keys(g.inputs).join(', ')}
              </span>
              {problems.length ? (
                <ul className="dz-issues">
                  {problems.map((p, i) => (
                    <li key={i}>{p.message}</li>
                  ))}
                </ul>
              ) : (
                <span className="dz-ok dz-small">
                  Every input has a control.
                </span>
              )}
            </div>
          );
        })
      ) : (
        <p className="dz-muted">
          No game uses this layout yet. Games choose a layout with{' '}
          <code>{`controller: { layout: '${layout.id}' }`}</code> in their
          manifest; inputs drive the controls with the same names.
        </p>
      )}
      <p className="dz-muted dz-small">Select a control to edit it.</p>
    </section>
  );
}

function ItemFields({
  item,
  layout,
  onChange,
}: {
  item: LayoutItem;
  layout: ControllerLayout;
  onChange: (change: Partial<LayoutItem>) => void;
}) {
  const definition = definitionFor(item.type),
    props = { ...definition?.defaults, ...item.props } as Record<
      string,
      unknown
    >,
    setProp = (key: string, value: unknown) =>
      onChange({ props: { ...item.props, [key]: value } }),
    [draftName, setDraftName] = useState(item.name),
    clash = layout.items.some((i) => i !== item && i.name === draftName);
  return (
    <section>
      <h2>{definition?.displayName ?? item.type}</h2>
      <label>
        Name
        <input
          value={draftName}
          spellCheck={false}
          aria-invalid={clash || !isControlName(draftName) || undefined}
          onChange={(e) => {
            setDraftName(e.target.value);
            if (
              isControlName(e.target.value) &&
              !layout.items.some((i) => i !== item && i.name === e.target.value)
            )
              onChange({ name: e.target.value });
          }}
        />
        <small className="dz-muted">
          {clash
            ? 'Another control has this name.'
            : !isControlName(draftName)
              ? 'Letters, numbers, - and _ only.'
              : 'Game inputs with this name drive this control.'}
        </small>
      </label>
      <label>
        Label
        <input
          value={item.label ?? ''}
          placeholder={item.name}
          onChange={(e) => onChange({ label: e.target.value || undefined })}
        />
      </label>
      <label>
        Control
        <select
          value={item.type}
          onChange={(e) =>
            // Props and variants belong to a control; start fresh on a swap.
            onChange({
              type: e.target.value as LayoutItem['type'],
              props: undefined,
              variant: undefined,
            })
          }
        >
          {definitions.map((d) => (
            <option key={d.type} value={d.type}>
              {d.displayName} ({d.kind})
            </option>
          ))}
        </select>
      </label>
      {!!definition?.variants.length && (
        <label>
          Variant
          <select
            value={item.variant ?? ''}
            onChange={(e) => onChange({ variant: e.target.value || undefined })}
          >
            <option value="">Default</option>
            {definition.variants.map((v) => (
              <option key={v}>{v}</option>
            ))}
          </select>
        </label>
      )}
      {definition &&
        [...definition.fields, HINT].map((f) => (
          <FieldInput
            key={f.key}
            field={f}
            value={props[f.key]}
            onChange={(v) => setProp(f.key, v)}
          />
        ))}
      <div className="dz-label">Rotation</div>
      <div className="dz-seg">
        {ROTATIONS.map((r) => (
          <button
            key={r}
            type="button"
            aria-pressed={item.rotation === r}
            onClick={() => onChange({ rotation: r as Rotation })}
          >
            {r}°
          </button>
        ))}
      </div>
      <div className="dz-label">Position (cells)</div>
      <div className="dz-rect">
        {(['x', 'y', 'w', 'h'] as const).map((k) => (
          <label key={k}>
            {k}
            <input
              type="number"
              min={k === 'w' || k === 'h' ? 1 : 0}
              value={item.rect[k]}
              onChange={(e) =>
                onChange({
                  rect: { ...item.rect, [k]: Number(e.target.value) },
                })
              }
            />
          </label>
        ))}
      </div>
    </section>
  );
}

function FieldInput({
  field: f,
  value,
  onChange,
}: {
  field: Field;
  value: unknown;
  onChange: (value: unknown) => void;
}) {
  if (f.type === 'boolean')
    return (
      <label className="dz-check">
        <input
          type="checkbox"
          checked={value === true}
          onChange={(e) => onChange(e.target.checked)}
        />
        {f.label}
      </label>
    );
  return (
    <label>
      {f.label}
      {f.type === 'number' ? (
        <input
          type="number"
          min={f.min}
          max={f.max}
          step={f.step}
          value={typeof value === 'number' ? value : ''}
          onChange={(e) => onChange(Number(e.target.value))}
        />
      ) : f.type === 'select' ? (
        <select
          value={
            typeof value === 'number' || typeof value === 'string'
              ? String(value)
              : ''
          }
          onChange={(e) => {
            const option = f.options.find((o) => String(o) === e.target.value);
            onChange(option);
          }}
        >
          {f.options.map((o) => (
            <option key={String(o)}>{String(o)}</option>
          ))}
        </select>
      ) : f.type === 'icon' ? (
        <select
          value={typeof value === 'string' ? value : ''}
          onChange={(e) => onChange(e.target.value || undefined)}
        >
          <option value="">Letter from label</option>
          {Object.keys(ICONS).map((name) => (
            <option key={name}>{name}</option>
          ))}
        </select>
      ) : (
        <input
          value={typeof value === 'string' ? value : ''}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </label>
  );
}
