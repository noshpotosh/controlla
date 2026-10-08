import type {
  GameContext,
  GameInput,
  GameInstance,
  GameTickResult,
  Outcome,
} from '../../api/index.ts';

export interface __CLASS__State {
  scores: Record<string, number>;
}
export function is__CLASS__State(value: unknown): value is __CLASS__State {
  if (!value || typeof value !== 'object' || !('scores' in value)) return false;
  const scores = value.scores;
  return (
    !!scores &&
    typeof scores === 'object' &&
    !Array.isArray(scores) &&
    Object.keys(scores).length <= 8 &&
    Object.values(scores).every(
      (score) => Number.isSafeInteger(score) && score >= 0,
    )
  );
}
/** Rules own data only. Framework owns timing, eligibility, input and session awards. */
export class __CLASS__Game implements GameInstance<__CLASS__State> {
  private state: __CLASS__State = { scores: {} };
  load() {}
  ready() {
    return true;
  }
  start(context: GameContext) {
    this.state = {
      scores: Object.fromEntries(context.players.map((p) => [p.id, 0])),
    };
  }
  tick(input: GameInput): GameTickResult {
    for (const action of input.actions)
      if (
        action.name === 'score' &&
        Object.hasOwn(this.state.scores, action.playerId)
      )
        this.state.scores[action.playerId]++;
    return { events: [] };
  }
  snapshot(): __CLASS__State {
    return structuredClone(this.state);
  }
  finalize(): Outcome[] {
    return Object.entries(this.state.scores).map(([playerId, score]) => ({
      playerId,
      score,
      placement:
        1 +
        Object.values(this.state.scores).filter((other) => other > score)
          .length,
    }));
  }
  disconnect(_playerId: string, _time: number) {}
  reconnect(_playerId: string) {}
  dispose() {}
}
