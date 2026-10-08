'use client';
import { useState, type ComponentType } from 'react';
import type { ControllerConfig, MotionInput, Widget } from '../api.ts';
import type { MotionControlPort } from '../motion/contracts.ts';
import { motionDefinitionFor } from '../motion/metadata-registry.ts';
import { RecenterButton } from '../kit/RecenterButton.tsx';
export interface MotionSettingsProps {
  widget: Widget;
  motion: MotionControlPort;
}
function PointerSettings({ motion }: MotionSettingsProps) {
  const [sensitivity, setSensitivity] = useState(
    () =>
      motion.getSnapshot().settings?.sensitivity ??
      motionDefinitionFor('pointer')!.settings!.sensitivity!.default,
  );
  const range = motionDefinitionFor('pointer')!.settings!.sensitivity!;
  return (
    <section className="ctl-settings">
      <span className="eyebrow lime">AIM SETTINGS</span>
      <h1>Adjust your aim.</h1>
      <p>
        Hold your phone flat like a remote, screen facing up. Swivel its top
        edge left or right to move sideways; tip the top edge up or down to move
        vertically. Slow turns are precise; quick flicks go further. Push past
        an edge to re-center.
      </p>
      <label className="ctl-settings__range">
        Sensitivity
        <input
          type="range"
          min={range.min}
          max={range.max}
          step={range.step}
          value={sensitivity}
          onChange={(event) => {
            const value = Number(event.target.value);
            motion.command({ type: 'sensitivity', value });
            setSensitivity(
              motion.getSnapshot().settings?.sensitivity ?? sensitivity,
            );
          }}
        />
      </label>
      <div className="ctl-settings__ends">
        <span>More movement</span>
        <span>Less movement</span>
      </div>
      <button
        type="button"
        onClick={() => motion.command({ type: 'recenter' })}
      >
        Recenter
      </button>
    </section>
  );
}
export const motionSettings: Partial<
  Record<MotionInput, ComponentType<MotionSettingsProps>>
> = {
  pointer: PointerSettings,
};
export function hasControllerSettings(config: ControllerConfig | null) {
  return !!config?.widgets.some(
    (widget) => motionSettings[widget.type as MotionInput],
  );
}
export function ControllerSettings({
  config,
  motionPortFor,
  onClose,
}: {
  config: ControllerConfig;
  motionPortFor(this: void, widget: Widget): MotionControlPort;
  onClose(this: void): void;
}) {
  return (
    <div className="ctl-settings-panel">
      {config.widgets.map((widget) => {
        const Settings = motionSettings[widget.type as MotionInput];
        return Settings ? (
          <Settings
            key={widget.id}
            widget={widget}
            motion={motionPortFor(widget)}
          />
        ) : null;
      })}
      <button type="button" className="ctl-settings__done" onClick={onClose}>
        Done
      </button>
    </div>
  );
}
export function ControllerCalibration({
  config,
  motionPortFor,
}: {
  config: ControllerConfig | null;
  motionPortFor(this: void, widget: Widget): MotionControlPort;
}) {
  const widget = config?.widgets.find(
    (candidate) => motionDefinitionFor(candidate.type)?.calibration?.recenter,
  );
  return config && widget ? (
    <RecenterButton
      corner={config.menu}
      orientation={config.orientation}
      onRecenter={() => motionPortFor(widget).command({ type: 'recenter' })}
    />
  ) : null;
}
