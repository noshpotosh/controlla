import type { Snapshot, WireSnapshot } from './types.ts';
export class SnapshotEncoder<S extends object = object> {
  history = new Map<number, Snapshot<S>>();
  acks = new Map<string, number>();
  add(snapshot: Snapshot<S>) {
    this.history.set(snapshot.id, structuredClone(snapshot));
    while (this.history.size > 100)
      this.history.delete(this.history.keys().next().value!);
  }
  ack(peer: string, id: number) {
    if (this.history.has(id) && id > (this.acks.get(peer) ?? -1))
      this.acks.set(peer, id);
  }
  forPeer(peer: string, s: Snapshot<S>): WireSnapshot<S> {
    const base = this.history.get(this.acks.get(peer) ?? -1);
    if (!base)
      return {
        id: s.id,
        time: s.time,
        base: null,
        patch: structuredClone(s.state),
      };
    const patch: Partial<S> = {};
    for (const key of Object.keys(s.state) as (keyof S)[])
      if (JSON.stringify(s.state[key]) !== JSON.stringify(base.state[key]))
        patch[key] = structuredClone(s.state[key]);
    return { id: s.id, time: s.time, base: base.id, patch };
  }
}

/** State policy is supplied by the game adapter; transport has no game fields. */
export interface SnapshotPolicy<S extends object> {
  valid(value: unknown): value is S;
  interpolate(before: S, after: S, ratio: number): S;
}

export class SnapshotTimeline<S extends object> {
  history = new Map<number, Snapshot<S>>();
  frames: Snapshot<S>[] = [];
  starvations = 0;
  private starving = false;
  constructor(private readonly policy: SnapshotPolicy<S>) {}
  receive(w: WireSnapshot<S>): boolean {
    try {
      if (
        !w ||
        typeof w !== 'object' ||
        !Number.isSafeInteger(w.id) ||
        w.id < 0 ||
        !Number.isFinite(w.time) ||
        (w.base !== null &&
          (!Number.isSafeInteger(w.base) || w.base < 0 || w.base >= w.id)) ||
        !w.patch ||
        typeof w.patch !== 'object' ||
        Array.isArray(w.patch)
      )
        return false;
      const base = w.base === null ? null : this.history.get(w.base);
      if (w.base !== null && !base) return false;
      const state: unknown = { ...base?.state, ...structuredClone(w.patch) };
      if (!this.policy.valid(state)) return false;
      const previous = this.history.get(w.id);
      if (previous)
        return (
          previous.time === w.time &&
          JSON.stringify(previous.state) === JSON.stringify(state)
        );
      const s: Snapshot<S> = { id: w.id, time: w.time, state };
      this.history.set(s.id, s);
      while (this.history.size > 120)
        this.history.delete(this.history.keys().next().value!);
      this.frames.push(s);
      this.frames.sort((a, b) => a.time - b.time);
      this.frames = this.frames.slice(-120);
      return true;
    } catch {
      return false;
    }
  }
  sample(time: number): S | null {
    if (!this.frames.length) return null;
    const before = [...this.frames].reverse().find((s) => s.time <= time);
    if (!before) return null;
    const after = this.frames.find((s) => s.time > time);
    const starved = !after && time - before.time > 100;
    if (starved && !this.starving) this.starvations++;
    this.starving = starved;
    if (!after) return structuredClone(before.state);
    const ratio = (time - before.time) / (after.time - before.time);
    return this.policy.interpolate(
      structuredClone(before.state),
      structuredClone(after.state),
      ratio,
    );
  }
}
