import assert from 'node:assert/strict';
import test from 'node:test';
import { Diagnostics } from '../src/client/runtime/diagnostics/diagnostics.ts';
import type { DiagnosticSnapshot } from '../src/client/runtime/diagnostics/contracts.ts';
import type { LinkStats } from '../src/client/transport/contracts.ts';

function fixture() {
  const pending: ((links: Record<string, LinkStats>) => void)[] = [];
  const published: unknown[] = [];
  const source: DiagnosticSnapshot = {
    identity: {
      role: 'controller',
      hostId: 'host',
      venueId: 'venue',
      room: 'TEST',
    },
    clock: { offset: 3, error: Infinity, rtt: { p50: 5 } },
    sensorHz: 60,
    pointer: { gain: 2, recenters: 1 },
    path: 'direct-to-session',
    metrics: {
      oneWay: { p50: 10 },
      lastBytes: 30,
      deltaRatio: 0.5,
      starvations: 0,
    },
    completed: [{ roundId: 'complete' }],
    progress: { revision: 1, totals: { a: 3 } },
    authority: { rounds: 1 },
  };
  const diagnostics = new Diagnostics({
    stats: () => new Promise((resolve) => pending.push(resolve)),
    snapshot: () => source,
    publish: (links, message) => published.push({ links, message }),
  });
  return { diagnostics, pending, published, source };
}
void test('late, superseded and retired statistics cannot publish', async () => {
  const h = fixture();
  const a = h.diagnostics.poll(),
    b = h.diagnostics.poll();
  h.pending[1]({ host: { path: 'P2P', rtt: 8 } });
  await b;
  h.pending[0]({ host: { path: 'P2P', rtt: 99 } });
  await a;
  assert.equal(h.published.length, 1);
  const c = h.diagnostics.poll();
  h.diagnostics.disconnect('Reconnecting…', 123);
  h.pending[2]({});
  await c;
  assert.equal(h.published.length, 1);
  const d = h.diagnostics.poll();
  h.diagnostics.dispose();
  h.pending[3]({});
  await d;
  await h.diagnostics.poll();
  assert.equal(h.pending.length, 4);
  assert.equal(h.published.length, 1);
});
void test('reports preserve version-two fields, remain detached and retain completion after disposal', async () => {
  const h = fixture();
  h.diagnostics.acceptTelemetry({ type: 'telemetry', players: [] });
  h.diagnostics.setPanelLatency(12);
  const poll = h.diagnostics.poll();
  h.pending[0]({ host: { path: 'P2P', rtt: 8 } });
  await poll;
  assert.deepEqual(h.published[0], {
    links: { host: { path: 'P2P', rtt: 8 } },
    message: {
      type: 'clockStats',
      offset: 3,
      error: null,
      rtt: { p50: 5 },
      sensorHz: 60,
      pointerGain: 2,
      recenters: 1,
      transport: { path: 'P2P', rtt: 8 },
      path: 'direct-to-session',
    },
  });
  h.diagnostics.dispose();
  const report = h.diagnostics.report('fixed');
  assert.equal(report.version, 2);
  assert.equal(report.at, 'fixed');
  assert.equal(report.motionToPhotonCameraMs, 12);
  assert.deepEqual(report.completed, [{ roundId: 'complete' }]);
  assert.deepEqual(report.snapshots, {
    delay: { p50: 10 },
    lastBytes: 30,
    deltaRatio: 0.5,
    starvations: 0,
  });
  report.links.host.rtt = 99;
  report.pointer.gain = 99;
  assert.equal(h.diagnostics.report().links.host.rtt, 8);
  assert.equal(h.source.pointer.gain, 2);
});
