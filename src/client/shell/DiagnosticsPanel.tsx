'use client';
import { Input } from '@/components/ui/input';
import type { ShellView, RoomActions } from './ports.ts';

export function DiagnosticsPanel({
  view: v,
  actions,
}: {
  view: ShellView;
  actions: RoomActions;
}) {
  const t = v.diagnostics;
  return (
    <section className="hud">
      <h2>Path A · Phone → this screen</h2>
      <p>
        Software measurements exclude sensor and panel delay. A P2P route is not
        proof of LAN locality.
      </p>
      <table>
        <thead>
          <tr>
            <th>Peer</th>
            <th>Transport</th>
            <th>ICE types</th>
            <th>RTT</th>
          </tr>
        </thead>
        <tbody>
          {Object.entries(t.links).map(([id, l]) => (
            <tr key={id}>
              <td>
                {v.roster.players.find((p) => p.id === id)?.name ??
                  v.roster.venues.find((p) => p.id === id)?.name ??
                  id.slice(0, 6)}
              </td>
              <td>{l.path}</td>
              <td>
                {l.localCandidate ?? '—'} / {l.remoteCandidate ?? '—'}
              </td>
              <td>{l.rtt == null ? '—' : `${l.rtt.toFixed(1)} ms`}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <h2>Path B · Phone → authority</h2>
      <table>
        <thead>
          <tr>
            <th>Player</th>
            <th>Hz</th>
            <th>Loss</th>
            <th>Age</th>
            <th>p50 / p95 / p99</th>
            <th>Jitter</th>
            <th>Buffer / extrapolation</th>
            <th>Clock error</th>
            <th>Fallback</th>
          </tr>
        </thead>
        <tbody>
          {t?.players?.map((p) => (
            <tr key={p.id}>
              <td>{p.name}</td>
              <td>{p.hz.toFixed(0)}</td>
              <td>{(p.loss * 100).toFixed(1)}%</td>
              <td>{p.age?.toFixed(0) ?? '—'} ms</td>
              <td>
                {p.delay
                  ? [p.delay.p50, p.delay.p95, p.delay.p99]
                      .map((x: number) => x.toFixed(1))
                      .join(' / ')
                  : '—'}
              </td>
              <td>{p.delay?.jitter.toFixed(1) ?? '—'}</td>
              <td>
                {p.buffer.toFixed(1)} / {p.horizon.toFixed(1)} ms
              </td>
              <td>{p.clock?.error?.toFixed(1) ?? '—'} ms</td>
              <td>{p.substitutions.join(', ') || 'none'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p>
        D = {v.D.toFixed(1)} ms · Limiting venue:{' '}
        {v.roster.venues.find((x) => x.id === v.limitingVenue)?.name ??
          'single venue'}{' '}
        · Snapshot starvation events: {t.snapshots.starvations}
      </p>
      <p>
        Last prompt’s software presentation spread:{' '}
        {t?.presentationSpreadMs == null
          ? 'waiting for every screen'
          : `${Number(t.presentationSpreadMs).toFixed(1)} ms`}
        . This excludes panel/compositor delay.
      </p>
      <p>
        Snapshot bytes: {t.snapshots.lastBytes} · Delta/full ratio:{' '}
        {t.snapshots.deltaRatio?.toFixed(2) ?? '—'} · Downstream p95:{' '}
        {t.snapshots.oneWay.p95.toFixed(1)} ms
      </p>
      <table>
        <thead>
          <tr>
            <th>Player</th>
            <th>Control RTT p50 / p95 / p99</th>
            <th>Clock offset</th>
            <th>Pointer confidence</th>
            <th>Sensor Hz</th>
            <th>Recenters</th>
            <th>Controller path</th>
          </tr>
        </thead>
        <tbody>
          {t?.players?.map((p) => (
            <tr key={p.id}>
              <td>{p.name}</td>
              <td>
                {p.clock?.rtt
                  ? [p.clock.rtt.p50, p.clock.rtt.p95, p.clock.rtt.p99]
                      .map((n: number) => n.toFixed(1))
                      .join(' / ')
                  : '—'}
              </td>
              <td>{p.clock?.offset?.toFixed(1) ?? '—'} ms</td>
              <td>{Math.round(p.confidence * 100)}%</td>
              <td>{p.clock?.sensorHz?.toFixed(0) ?? '—'}</td>
              <td>{p.clock?.recenters ?? 0}</td>
              <td>{p.clock?.path ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p>
        Panel latency / Game Mode: unmeasured. Record camera ground truth below;
        this cannot be detected from browser timers.
      </p>
      <label className="field" htmlFor="panel-latency">
        Camera-measured motion-to-photon (ms)
        <Input
          id="panel-latency"
          type="number"
          min={0}
          max={2000}
          placeholder="Not measured"
          value={v.panelLatency ?? ''}
          onChange={(e) =>
            actions.setPanelLatency(
              e.target.value ? Number(e.target.value) : null,
            )
          }
        />
      </label>
    </section>
  );
}
