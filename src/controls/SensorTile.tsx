'use client';
// Stand-in for motion inputs (pointer, tilt, shake) and other unported
// widgets wherever there's no live Runtime: the designer and phone preview.
import { Move3d, Smartphone, Vibrate } from 'lucide-react';
import type { Widget } from '../core/types.ts';

const SENSORS: Partial<
  Record<Widget['type'], { Icon: typeof Move3d; hint: string }>
> = {
  pointer: { Icon: Move3d, hint: 'Point your phone at the screen' },
  tilt: { Icon: Smartphone, hint: 'Tilt to steer' },
  shake: { Icon: Vibrate, hint: 'Shake your phone' },
};

export function SensorTile({ widget }: { widget: Widget }) {
  const sensor = SENSORS[widget.type];
  const Icon = sensor?.Icon ?? Smartphone;
  return (
    <div className="ctl-frame ctl-sensor">
      <span className="ctl-frame__label">{widget.label}</span>
      <Icon className="ctl-sensor__icon" strokeWidth={2} />
      <span className="ctl-frame__hint">
        {sensor?.hint ?? `${widget.type} (not in the library yet)`}
      </span>
    </div>
  );
}
