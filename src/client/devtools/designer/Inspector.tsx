'use client';
// Right rail: edit the selected control (name, look, size, props from its
// definition's `fields`), or see which games use the layout.
import { useState } from 'react';
import { games as catalog } from '../../minigames/catalog.ts';
import type {
  ControllerSpec,
  Field,
  ControllerLayout,
  LayoutItem,
  Rotation,
} from '../../controls/api.ts';
const specs: ControllerSpec[] = catalog.map(({ id, name, controls }) => ({
  id,
  name,
  ...controls,
}));
import { Readout, type Reading } from '../gallery/readings.tsx';
import { ICONS } from '../../controls/kit/icons.ts';
import { definitionFor, definitions } from '../../controls/registry.ts';
import { CONTROL_COLORS, isControlColor } from '../../controls/colors.ts';

import {
  checkAssignment,
  recommendedFootprint,
  type LayoutIssue,
} from '../../controls/layout/validate.ts';

import { isControlName, ROTATIONS } from '../../controls/layout/schema.ts';
import { fillAxis, sizePreset, type SizePreset } from './model.ts';

/** A layout edit on the selected item, applied as one undoable step. */
export type ItemEdit = (
  layout: ControllerLayout,
  index: number,
) => ControllerLayout;

const PRESETS: readonly SizePreset[] = ['S', 'M', 'L'];

const HINT: Field = { key: 'hint', label: 'Hint', type: 'text' };

export function Inspector({
  layout,
  index,
  issues,
  warnings,
  readings,
  onChange,
  onApply,
}: {
  layout: ControllerLayout;
  index: number | null;
  /** Problems that block saving. */
  issues: LayoutIssue[];
  /** Advice that doesn't. */
  warnings: LayoutIssue[];
  /** While playing: what each control is sending. */
  readings: Record<string, Reading> | null;
  onChange: (change: Partial<LayoutItem>) => void;
  onApply: (edit: ItemEdit) => void;
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
          onApply={onApply}
        />
      ) : (
        <GamesPanel layout={layout} />
      )}
      <section>
        <h2>Checks</h2>
        {issues.length || warnings.length ? (
          <ul className="dz-issues">
            {issues.map((issue, i) => (
              <li key={i} data-selected={issue.item === index || undefined}>
                {issue.message}
              </li>
            ))}
            {warnings.map((issue, i) => (
              <li
                key={`w${i}`}
                data-level="warning"
                data-selected={issue.item === index || undefined}
              >
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
  const games = specs.filter((m) => m.controller?.layout === layout.id);
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
          <code>{`controller: { layout: '${layout.id}' }`}</code> in their spec;
          inputs drive the controls with the same names.
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
  onApply,
}: {
  item: LayoutItem;
  layout: ControllerLayout;
  onChange: (change: Partial<LayoutItem>) => void;
  onApply: (edit: ItemEdit) => void;
}) {
  const definition = definitionFor(item.type),
    props = {
      shape: definition?.shapes[0],
      appearance: definition?.appearances[0],
      ...definition?.defaults,
      ...item.props,
    } as Record<string, unknown>,
    recommended = recommendedFootprint(item),
    color = isControlColor(props.color) ? props.color : 'player',
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
          onChange={(e) => {
            // Props and variants belong to a control; start fresh on a swap,
            // keeping the look where the new control supports it.
            const type = e.target.value as LayoutItem['type'],
              next = definitionFor(type),
              kept = {
                ...(next?.shapes.includes(item.props?.shape as never) && {
                  shape: item.props?.shape,
                }),
                ...(next?.appearances.includes(
                  item.props?.appearance as never,
                ) && { appearance: item.props?.appearance }),
                ...(item.props?.bare === true && { bare: true }),
                ...(isControlColor(item.props?.color) && {
                  color: item.props.color,
                }),
              };
            onChange({
              type,
              props: Object.keys(kept).length ? kept : undefined,
              variant: undefined,
            });
          }}
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
      {definition && (
        <>
          <div className="dz-label">Shape</div>
          <div className="dz-seg dz-seg--fill">
            {definition.shapes.map((shape) => (
              <button
                key={shape}
                type="button"
                title={shape}
                aria-label={shape}
                aria-pressed={props.shape === shape}
                onClick={() => setProp('shape', shape)}
              >
                <span className="dz-shape" data-shape={shape} />
              </button>
            ))}
          </div>
          <div className="dz-label">Appearance</div>
          <div className="dz-seg dz-seg--fill">
            {definition.appearances.map((appearance) => (
              <button
                key={appearance}
                type="button"
                aria-pressed={props.appearance === appearance}
                onClick={() => setProp('appearance', appearance)}
              >
                {appearance}
              </button>
            ))}
          </div>
          <div className="dz-label">Colour · {color}</div>
          <div className="dz-colors">
            {CONTROL_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                title={c === 'player' ? "Player's colour" : c}
                aria-label={c}
                aria-pressed={c === color}
                data-color={c}
                style={{
                  background:
                    c === 'player'
                      ? 'var(--ctl-accent)'
                      : `var(--ctl-hue-${c})`,
                }}
                onClick={() => setProp('color', c === 'player' ? undefined : c)}
              />
            ))}
          </div>
          <label className="dz-check">
            <input
              type="checkbox"
              checked={props.bare !== true}
              onChange={(e) => setProp('bare', !e.target.checked || undefined)}
            />
            Show caption and hint
          </label>
        </>
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
      <div className="dz-label">
        Size · recommended {recommended.w}×{recommended.h}
      </div>
      <div className="dz-seg dz-seg--fill">
        {PRESETS.map((preset) => (
          <button
            key={preset}
            type="button"
            title={
              preset === 'M'
                ? 'Recommended size'
                : preset === 'S'
                  ? 'Compact (secondary actions)'
                  : 'Generous'
            }
            onClick={() => onApply((l, i) => sizePreset(l, i, preset))}
          >
            {preset}
          </button>
        ))}
        <button
          type="button"
          title="Stretch across the free space in this row"
          onClick={() => onApply((l, i) => fillAxis(l, i, 'row'))}
        >
          ↔ Fill
        </button>
        <button
          type="button"
          title="Stretch down the free space in this column"
          onClick={() => onApply((l, i) => fillAxis(l, i, 'column'))}
        >
          ↕ Fill
        </button>
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
