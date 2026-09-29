// The shared glyph set for controls. Games name an icon; they never import
// icon components, so every controller draws from the same vocabulary.
import {
  ArrowBigUp,
  Bomb,
  Check,
  Crosshair,
  Flame,
  Hammer,
  Hand,
  Rocket,
  Shield,
  Sparkles,
  Swords,
  Target,
  X,
  Zap,
  type LucideIcon,
} from 'lucide-react';

export const ICONS = {
  jump: ArrowBigUp,
  bomb: Bomb,
  check: Check,
  aim: Crosshair,
  fire: Flame,
  grab: Hand,
  boost: Rocket,
  block: Shield,
  magic: Sparkles,
  attack: Swords,
  target: Target,
  cancel: X,
  zap: Zap,
  whack: Hammer,
} satisfies Record<string, LucideIcon>;

export type IconName = keyof typeof ICONS;
