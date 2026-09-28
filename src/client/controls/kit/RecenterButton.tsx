'use client';
// Always on screen while aimed motion (pointer, tilt) is on: drift is
// constant, so recentering must never be behind a menu. It sits beside the
// menu button, in the corner the layout reserves for both.
import { useState } from 'react';
import { LocateFixed } from 'lucide-react';
import type { MenuCorner } from '../api.ts';

export function RecenterButton({
  corner,
  orientation,
  onRecenter,
}: {
  corner: MenuCorner;
  orientation: 'portrait' | 'landscape' | 'any';
  onRecenter: () => void;
}) {
  // Bumped per tap so the confirmation replays.
  const [taps, setTaps] = useState(0);
  return (
    <button
      type="button"
      className="ctl-recenter-button"
      data-corner={corner}
      data-orientation={orientation === 'landscape' ? 'landscape' : 'portrait'}
      data-done={taps || undefined}
      aria-label="Recenter"
      title="Recenter"
      onClick={() => {
        onRecenter();
        setTaps((t) => t + 1);
      }}
    >
      <LocateFixed key={taps} strokeWidth={2} />
    </button>
  );
}
