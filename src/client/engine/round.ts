import {
  prepareAssignments,
  validAssignments,
  validSeed,
  freezeRoundData,
} from './round-setup.ts';
import { timingDuration } from './timing-policy.ts';
import {
  ARBITRATION_MS,
  arbitrationWindow,
  partitionMatureActions,
} from './arbitration.ts';
import type {
  Action,
  GameDescriptor,
  GameInput,
  GameInstance,
  Outcome,
  Player,
  Point,
  PresentationEvent,
  RoundSnapshot,
  RoundTiming,
  ParticipantAssignment,
  ControllerRequirements,
} from '../api/index.ts';
import { SessionProgress } from './progress.ts';
import {
  isJsonValue,
  MAX_ROUND_SNAPSHOT_BYTES,
  snapshotPolicy,
} from './snapshots.ts';

function freeze(value: object): void {
  Object.freeze(value);
  for (const child of Object.values(value))
    if (child && typeof child === 'object') freeze(child);
}

/** Host authority and the standalone harness drive this same lifecycle. */
export class RoundRunner<S extends object = object> {
  phase: 'loading' | RoundSnapshot<S>['phase'] = 'loading';
  error: string | null = null;
  roundId: string | null = null;
  startAt = 0;
  endAt = 0;
  players: Player[] = [];
  loaded = false;
  private assignments: ParticipantAssignment[] = [];
  private seed = 0;
  private prepared = false;
  private readonly game: GameInstance<S>;
  private readonly timing: RoundTiming;
  private loading: Promise<void> | null = null;
  private attemptedLoad = false;
  private disposed = false;
  private gameDisposed = false;
  private finalized = false;
  private previousTick = 0;
  private round: ReturnType<SessionProgress['open']> | null = null;
  private actions: Action[] = [];
  private held: GameInput['values'] = {};
  private events: PresentationEvent[] = [];
  private outcomes: Outcome[] = [];
  private completedSnapshot: RoundSnapshot<S> | null = null;
  constructor(
    readonly descriptor: GameDescriptor<S>,
    private readonly progress: SessionProgress,
    readonly mode = descriptor.defaultMode,
  ) {
    if (!descriptor.modes.some((choice) => choice.id === mode))
      throw new Error(`Unknown mode ${mode} for ${descriptor.id}.`);
    timingDuration(descriptor.timing);
    this.timing = structuredClone(descriptor.timing);
    freeze(this.timing);
    this.game = descriptor.create({ mode });
  }
  load(): void | Promise<void> {
    if (this.loading) return this.loading;
    if (this.attemptedLoad || this.disposed || this.phase !== 'loading') return;
    this.attemptedLoad = true;
    const ready = () => {
      if (this.disposed || this.phase !== 'loading') return;
      if (!this.game.ready())
        throw new Error('Game did not become ready after loading.');
      this.loaded = true;
    };
    try {
      const result = this.game.load();
      if (result && typeof result.then === 'function') {
        this.loading = Promise.resolve(result)
          .then(ready)
          .catch((error: unknown) => {
            if (!this.disposed && this.phase === 'loading') this.fail(error);
          });
        return this.loading;
      }
      ready();
    } catch (error) {
      this.fail(error);
    }
  }
  prepare(
    players: Player[],
    seed: number,
    assignments?: ParticipantAssignment[],
  ): void {
    if (this.prepared || this.disposed || this.phase !== 'loading')
      throw new Error('Round preparation is already closed.');
    if (!validSeed(seed)) throw new Error('Invalid round seed.');
    if (assignments && !validAssignments(assignments, players))
      throw new Error('Invalid prepared assignments.');
    this.assignments = assignments
      ? freezeRoundData(structuredClone(assignments))
      : prepareAssignments(this.descriptor, this.mode, players, seed);
    this.players = structuredClone(players);
    this.seed = seed;
    this.roundId = this.progress.reserveRoundId();
    this.prepared = true;
  }
  getAssignments(): ParticipantAssignment[] {
    return structuredClone(this.assignments);
  }
  requirementsFor(id: string): ControllerRequirements | undefined {
    return this.assignments.find((assignment) => assignment.playerId === id)
      ?.controls;
  }
  roleFor(id: string): string | null {
    return (
      this.assignments.find((assignment) => assignment.playerId === id)?.role ??
      null
    );
  }
  begin(players: Player[], time: number): void {
    if (!this.loaded || this.disposed || this.phase !== 'loading' || this.round)
      throw new Error('Game is not ready to begin.');
    if (
      !Number.isFinite(time) ||
      players.length < this.descriptor.players.min ||
      players.length > this.descriptor.players.max ||
      players.some((p) => !p.connected) ||
      new Set(players.map((p) => p.id)).size !== players.length
    )
      throw new Error('Invalid round participants or start time.');
    if (!this.prepared) this.prepare(players, Math.floor(time + 3000) >>> 0);
    if (
      players.length !== this.players.length ||
      players.some((player, index) => player.id !== this.players[index].id)
    )
      throw new Error('Round participants must match the prepared roster.');
    this.players = this.players.map((player) => ({
      ...player,
      connected: true,
    }));
    this.previousTick = time;
    this.startAt = time + 3000;
    this.endAt = this.startAt + timingDuration(this.timing);
    this.round = this.progress.open(
      this.descriptor.id,
      players.map((p) => p.id),
      { mode: this.mode, players: this.players, roundId: this.roundId! },
    );
    this.roundId = this.round.roundId;
    this.phase = 'countdown';
    const context = {
      mode: this.mode,
      seed: this.seed,
      assignments: structuredClone(this.assignments),
      players: structuredClone(this.players),
      startAt: this.startAt,
      endAt: this.endAt,
    };
    freeze(context);
    try {
      this.game.start(context);
      this.snapshot();
    } catch (error) {
      this.fail(error);
    }
  }
  input(action: Action, receivedAt: number): boolean {
    if (
      !this.active() ||
      !this.players.some((p) => p.id === action.playerId && p.connected) ||
      !Object.hasOwn(
        this.requirementsFor(action.playerId)?.inputs ?? {},
        action.name,
      ) ||
      !Number.isFinite(receivedAt) ||
      receivedAt < this.startAt ||
      receivedAt >= this.endAt + ARBITRATION_MS ||
      !Number.isFinite(action.time) ||
      action.time < this.startAt ||
      action.time >= this.endAt ||
      action.time > receivedAt + 100 ||
      receivedAt - action.time > 2000 ||
      !action.aim ||
      !Number.isFinite(action.aim.x) ||
      !Number.isFinite(action.aim.y) ||
      this.actions.length >= 256 ||
      !isJsonValue(action, 16 * 1024)
    )
      return false;
    this.actions.push(structuredClone(action));
    return true;
  }
  private active(): boolean {
    return (
      !this.disposed &&
      !!this.round &&
      ['countdown', 'running', 'settling'].includes(this.phase)
    );
  }
  tick(
    time: number,
    dt: number,
    values: GameInput['values'],
    presentationDelay: number,
  ): PresentationEvent[] {
    if (
      !this.active() ||
      !Number.isFinite(time) ||
      !Number.isFinite(dt) ||
      dt < 0 ||
      !Number.isFinite(presentationDelay) ||
      presentationDelay < 0
    )
      return [];
    if (time < this.previousTick) return [];
    const previousTick = this.previousTick;
    this.previousTick = time;
    const emitted: PresentationEvent[] = [];
    const rules = (
      phase: GameInput['phase'],
      at: number,
      elapsed: number,
      samples: GameInput['values'],
      actions: Action[],
    ) => {
      const result = this.game.tick({
        phase,
        time: at,
        dt: elapsed,
        presentationDelay,
        values: structuredClone(samples),
        actions: structuredClone(actions),
      });
      if (
        !result ||
        !Array.isArray(result.events) ||
        (result.complete !== undefined && result.complete !== true) ||
        !isJsonValue(result, 32 * 1024)
      )
        throw new Error('Game returned an invalid tick result.');
      this.appendEvents(structuredClone(result.events));
      emitted.push(...structuredClone(result.events));
      // A completion request may only latch after its state and events validate.
      this.snapshot();
      if (this.phase === 'error')
        throw new Error(this.error ?? 'Invalid tick state.');
      if (phase === 'running' && result.complete === true) this.settle(at);
    };
    try {
      if (this.phase === 'countdown' && time >= this.startAt)
        this.phase = 'running';
      if (this.phase === 'running') {
        const activeDt = Math.min(
          dt,
          50,
          Math.max(
            0,
            Math.min(time, this.endAt) - Math.max(previousTick, this.startAt),
          ),
        );
        if (time < this.endAt) {
          const partition = partitionMatureActions(
            this.actions,
            time,
            arbitrationWindow(this.descriptor.arbitrationMs),
          );
          this.actions = partition.pending;
          this.held = Object.fromEntries(
            this.players
              .filter((p) => p.connected)
              .map((p) => [
                p.id,
                Object.fromEntries(
                  Object.entries(values[p.id] ?? {}).filter(
                    ([name, sample]) =>
                      Object.hasOwn(
                        this.requirementsFor(p.id)?.inputs ?? {},
                        name,
                      ) &&
                      Number.isFinite(sample.time) &&
                      sample.time < this.endAt &&
                      sample.time <= time + 100 &&
                      (sample.observedAt === undefined ||
                        (Number.isFinite(sample.observedAt) &&
                          sample.observedAt <= time + 100)) &&
                      isJsonValue(sample),
                  ),
                ),
              ]),
          );
          rules(
            'running',
            time,
            activeDt,
            this.held,
            partition.mature.sort((a, b) => a.time - b.time),
          );
        } else {
          if (activeDt > 0)
            rules('running', this.endAt, activeDt, this.held, []);
          this.settle(this.endAt);
        }
      }
      if (
        this.phase === 'settling' &&
        time >= this.endAt + ARBITRATION_MS &&
        !this.finalized
      ) {
        const actions = this.actions.sort((a, b) => a.time - b.time);
        this.actions = [];
        rules('settling', time, 0, {}, actions);
        this.finalized = true;
        const outcomes = structuredClone(this.game.finalize());
        const finalState = structuredClone(this.game.snapshot());
        emitted.push({
          id: `${this.roundId}:end`,
          kind: 'end',
          clock: 'presentation',
          time,
        });
        this.appendEvents(emitted);
        // Validate the complete candidate envelope before committing points.
        const candidate = this.envelope(finalState, outcomes, 'results', {});
        const awards = Object.fromEntries(
          outcomes.map((outcome) => [
            outcome.playerId,
            outcomes.filter((other) => other.placement > outcome.placement)
              .length,
          ]),
        );
        candidate.progress = {
          revision: candidate.progress.revision + 1,
          awards,
          totals: Object.fromEntries(
            Object.entries(candidate.progress.totals).map(([id, total]) => [
              id,
              total + (awards[id] ?? 0),
            ]),
          ),
        };
        // A final snapshot is later decorated with cursors. Reserve their full
        // encoded size now, while failure can still abort without awarding points.
        const cursorReserve =
          new TextEncoder().encode(
            JSON.stringify(
              Object.fromEntries(
                this.players.map((player) => [
                  player.id,
                  { x: '0'.repeat(64), y: '0'.repeat(64) },
                ]),
              ),
            ),
          ).byteLength - 2; // Replace the candidate's empty {} cursor map.
        if (
          !snapshotPolicy(this.descriptor).valid(candidate) ||
          !isJsonValue(candidate, MAX_ROUND_SNAPSHOT_BYTES - cursorReserve)
        )
          throw new Error(
            'Game returned an invalid final snapshot or outcomes.',
          );
        if (this.round!.complete(outcomes) !== 'accepted')
          throw new Error('Game returned invalid final outcomes.');
        this.outcomes = outcomes;
        candidate.progress = this.progress.compact(
          this.players.map((player) => player.id),
          this.roundId!,
        );
        this.completedSnapshot = structuredClone(candidate);
        this.phase = 'results';
        this.disposeGame();
      }
      this.appendEvents(emitted);
      // Invalid tick state must become an error before it can leave the authority.
      this.snapshot();
      return this.phase === 'error' ? [] : emitted;
    } catch (error) {
      this.fail(error);
      return [];
    }
  }
  private settle(at: number): void {
    if (this.phase !== 'running') return;
    this.endAt = Math.min(at, this.endAt);
    this.actions = this.actions.filter((action) => action.time < this.endAt);
    this.held = {};
    this.phase = 'settling';
  }
  private appendEvents(events: PresentationEvent[]): void {
    const byId = new Map(this.events.map((event) => [event.id, event]));
    for (const event of events) {
      if (
        !isJsonValue(event, 4096) ||
        !event.id ||
        !Number.isFinite(event.time) ||
        !['presentation', 'authority'].includes(event.clock)
      )
        throw new Error('Game returned an invalid presentation event.');
      byId.set(event.id, event);
    }
    this.events = [...byId.values()].slice(-128);
  }
  clearInput(id: string, time: number): void {
    if (time >= this.endAt) return;
    this.actions = this.actions.filter((action) => action.playerId !== id);
    const held = { ...this.held };
    delete held[id];
    this.held = held;
  }
  connection(id: string, connected: boolean, time: number): void {
    const player = this.players.find((p) => p.id === id);
    if (!player || player.connected === connected || !this.active()) return;
    player.connected = connected;
    if (time >= this.endAt) return;
    try {
      if (connected) this.game.reconnect(id);
      else {
        this.clearInput(id, time);
        this.game.disconnect(id, time);
      }
    } catch (error) {
      this.fail(error);
    }
  }
  abort(reason?: string): void {
    if (this.disposed || ['results', 'aborted', 'error'].includes(this.phase))
      return;
    this.round?.abort();
    if (!this.round && this.roundId) this.progress.releaseRoundId(this.roundId);
    this.actions = [];
    this.held = {};
    this.phase = 'aborted';
    if (reason) this.error = reason.slice(0, 2000);
    this.disposeGame();
  }
  private fail(error: unknown): void {
    this.error = (error instanceof Error ? error.message : String(error)).slice(
      0,
      2000,
    );
    this.round?.abort();
    if (!this.round && this.roundId) this.progress.releaseRoundId(this.roundId);
    this.actions = [];
    this.held = {};
    this.phase = 'error';
    this.events = [];
    this.disposeGame();
  }
  private cursorView(cursors: Record<string, Point>): Record<string, Point> {
    return Object.fromEntries(
      Object.entries(cursors)
        .filter(
          ([id, point]) =>
            this.players.some(
              (player) => player.id === id && player.connected,
            ) &&
            point &&
            Number.isFinite(point.x) &&
            Number.isFinite(point.y),
        )
        .map(([id, point]) => [id, { x: point.x, y: point.y }]),
    );
  }
  private envelope(
    state: S | null,
    outcomes: Outcome[],
    phase: RoundSnapshot<S>['phase'],
    cursors: Record<string, Point>,
  ): RoundSnapshot<S> {
    return {
      schemaVersion: 2,
      timing: structuredClone(this.timing),
      seed: this.seed,
      assignments: this.getAssignments(),
      roundId: this.roundId!,
      gameId: this.descriptor.id,
      mode: this.mode,
      phase,
      startAt: this.startAt,
      endAt: this.endAt,
      players: structuredClone(this.players),
      state,
      cursors: this.cursorView(cursors),
      events: structuredClone(this.events),
      outcomes: structuredClone(outcomes),
      progress: this.progress.compact(
        this.players.map((p) => p.id),
        this.roundId!,
      ),
      error: this.error,
    };
  }
  snapshot(cursors: Record<string, Point> = {}): RoundSnapshot<S> | null {
    if (!this.roundId || this.phase === 'loading') return null;
    if (this.phase === 'results' && this.completedSnapshot) {
      // The completed envelope was validated before commit with cursor headroom.
      // Do not re-enter game code or change terminal status after awarding points.
      return {
        ...structuredClone(this.completedSnapshot),
        cursors: this.cursorView(cursors),
      };
    }
    if (this.phase === 'error' || this.phase === 'aborted')
      return this.envelope(null, [], this.phase, {});
    try {
      const snapshot = this.envelope(
        structuredClone(this.game.snapshot()),
        this.outcomes,
        this.phase,
        cursors,
      );
      if (!snapshotPolicy(this.descriptor).valid(snapshot))
        throw new Error('Game returned an invalid snapshot.');
      return snapshot;
    } catch (error) {
      this.fail(error);
      return this.envelope(null, [], 'error', {});
    }
  }
  private disposeGame(): void {
    if (this.gameDisposed) return;
    this.gameDisposed = true;
    try {
      this.game.dispose();
    } catch (error) {
      if (!this.error && this.phase !== 'results')
        this.error = String(error).slice(0, 2000);
    }
  }
  dispose(): void {
    if (this.disposed) return;
    this.abort();
    this.disposed = true;
    this.disposeGame();
  }
}
