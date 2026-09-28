'use client';
// The layout library: every layout in src/layouts, with the games using it.
// Create, open, duplicate or delete layouts here.
import { useState } from 'react';
import { Copy, Pencil, Plus, Smartphone, Trash2 } from 'lucide-react';
import { games as catalog } from '../../client/minigames/catalog.ts';
import { controllerManifest } from '../../client/engine/input.ts';
const manifests = catalog.map(controllerManifest);
import { COLORS } from '../../core/types.ts';
import { layouts } from '../../layouts/index.ts';
import { ControllerSurface } from '../ControllerSurface.tsx';
import {
  MOTION,
  slugify,
  type ControllerLayout,
  type Orientation,
} from '../layout/schema.ts';
import { checkAssignment } from '../layout/validate.ts';
import { layoutWidgets } from '../layout/widgets.ts';
import { LAYOUTS, templateLayout, type LayoutPreset } from '../layouts.ts';
import { emptyLayout } from '../layout/schema.ts';
import { SensorTile } from '../SensorTile.tsx';
import { canSave, createLayout, deleteLayout } from './api.ts';

const noopPort = { value() {}, press() {}, haptic() {} };

export const usedBy = (id: string) =>
  manifests.filter((m) => m.controller?.layout === id);

export function Library({
  open,
}: {
  open: (layout: ControllerLayout) => void;
}) {
  const [creating, setCreating] = useState<ControllerLayout | null | 'new'>(
      null,
    ),
    [error, setError] = useState('');
  const all = Object.values(layouts).sort((a, b) =>
    a.name.localeCompare(b.name),
  );
  const create = async (layout: ControllerLayout) => {
    try {
      setError('');
      await createLayout(layout);
      open(layout);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  return (
    <main className="dz-library ctl-scope">
      <header>
        <div>
          <p className="ctl-gallery__eyebrow">Controlla controls</p>
          <h1>Controller layouts</h1>
          <p className="dz-muted">
            Touch layouts any game can use. Games pick one by name, and their
            inputs drive the controls with matching names.
          </p>
        </div>
        <button
          type="button"
          className="dz-primary dz-big"
          disabled={!canSave}
          onClick={() => setCreating('new')}
        >
          <Plus /> New layout
        </button>
      </header>
      {!canSave && (
        <p className="dz-note">
          Layouts are saved into the repo, so creating and editing needs the dev
          server (<code>npm run dev</code>).
        </p>
      )}
      {error && <p className="dz-issues">{error}</p>}
      <div className="dz-cards">
        {all.map((layout) => {
          const games = usedBy(layout.id);
          return (
            <article key={layout.id} className="dz-card">
              <button
                type="button"
                className="dz-thumb"
                data-orientation={layout.orientation}
                aria-label={`Open ${layout.name}`}
                onClick={() => open(layout)}
              >
                <span className="dz-thumb__phone">
                  <ControllerSurface
                    widgets={layoutWidgets(layout)}
                    accent={COLORS[0]}
                    portFor={() => noopPort}
                    fallback={(w) => <SensorTile widget={w} />}
                  />
                </span>
              </button>
              <div className="dz-card__body">
                <h2>{layout.name}</h2>
                <code>{layout.id}</code>
                <div className="dz-chips">
                  <span>{layout.orientation}</span>
                  <span>{layout.items.length} controls</span>
                  {MOTION.filter((m) => layout.motion[m]).map((m) => (
                    <span key={m} data-motion>
                      {m}
                    </span>
                  ))}
                </div>
                <p className="dz-muted">
                  {games.length
                    ? `Used by ${games
                        .map(
                          (g) =>
                            g.name +
                            (checkAssignment(g, layout).length
                              ? ' (needs fixes)'
                              : ''),
                        )
                        .join(', ')}`
                    : 'Not used by a game yet'}
                </p>
              </div>
              <div className="dz-card__actions">
                <button type="button" onClick={() => open(layout)}>
                  <Pencil /> Edit
                </button>
                <button
                  type="button"
                  disabled={!canSave}
                  onClick={() =>
                    setCreating({
                      ...structuredClone(layout),
                      name: `${layout.name} copy`,
                    })
                  }
                >
                  <Copy /> Duplicate
                </button>
                <a
                  href={`/?role=preview&layout=${layout.id}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  <Smartphone /> Preview
                </a>
                <button
                  type="button"
                  disabled={!canSave || games.length > 0}
                  title={
                    games.length
                      ? 'A game uses this layout; switch the game first'
                      : 'Delete this layout'
                  }
                  onClick={async () => {
                    if (
                      !confirm(
                        `Delete “${layout.name}”? (It stays in git history.)`,
                      )
                    )
                      return;
                    try {
                      await deleteLayout(layout.id);
                    } catch (e) {
                      setError(e instanceof Error ? e.message : String(e));
                    }
                  }}
                >
                  <Trash2 />
                </button>
              </div>
            </article>
          );
        })}
      </div>
      {creating && (
        <NewLayout
          from={creating === 'new' ? null : creating}
          onCancel={() => setCreating(null)}
          onCreate={(layout) => void create(layout)}
        />
      )}
    </main>
  );
}

function NewLayout({
  from,
  onCancel,
  onCreate,
}: {
  /** Duplicate this layout, or start fresh. */
  from: ControllerLayout | null;
  onCancel: () => void;
  onCreate: (layout: ControllerLayout) => void;
}) {
  const [name, setName] = useState(from?.name ?? ''),
    [orientation, setOrientation] = useState<Orientation>(
      from?.orientation ?? 'portrait',
    ),
    [template, setTemplate] = useState<LayoutPreset | 'blank'>('blank');
  const id = slugify(name || 'layout', Object.keys(layouts));
  return (
    <dialog open className="dz-modal" aria-label="New layout">
      <h2>{from ? 'Duplicate layout' : 'New layout'}</h2>
      <form
        className="dz-form"
        onSubmit={(e) => {
          e.preventDefault();
          const title = name.trim() || 'Untitled layout';
          onCreate(
            from
              ? { ...from, id, name: title }
              : template === 'blank'
                ? emptyLayout(id, title, orientation)
                : templateLayout(template, orientation, id, title),
          );
        }}
      >
        <label>
          Name
          <input
            autoFocus
            value={name}
            placeholder="Racing wheel"
            maxLength={60}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <p className="dz-muted">
          Saved as <code>src/layouts/{id}.json</code>
        </p>
        {!from && (
          <>
            <div className="dz-label">Orientation</div>
            <div className="dz-seg">
              {(['portrait', 'landscape'] as const).map((o) => (
                <button
                  key={o}
                  type="button"
                  aria-pressed={orientation === o}
                  onClick={() => setOrientation(o)}
                >
                  {o}
                </button>
              ))}
            </div>
            <label>
              Start from
              <select
                value={template}
                onChange={(e) =>
                  setTemplate(e.target.value as LayoutPreset | 'blank')
                }
              >
                <option value="blank">Blank</option>
                {Object.keys(LAYOUTS).map((p) => (
                  <option key={p} value={p}>
                    {p} template
                  </option>
                ))}
              </select>
            </label>
          </>
        )}
        <div className="dz-form__actions">
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className="dz-primary">
            Create
          </button>
        </div>
      </form>
    </dialog>
  );
}
