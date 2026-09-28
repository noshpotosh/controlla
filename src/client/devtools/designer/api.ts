// Talks to the dev server's layout endpoints (vite.config.ts).
import type { ControllerLayout } from '../../../controls/api.ts';

async function call(url: string, init: RequestInit) {
  const res = await fetch(url, init),
    body = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
}

const post = (layout: ControllerLayout, create: boolean) =>
  call(`/__controlla/layouts${create ? '?create' : ''}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(layout),
  });

export const createLayout = (layout: ControllerLayout) => post(layout, true);
export const saveLayout = (layout: ControllerLayout) => post(layout, false);
export const deleteLayout = (id: string) =>
  call(`/__controlla/layouts?id=${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });

/** Saving needs the dev server; a deployed build can only copy JSON. */
export const canSave = import.meta.env.DEV;
