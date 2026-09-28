'use client';
import { useState } from 'react';
import { ControllerSurface } from '../../../controls/ControllerSurface.tsx';
import {
  PreviewPorts,
  exportProbeLayout,
  probeLayout,
  probeWidgets,
  type ProbeReadings,
} from './controller-fixture.ts';

/** The production control views render unchanged through a local ControlPort. */
export function ControllerProbe() {
  const [readings, setReadings] = useState<ProbeReadings>(() =>
      new PreviewPorts(probeWidgets).readings(),
    ),
    [ports] = useState(() => new PreviewPorts(probeWidgets, setReadings));
  return (
    <section className="architecture-controller-probe ctl-scope">
      <h2>Controller boundary probe</h2>
      <p>Two independent sticks and two buttons from the existing library.</p>
      <div className="architecture-controller-probe__layout">
        <ControllerSurface
          widgets={probeWidgets}
          accent="#67e8f9"
          portFor={ports.portFor}
        />
      </div>
      <button type="button" onClick={() => ports.releaseAll()}>
        Release all inputs
      </button>
      <dl className="architecture-controller-probe__readings">
        {Object.entries(readings).map(([action, reading]) => (
          <div key={action}>
            <dt>{action}</dt>
            <dd>
              {reading.value === undefined
                ? '—'
                : JSON.stringify(reading.value)}
              {' · '}
              {reading.held ? 'held' : 'released'}
              {' · '}
              {reading.activations} activations
            </dd>
          </div>
        ))}
      </dl>
      <details>
        <summary>Layout JSON</summary>
        <pre>{exportProbeLayout(probeLayout)}</pre>
      </details>
    </section>
  );
}
