import type { Snapshot, WireSnapshot, GameState, Point } from './types.ts';
export class SnapshotEncoder {
  history = new Map<number, Snapshot>();
  acks = new Map<string, number>();
  add(snapshot: Snapshot) {
    this.history.set(snapshot.id, structuredClone(snapshot));
    while (this.history.size > 100)
      this.history.delete(this.history.keys().next().value!);
  }
  ack(peer: string, id: number) {
    if (this.history.has(id) && id > (this.acks.get(peer) ?? -1))
      this.acks.set(peer, id);
  }
  forPeer(peer: string, s: Snapshot): WireSnapshot {
    const base = this.history.get(this.acks.get(peer) ?? -1);
    if (!base)
      return {
        id: s.id,
        time: s.time,
        base: null,
        patch: structuredClone(s.state),
      };
    const patch: Partial<GameState> = {};
    for (const key of Object.keys(s.state) as (keyof GameState)[])
      if (JSON.stringify(s.state[key]) !== JSON.stringify(base.state[key]))
        (patch as Record<string, unknown>)[key] = structuredClone(s.state[key]);
    return { id: s.id, time: s.time, base: base.id, patch };
  }
}
export class SnapshotBuffer {
  history = new Map<number, Snapshot>();
  frames: Snapshot[] = [];
  starvations = 0;
  private starving = false;
  receive(w: WireSnapshot): boolean {
    const base = w.base === null ? null : this.history.get(w.base);
    if (w.base !== null && !base) return false;
    const state = { ...base?.state, ...structuredClone(w.patch) } as GameState;
    if (!state.phase || !state.cursors || !state.scores) return false;
    const s = { id: w.id, time: w.time, state };
    this.history.set(s.id, s);
    while (this.history.size > 120)
      this.history.delete(this.history.keys().next().value!);
    if (this.frames.some((f) => f.id === s.id)) return true;
    this.frames.push(s);
    this.frames.sort((a, b) => a.time - b.time);
    this.frames = this.frames.slice(-120);
    return true;
  }
  sample(time: number): GameState | null {
    if (!this.frames.length) return null;
    const before = [...this.frames].reverse().find((s) => s.time <= time);
    if (!before) return null;
    const after = this.frames.find((s) => s.time > time);
    const starved = !after && time - before.time > 100;
    if (starved && !this.starving) this.starvations++;
    this.starving = starved;
    if (!after) return structuredClone(before.state);
    const t = (time - before.time) / (after.time - before.time),
      s = structuredClone(before.state);
    if (s.phase !== after.state.phase || s.gameId !== after.state.gameId)
      return s;
    const mix = (a: Point, b: Point): Point => ({
      x: a.x + (b.x - a.x) * t,
      y: a.y + (b.y - a.y) * t,
    });
    // Target jumps are discrete; continuous target movement is tracking-only.
    if (s.mode === 'tracking') s.target = mix(s.target, after.state.target);
    for (const field of ['cursors', 'racers'] as const)
      for (const id in s[field])
        if (after.state[field][id])
          s[field][id] = mix(s[field][id], after.state[field][id]);
    return s;
  }
}
