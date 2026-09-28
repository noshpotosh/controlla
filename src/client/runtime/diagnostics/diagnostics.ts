import type { Message } from '../../engine/messages.ts';
import type { LinkStats } from '../../transport/contracts.ts';
import type { DiagnosticPorts } from './contracts.ts';

/** Observation only: snapshots never sample presentation or advance input. */
export class Diagnostics {
  private terminal = false;
  private epoch = 0;
  private request = 0;
  private links: Record<string, LinkStats> = {};
  private telemetry: Message | null = null;
  private panelLatency: number | null = null;
  private disconnects: { at: number; status: string }[] = [];
  constructor(private readonly ports: DiagnosticPorts) {}
  invalidate() {
    this.epoch++;
  }
  disconnect(status: string, at: number) {
    if (this.terminal) return;
    this.invalidate();
    this.disconnects.push({ at, status });
  }
  acceptTelemetry(message: Message) {
    if (!this.terminal) this.telemetry = structuredClone(message);
  }
  setPanelLatency(value: number | null) {
    this.panelLatency = value;
  }
  async poll() {
    if (this.terminal) return;
    const epoch = this.epoch,
      request = ++this.request;
    let links: Record<string, LinkStats>;
    try {
      links = await this.ports.stats();
    } catch {
      return;
    }
    if (this.terminal || epoch !== this.epoch || request !== this.request)
      return;
    this.links = structuredClone(links);
    const sample = this.ports.snapshot();
    const identity = sample.identity;
    this.ports.publish(
      structuredClone(this.links),
      identity?.role === 'controller'
        ? {
            type: 'clockStats',
            offset: sample.clock.offset,
            error: Number.isFinite(sample.clock.error)
              ? sample.clock.error
              : null,
            rtt: sample.clock.rtt,
            sensorHz: sample.sensorHz,
            pointerGain: sample.pointer.gain,
            recenters: sample.pointer.recenters,
            transport:
              this.links[
                sample.path === 'direct-to-session'
                  ? identity.hostId
                  : identity.venueId
              ] ?? null,
            path: sample.path,
          }
        : null,
    );
  }
  report(at = new Date().toISOString()) {
    const sample = this.ports.snapshot(),
      metrics = sample.metrics;
    return structuredClone({
      version: 2,
      at,
      room: sample.identity?.room,
      softwareOnly: true,
      motionToPhotonCameraMs: this.panelLatency,
      snapshots: {
        delay: metrics.oneWay,
        lastBytes: metrics.lastBytes,
        deltaRatio: metrics.deltaRatio,
        starvations: metrics.starvations,
      },
      telemetry: this.telemetry,
      links: this.links,
      disconnects: this.disconnects,
      pointer: sample.pointer,
      completed: sample.completed,
      progress: sample.progress,
      authority: sample.authority,
    });
  }
  dispose() {
    this.terminal = true;
    this.invalidate();
  }
}
