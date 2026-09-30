'use client';
// Each screen shows a big emblem; phones offer the same emblems so players
// can pick the one they see without reading a code.
import {
  Anchor,
  Flame,
  Heart,
  Leaf,
  Moon,
  Rocket,
  Star,
  Zap,
} from 'lucide-react';
import {
  screenEmblem,
  type ScreenEmblem as Emblem,
} from '../../shared/room.ts';

const ICONS: Record<Emblem, typeof Star> = {
  star: Star,
  moon: Moon,
  bolt: Zap,
  heart: Heart,
  leaf: Leaf,
  flame: Flame,
  anchor: Anchor,
  rocket: Rocket,
};

export function ScreenEmblem({
  index,
  size = 26,
}: {
  index: number;
  size?: number;
}) {
  const emblem = screenEmblem(index),
    Icon = ICONS[emblem];
  return (
    <span className="emblem" data-emblem={emblem} aria-hidden="true">
      <Icon size={size} strokeWidth={2.4} />
    </span>
  );
}
