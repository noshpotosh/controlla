'use client';
/** Motion presentation is separate from headless processor registration. */
import type { ComponentType } from 'react';
import type { ControlPort, MotionInput, Widget } from '../api.ts';
import type { MotionControlPort } from '../motion/contracts.ts';
import { ChopTile, PointerPreview } from './Surfaces.tsx';
export interface MotionSurfaceProps {
  widget: Widget;
  port: ControlPort;
  motion?: MotionControlPort;
}
function PointerSurface({ motion }: MotionSurfaceProps) {
  return (
    <div className="ctl-motion">
      <span className="ctl-motion__glyph">⊕</span>
      {motion && (
        <PointerPreview previewPoint={() => motion.getSnapshot().point} />
      )}
      Swivel left/right · Tip the top edge up/down
      <small>Push past an edge or tap Recenter to re-center</small>
    </div>
  );
}
function TiltSurface() {
  return (
    <div className="ctl-motion">
      <span className="ctl-motion__glyph">↔</span>Tilt to steer
    </div>
  );
}
function ShakeSurface() {
  return (
    <div className="ctl-motion">
      <span className="ctl-motion__glyph">↯</span>Shake your phone
    </div>
  );
}
function JoltSurface() {
  return (
    <div className="ctl-motion">
      <span className="ctl-motion__glyph">↯</span>Move or turn sharply to send
      an impulse
    </div>
  );
}
function ChopSurface({ widget, port, motion }: MotionSurfaceProps) {
  return <ChopTile label={widget.label} port={port} motion={motion} />;
}
export const motionSurfaces: Partial<
  Record<MotionInput, ComponentType<MotionSurfaceProps>>
> = {
  pointer: PointerSurface,
  tilt: TiltSurface,
  shake: ShakeSurface,
  chop: ChopSurface,
  jolt: JoltSurface,
};
