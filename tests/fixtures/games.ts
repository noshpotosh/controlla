/** Small non-playable probes for framework tests; never registered by production. */
import type {
  Action,
  GameContext,
  GameDescriptor,
  Point,
} from '../../src/client/api/index.ts';
import { controllerSpec } from '../../src/client/engine/input.ts';
export interface ProbeState {
  scores: Record<string, number>;
  cursors: Record<string, Point>;
  actions: Action[];
  elapsed: number;
  flag: boolean;
}
export const buttonProbe: GameDescriptor<ProbeState> = {
  id: 'button-probe',
  name: 'Input probe',
  players: { min: 1, max: 8 },
  timing: { kind: 'timed', durationMs: 30000 },
  modes: [{ id: 'standard', name: 'Standard' }],
  defaultMode: 'standard',
  controls: {
    inputs: {
      aim: { required: true, prefer: 'pointer', fallback: 'stick' },
      fire: { required: true, prefer: 'button' },
    },
    controller: { layout: 'aim-and-fire' },
  },
  presentation: { cursors: true },
  create() {
    let context: GameContext;
    let state: ProbeState = {
      scores: {},
      cursors: {},
      actions: [],
      elapsed: 0,
      flag: false,
    };
    return {
      load() {},
      ready: () => true,
      start(next) {
        context = next;
        state = {
          scores: Object.fromEntries(next.players.map((p) => [p.id, 0])),
          cursors: {},
          actions: [],
          elapsed: 0,
          flag: false,
        };
      },
      tick(input) {
        state.elapsed += input.dt;
        for (const [id, values] of Object.entries(input.values)) {
          const point = (values.aim ?? values.steer)?.value as
            | Point
            | undefined;
          if (point) state.cursors[id] = { ...point };
        }
        for (const action of input.actions) {
          state.scores[action.playerId]++;
          state.flag = !state.flag;
          state.actions.push(structuredClone(action));
        }
        return {
          events: input.actions.map((action, i) => ({
            id: `probe-${state.actions.length}-${i}`,
            kind: 'hit',
            time: input.time,
            clock: 'presentation' as const,
            playerId: action.playerId,
          })),
        };
      },
      snapshot: () => structuredClone(state),
      finalize: () =>
        context.players.map((p) => ({
          playerId: p.id,
          score: state.scores[p.id],
          placement:
            1 +
            Object.values(state.scores).filter((n) => n > state.scores[p.id])
              .length,
        })),
      disconnect() {},
      reconnect() {},
      dispose() {},
    };
  },
  isState(value): value is ProbeState {
    if (!value || typeof value !== 'object') return false;
    const s = value as ProbeState;
    return (
      !!s.scores &&
      !!s.cursors &&
      Array.isArray(s.actions) &&
      typeof s.flag === 'boolean' &&
      Number.isFinite(s.elapsed)
    );
  },
  createRenderer: () => ({ render() {}, dispose() {} }),
};
export const steeringProbe: GameDescriptor<ProbeState> = {
  ...buttonProbe,
  id: 'steering-probe',
  name: 'Steering probe',
  controls: {
    inputs: {
      steer: { required: true, prefer: 'tilt', fallback: 'stick' },
      boost: { required: true, prefer: 'swipe-pad' },
    },
    controller: { layout: 'steer-and-boost' },
  },
};
export const pointerSpec = controllerSpec(buttonProbe);
export const steeringSpec = controllerSpec(steeringProbe);
export const controlSpecs = [pointerSpec, steeringSpec];
