import type { Manifest, Widget } from '../../core/types.ts';
import { definitionFor } from '../../controls/registry.ts';
import type { ControlPort } from '../../controls/types.ts';
import {
  isControllerLayout,
  type ControllerLayout,
} from '../../controls/layout/schema.ts';
import {
  checkAssignment,
  validateLayout,
} from '../../controls/layout/validate.ts';
import { layoutWidgets } from '../../controls/layout/widgets.ts';

/** Four independent actions, built entirely from the existing control library. */
export const probeLayout: ControllerLayout = {
  schemaVersion: 2,
  id: 'architecture-four-controls',
  name: 'Two sticks and two actions',
  orientation: 'portrait',
  grid: { cols: 12, rows: 24 },
  menu: 'top-right',
  motion: { pointer: false, tilt: false, shake: false },
  items: [
    {
      name: 'move',
      type: 'stick',
      rect: { x: 0, y: 4, w: 6, h: 8 },
      rotation: 0,
      label: 'Move',
      props: { hint: 'Independent movement vector', floating: false },
    },
    {
      name: 'look',
      type: 'stick',
      rect: { x: 6, y: 4, w: 6, h: 8 },
      rotation: 0,
      label: 'Look',
      props: { hint: 'Independent look vector', floating: false },
    },
    {
      name: 'fire',
      type: 'button',
      rect: { x: 0, y: 14, w: 6, h: 6 },
      rotation: 0,
      label: 'Fire',
      variant: 'accent',
      props: { icon: 'fire', hint: 'Existing button, fire presentation' },
    },
    {
      name: 'cancel',
      type: 'button',
      rect: { x: 6, y: 14, w: 6, h: 6 },
      rotation: 0,
      label: 'Cancel',
      variant: 'danger',
      props: { hint: 'Existing button, cancel presentation' },
    },
  ],
};

export const probeAssignment: Pick<Manifest, 'inputs' | 'controller'> = {
  inputs: {
    move: { required: true, prefer: 'stick' },
    look: { required: true, prefer: 'stick' },
    fire: { required: true, prefer: 'button' },
    cancel: { required: true, prefer: 'button' },
  },
  controller: { layout: probeLayout.id },
};

function checkedLayout(value: unknown): ControllerLayout {
  if (!isControllerLayout(value)) throw new Error('Invalid layout structure.');
  const issues = [
    ...validateLayout(value),
    ...checkAssignment(probeAssignment, value),
  ];
  if (issues.length)
    throw new Error(issues.map((issue) => issue.message).join(' '));
  return structuredClone(value);
}

/** Uses the same JSON schema, geometry and binding checks as production tools. */
export function importProbeLayout(json: string): ControllerLayout {
  return checkedLayout(JSON.parse(json) as unknown);
}

export function exportProbeLayout(layout: ControllerLayout): string {
  return JSON.stringify(checkedLayout(layout), null, 2);
}

export const probeWidgets = layoutWidgets(probeLayout);

export interface ProbeReading {
  value?: unknown;
  held: boolean;
  activations: number;
}

export type ProbeReadings = Record<string, ProbeReading>;

/** Local preview adapter. It owns no runtime, connection, sensor, or packet. */
export class PreviewPorts {
  private current: ProbeReadings = {};
  private ports = new Map<string, ControlPort>();
  private vectors = new Set<string>();

  constructor(
    widgets: readonly Widget[],
    private changed: (readings: ProbeReadings) => void = () => {},
  ) {
    for (const widget of widgets) {
      if (this.ports.has(widget.action))
        throw new Error(`Duplicate action: ${widget.action}`);
      const vector = definitionFor(widget.type)?.kind === 'vector';
      if (vector) this.vectors.add(widget.action);
      this.current[widget.action] = {
        ...(vector ? { value: { x: 0, y: 0 } } : {}),
        held: false,
        activations: 0,
      };
      this.ports.set(widget.action, {
        value: (value) => {
          this.current[widget.action].value = structuredClone(value);
          this.changed(this.readings());
        },
        press: (down) => {
          const reading = this.current[widget.action];
          if (down && !reading.held) reading.activations++;
          reading.held = down;
          this.changed(this.readings());
        },
        // The preview has no device side effects.
        haptic: () => {},
      });
    }
  }

  portFor = (widget: Widget): ControlPort => {
    const port = this.ports.get(widget.action);
    if (!port) throw new Error(`Unknown action: ${widget.action}`);
    return port;
  };

  readings(): ProbeReadings {
    return structuredClone(this.current);
  }

  /** Simulates loss of focus/unmount: release buttons and neutralize vectors. */
  releaseAll(): void {
    for (const [action, reading] of Object.entries(this.current)) {
      reading.held = false;
      if (this.vectors.has(action)) reading.value = { x: 0, y: 0 };
    }
    this.changed(this.readings());
  }
}
