import type {
  PlaybackPhaseInput,
  PlaybackPhase,
  PlaybackEffects,
} from './contracts.ts';
import { CursorPlayback } from './cursor-playback.ts';
import { ProgressAssembler } from '../../engine/history.ts';
import { completedResults } from '../../engine/progress.ts';
import type { Message } from '../../engine/messages.ts';
import type { Progress } from '../../api/index.ts';
import type {
  PresentationEvent,
  ReadonlyDeep,
  RoundSnapshot,
} from '../../api/index.ts';
import {
  SnapshotTimeline,
  type SnapshotPolicy,
  type WireSnapshot,
} from '../../engine/replication.ts';
import { Samples } from '../../engine/timing.ts';
import { freezeSnapshot } from '../../game-screen/screen.ts';
import {
  RELOAD_DISPLAY_MESSAGE,
  type ScreenFrame,
} from '../../game-screen/port.ts';

export const SNAPSHOT_RETRY_MESSAGE =
  'A game update could not be read. Waiting for a fresh snapshot.';

/** Read-only display playback; routing and browser resources belong to its caller. */
export class DisplayPlayback {
  readonly cursors = new CursorPlayback();
  private readonly assembler = new ProgressAssembler();
  private progress: ReadonlyDeep<Progress> = freezeSnapshot({
    revision: 0,
    totals: {},
    rounds: [],
  });
  getProgress() {
    return this.progress;
  }
  private history: ReturnType<typeof completedResults> = [];
  completedResults() {
    return structuredClone(this.history);
  }
  acceptProgress(message: Message) {
    if (this.inactive) return false;
    const progress = this.assembler.receive(message);
    if (!progress) return false;
    this.history = completedResults(progress);
    this.progress = freezeSnapshot(structuredClone(progress));
    return true;
  }

  private readonly buffer: SnapshotTimeline<RoundSnapshot<object>>;
  private resyncPending = false;
  private displayProblem: string | null = null;
  private retiredRounds = new Set<string>();
  private presentedIds = new Set<string>();
  private events: (PresentationEvent & { roundId: string })[] = [];
  private eventIds = new Set<string>();
  private snapshotDelays = new Samples();
  private lastSnapshotSize = 0;
  private lastFullSize = 0;
  private inactive = false;
  private phase: PlaybackPhase = {
    phase: 'lobby',
    roundId: null,
    gameId: null,
    mode: null,
    roundError: null,
  };
  private currentSample: ReadonlyDeep<RoundSnapshot<object>> | null = null;
  private currentDelay = 0;
  private currentLimitingVenue: string | null = null;
  get sampledSnapshot() {
    return this.currentSample;
  }
  get delay() {
    return this.currentDelay;
  }
  get limitingVenue() {
    return this.currentLimitingVenue;
  }

  constructor(
    policy: SnapshotPolicy<RoundSnapshot<object>>,
    private readonly supports: (gameId: string, mode: string) => boolean,
    private readonly effects: PlaybackEffects,
  ) {
    this.buffer = new SnapshotTimeline(policy);
  }

  acceptSnapshot(
    wire: unknown,
    delay: unknown,
    limitingVenue: unknown,
    authorityTime: number,
    clockReady: boolean,
  ) {
    if (this.inactive) return;
    // SnapshotTimeline validates the complete wire before any successful admission.
    const snapshot = wire as WireSnapshot<RoundSnapshot<object>>;
    if (
      snapshot?.patch?.schemaVersion !== undefined &&
      snapshot.patch.schemaVersion !== 1
    ) {
      this.displayProblem = RELOAD_DISPLAY_MESSAGE;
      this.events = [];
      return;
    }
    if (this.buffer.receive(snapshot)) {
      this.displayProblem = null;
      if (snapshot.base === null) {
        this.resyncPending = false;
        this.effects.recoveryWarning(false);
      }
      this.effects.acknowledge(snapshot.id);
      if (typeof delay === 'number' && Number.isFinite(delay) && delay >= 0)
        this.currentDelay = delay;
      this.currentLimitingVenue =
        typeof limitingVenue === 'string' ? limitingVenue : null;
      const age = Math.max(0, authorityTime - snapshot.time);
      this.snapshotDelays.add(age);
      this.lastSnapshotSize = JSON.stringify(snapshot).length;
      this.lastFullSize = JSON.stringify(
        this.buffer.history.get(snapshot.id)?.state,
      ).length;
      if (clockReady) this.effects.venueStats(age);
    } else if (!this.resyncPending) {
      this.resyncPending = true;
      this.effects.recoveryWarning(true);
      this.effects.resync();
    }
  }

  acceptEvent(value: unknown) {
    const event = value as
      | Partial<PresentationEvent & { roundId: string }>
      | undefined;
    if (
      this.inactive ||
      !event ||
      typeof event.id !== 'string' ||
      typeof event.roundId !== 'string' ||
      typeof event.kind !== 'string' ||
      !Number.isFinite(event.time) ||
      !['presentation', 'authority'].includes(event.clock ?? '') ||
      this.retiredRounds.has(event.roundId)
    )
      return;
    const key = `${event.roundId}:${event.id}`;
    if (!this.eventIds.has(key)) {
      this.eventIds.add(key);
      this.events.push(
        structuredClone(event) as PresentationEvent & { roundId: string },
      );
      this.events = this.events.slice(-256);
      while (this.eventIds.size > 2000)
        this.eventIds.delete(this.eventIds.values().next().value!);
    }
  }

