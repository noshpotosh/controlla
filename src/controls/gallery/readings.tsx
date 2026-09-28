'use client';
// A mock ControlPort that records what a game would receive, plus a readout
// for it. Shared by the gallery, the phone preview and the designer.
import { useState } from 'react';
import type { Widget, ControlPort } from '../api.ts';

export interface Reading {
  value?: unknown;
  presses: number;
  held: boolean;
  at: number;
}

export function useReadings() {
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

export function Readout({ reading }: { reading?: Reading }) {
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
