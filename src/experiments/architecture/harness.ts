import { SnapshotEncoder, SnapshotTimeline } from '../../core/snapshots.ts';
import { channelOf, usesPressSlot } from '../../controls/registry.ts';
import type { ControllerConfig } from '../../controls/api.ts';
import type { WireSnapshot } from '../../core/types.ts';
import type {
  Action,
  GameDescriptor,
  GameInput,
  Player,
  Point,
  Progress,
  RoundSnapshot,
} from './api.ts';
import { resolveController } from '../../client/engine/input.ts';
import { capabilityProfile } from './input.ts';
import { SessionProgress } from '../../client/engine/progress.ts';
import { RoundRunner } from '../../client/engine/round.ts';
import { snapshotPolicy } from '../../client/engine/snapshots.ts';
export { snapshotPolicy } from '../../client/engine/snapshots.ts';

export const simulatedPlayers: Player[] = [
  {
    id: 'ada',
    venueId: 'host',
    seat: 0,
    name: 'Ada',
    color: '#b6ff65',
    connected: true,
  },
  {
    id: 'bea',
    venueId: 'remote',
    seat: 1,
    name: 'Bea',
    color: '#74d9ff',
    connected: true,
  },
  {
    id: 'cy',
    venueId: 'remote',
    seat: 2,
    name: 'Cy',
    color: '#ff91bc',
    connected: true,
  },
];
export interface HarnessOptions {
  players?: Player[];
  progress?: SessionProgress;
  motion?: boolean;
  mode?: string;
  presentationDelay?: number;
  remoteDelay?: number;
}
/** Fake clock/input and two displays around the production round engine. */
export class GameHarness<S extends object = object> {
  readonly configs: Readonly<Record<string, ControllerConfig>>;
  readonly presentationDelay: number;
  readonly remoteDelay: number;
  time = 0;
  private readonly initialPlayers: Player[];
  private readonly runner: RoundRunner<S>;
  private readonly progress: SessionProgress;
  private readonly encoder = new SnapshotEncoder<RoundSnapshot<S>>();
  private readonly displays: Record<
    'host' | 'remote',
    SnapshotTimeline<RoundSnapshot<S>>
  >;
  private deliveries: { at: number; wire: WireSnapshot<RoundSnapshot<S>> }[] =
    [];
  private values: Record<
    string,
    Record<string, GameInput['values'][string][string]>
  > = {};
  private local: Record<string, Point> = {};
  private loading: Promise<void> | null = null;
  private disposed = false;
  private snapshotId = 0;
  private lastSnapshotAt = -40;
  constructor(
    readonly descriptor: GameDescriptor<S>,
    options: HarnessOptions = {},
  ) {
    this.initialPlayers = structuredClone(options.players ?? simulatedPlayers);
    if (
      this.initialPlayers.length < descriptor.players.min ||
      this.initialPlayers.length > descriptor.players.max
    )
      throw new Error(
        `${descriptor.name} needs ${descriptor.players.min}–${descriptor.players.max} players.`,
      );
    this.presentationDelay = options.presentationDelay ?? 160;
    this.remoteDelay = options.remoteDelay ?? 80;
    if (
      !Number.isFinite(this.remoteDelay) ||
      !Number.isFinite(this.presentationDelay) ||
      this.remoteDelay < 0 ||
      this.presentationDelay < this.remoteDelay + 40
    )
      throw new Error(
        'Presentation delay must cover the remote delay plus one snapshot interval.',
      );
    this.configs = Object.fromEntries(
      this.initialPlayers.map((player) => [
        player.id,
        resolveController(
          descriptor,
          capabilityProfile(options.motion ?? false),
        ),
      ]),
    );
    this.progress = options.progress ?? new SessionProgress();
    this.runner = new RoundRunner(descriptor, this.progress, options.mode);
    this.displays = {
      host: new SnapshotTimeline(snapshotPolicy(descriptor)),
      remote: new SnapshotTimeline(snapshotPolicy(descriptor)),
    };
  }
  get players(): Player[] {
    return this.runner.roundId ? this.runner.players : this.initialPlayers;
  }
  get roundId(): string | null {
    return this.runner.roundId;
  }
  get phase() {
    return this.runner.phase;
  }
  get error() {
    return this.runner.error;
  }
  get startAt() {
    return this.runner.roundId ? this.runner.startAt : 3000;
  }
  get endAt() {
    return this.runner.roundId
      ? this.runner.endAt
      : 3000 + this.descriptor.durationMs;
  }
  load(): Promise<void> {
    this.loading ??= Promise.resolve(this.runner.load()).then(() => {
      if (
        this.disposed ||
        !this.runner.loaded ||
        this.runner.phase !== 'loading'
      )
        return;
      this.runner.begin(this.initialPlayers, this.time);
      this.publish();
    });
    return this.loading;
  }
  setValue(playerId: string, name: string, value: unknown) {
    if (
      this.disposed ||
      !this.runner.loaded ||
      !['countdown', 'running'].includes(this.phase) ||
      this.time >= this.endAt ||
      !this.players.some((p) => p.id === playerId && p.connected)
    )
      return;
    const widget = this.configs[playerId]?.widgets.find(
      (w) => w.action === name,
    );
    if (!widget) return;
    (this.values[playerId] ??= {})[name] = {
      value: structuredClone(value),
      time: this.time,
    };
    if (
      widget.space === 'normalized' &&
      value &&
      typeof value === 'object' &&
      'x' in value &&
      'y' in value &&
      typeof value.x === 'number' &&
      typeof value.y === 'number' &&
      Number.isFinite(value.x) &&
      Number.isFinite(value.y)
    )
      this.local[playerId] = { x: value.x, y: value.y };
  }
  press(
    playerId: string,
    name: string,
    time = this.time,
    aim = this.local[playerId] ?? { x: 0.5, y: 0.5 },
  ) {
    const widget = this.configs[playerId]?.widgets.find(
      (w) => w.action === name && usesPressSlot(w.type),
    );
    if (!widget) return;
    const action: Action = { playerId, name, time, aim: { ...aim } };
    if (channelOf(widget.type).channel === 'both') {
      const value = this.values[playerId]?.[name]?.value;
      if (value !== undefined) action.value = structuredClone(value);
    }
    this.runner.input(action, this.time);
  }
  advance(milliseconds: number, drive?: (harness: GameHarness<S>) => void) {
    if (!this.runner.loaded || this.disposed) return;
    if (
      !Number.isFinite(milliseconds) ||
      milliseconds < 0 ||
      milliseconds > 120000
    )
      throw new Error('Advance must be between 0 and 120000 milliseconds.');
    const end = this.time + milliseconds;
    while (this.time < end) {
      const dt = Math.min(20, end - this.time);
      this.time += dt;
      const previous = this.phase;
      drive?.(this);
      // A connected simulated controller keeps sending the held value, like the
      // live binary heartbeat. Capture time remains the original control sample.
      for (const [id, values] of Object.entries(this.values)) {
        if (
          !this.players.some((player) => player.id === id && player.connected)
        )
          continue;
        for (const sample of Object.values(values))
          sample.observedAt = this.time;
      }
      this.runner.tick(this.time, dt, this.values, this.presentationDelay);
      if (previous !== this.phase || this.time - this.lastSnapshotAt >= 40)
        this.publish();
      this.deliver();
    }
  }
  private publish() {
    const state = this.runner.snapshot(this.local);
    if (!state) return;
    const snapshot = { id: ++this.snapshotId, time: this.time, state };
    this.encoder.add(snapshot);
    const host = this.encoder.forPeer('host', snapshot);
    if (this.displays.host.receive(structuredClone(host)))
      this.encoder.ack('host', host.id);
    this.deliveries.push({
      at: this.time + this.remoteDelay,
      wire: this.encoder.forPeer('remote', snapshot),
    });
    this.lastSnapshotAt = this.time;
    this.deliver();
  }
  private deliver() {
    const due = this.deliveries.filter((delivery) => delivery.at <= this.time);
    this.deliveries = this.deliveries.filter(
      (delivery) => delivery.at > this.time,
    );
    for (const { wire } of due) {
      if (this.displays.remote.receive(structuredClone(wire)))
        this.encoder.ack('remote', wire.id);
      else this.encoder.acks.delete('remote');
    }
  }
  display(id: 'host' | 'remote'): RoundSnapshot<S> | null {
    return this.displays[id].sample(this.time - this.presentationDelay);
  }
  localCursors(venueId: string): Record<string, Point> {
    return Object.fromEntries(
      this.players
        .filter((p) => p.connected && p.venueId === venueId && this.local[p.id])
        .map((p) => [p.id, { ...this.local[p.id] }]),
    );
  }
  progressView(): Progress {
    return this.progress.view();
  }
  disconnect(id: string) {
    delete this.values[id];
    delete this.local[id];
    this.runner.connection(id, false, this.time);
  }
  reconnect(id: string) {
    this.runner.connection(id, true, this.time);
  }
  abort() {
    this.runner.abort();
    this.publish();
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.runner.dispose();
    this.deliveries = [];
  }
}