  disconnect() {
    this.cursors.clear();
    this.events = [];
  }
  reconnect() {
    if (!this.inactive) this.resyncPending = false;
  }
  end() {
    this.cursors.dispose();
    this.inactive = true;
    this.events = [];
  }
  dispose() {
    this.end();
  }
  acceptPhase(msg: PlaybackPhaseInput): PlaybackPhase | null {
    if (this.inactive) return null;
    if (
      typeof msg.phase !== 'string' ||
      ![
        'lobby',
        'loading',
        'countdown',
        'running',
        'settling',
        'results',
        'aborted',
        'error',
      ].includes(msg.phase)
    )
      return null;
    const roundId = typeof msg.roundId === 'string' ? msg.roundId : null;
    if (roundId !== this.phase.roundId) {
      if (this.phase.roundId) this.retiredRounds.add(this.phase.roundId);
      while (this.retiredRounds.size > 50)
        this.retiredRounds.delete(this.retiredRounds.values().next().value!);
      this.events = this.events.filter((event) => event.roundId === roundId);
      this.presentedIds.clear();
    }
    this.phase.phase = msg.phase;
    this.phase.roundId = roundId;
    this.phase.gameId = typeof msg.gameId === 'string' ? msg.gameId : null;
    this.phase.mode = typeof msg.mode === 'string' ? msg.mode : null;
    this.phase.roundError = typeof msg.error === 'string' ? msg.error : null;
    if (['aborted', 'error'].includes(msg.phase)) this.events = [];
    return { ...this.phase };
  }
  presented(
    roundId: string,
    eventIds: readonly string[],
    authorityTime: number,
  ) {
    const snapshot = this.sampledSnapshot;
    if (
      this.inactive ||
      !snapshot ||
      snapshot.roundId !== roundId ||
      (this.phase.roundId && this.phase.roundId !== roundId) ||
      this.phase.phase === 'loading'
    )
      return;
    for (const eventId of eventIds) {
      const event = snapshot.events.find(
        (candidate) => candidate.id === eventId && candidate.measure,
      );
      const key = `${roundId}:${eventId}`;
      if (!event || this.presentedIds.has(key)) continue;
      this.presentedIds.add(key);
      this.effects.presented(roundId, eventId, authorityTime);
    }
  }
  metrics() {
    return {
      oneWay: this.snapshotDelays.summary(),
      lastBytes: this.lastSnapshotSize,
      deltaRatio: this.lastFullSize
        ? this.lastSnapshotSize / this.lastFullSize
        : null,
      starvations: this.buffer.starvations,
    };
  }
  advanceFrame(
    authorityTime: number,
    cursors: ScreenFrame['localCursors'],
    players: NonNullable<ScreenFrame['localPlayers']> = {},
    pressing: NonNullable<ScreenFrame['localPressing']> = {},
  ): ReadonlyDeep<ScreenFrame> {
    const delay = this.delay;
    const presentationTime = authorityTime - delay;
    const sampled = this.buffer.sample(presentationTime);
    this.currentSample = sampled ? freezeSnapshot(sampled) : null;
    const snapshot =
      this.phase.phase === 'loading' ||
      (!this.phase.roundId &&
        ['aborted', 'error'].includes(this.phase.phase)) ||
      (this.phase.roundId && sampled?.roundId !== this.phase.roundId)
        ? null
        : sampled;
    let status: ScreenFrame['status'] = snapshot ? 'ready' : 'waiting';
    let message: string | null = null;
    if (this.inactive) {
      status = 'ended';
      message = 'Session ended. Completed results remain available to save.';
    } else if (
      this.displayProblem ||
      (snapshot && !this.supports(snapshot.gameId, snapshot.mode))
    ) {
      status = 'unsupported';
      message = this.displayProblem ?? RELOAD_DISPLAY_MESSAGE;
    } else if (this.phase.phase === 'loading') {
      status = 'loading';
      message = 'Preparing round…';
    } else if (!snapshot && this.phase.phase === 'aborted') {
      status = 'aborted';
      message = 'Round aborted. No points awarded.';
    } else if (!snapshot && this.phase.phase === 'error') {
      status = 'error';
      message = this.phase.roundError ?? 'The round could not start.';
    }
    if (status === 'ready' && snapshot) {
      const keep: typeof this.events = [];
      for (const event of this.events) {
        if (event.roundId !== snapshot.roundId) {
          if (!this.retiredRounds.has(event.roundId)) keep.push(event);
          continue;
        }
        const time =
          event.clock === 'authority' ? authorityTime : presentationTime;
        if (event.time > time) keep.push(event);
        else if (time - event.time <= 1000) this.effects.playEvent(event);
      }
      this.events = keep;
    } else if (['ended', 'unsupported', 'error', 'aborted'].includes(status))
      this.events = [];
    const localCursors = structuredClone(cursors);
    return freezeSnapshot({
      snapshot,
      presentationTime,
      delay,
      localCursors,
      localPlayers: structuredClone(players),
      localPressing: structuredClone(pressing),
      status,
      message,
    });
  }
}
