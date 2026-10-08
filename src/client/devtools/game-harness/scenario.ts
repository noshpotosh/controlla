import type { Action, Progress, RoundSnapshot } from '../../api/index.ts';
import type { GameHarness } from './harness.ts';

/** `at` is receipt time; capture timestamps remain independent. Equal times keep fixture order. */
export type ScenarioStep = { at: number } & (
  | {
      kind: 'value';
      playerId: string;
      name: string;
      value: unknown;
      capturedAt?: number;
    }
  | { kind: 'action'; action: Action }
  | { kind: 'disconnect' | 'reconnect'; playerId: string }
  | { kind: 'abort' }
);
export interface ScenarioSample<S extends object> {
  time: number;
  authority: RoundSnapshot<S> | null;
  host: RoundSnapshot<S> | null;
  remote: RoundSnapshot<S> | null;
}
export interface ScenarioResult<S extends object> {
  samples: ScenarioSample<S>[];
  progress: Progress;
}

/** Replay a detached fixture using only the harness public lifecycle and input API. */
export async function runScenario<S extends object>(
  harness: GameHarness<S>,
  schedule: readonly ScenarioStep[],
  endAt: number,
): Promise<ScenarioResult<S>> {
  const steps = structuredClone([...schedule]).sort((a, b) => a.at - b.at);
  if (
    !Number.isFinite(endAt) ||
    endAt < harness.time ||
    steps.some(
      (step) =>
        !Number.isFinite(step.at) ||
        step.at < harness.time ||
        step.at > endAt ||
        !['value', 'action', 'disconnect', 'reconnect', 'abort'].includes(
          step.kind,
        ),
    )
  )
    throw new Error('Invalid scenario timeline.');
  await harness.load();
  const samples: ScenarioSample<S>[] = [];
  const sample = () =>
    samples.push({
      time: harness.time,
      authority: harness.authoritativeSnapshot(),
      host: harness.display('host'),
      remote: harness.display('remote'),
    });
  const apply = (step: ScenarioStep) => {
    switch (step.kind) {
      case 'value':
        harness.setValue(step.playerId, step.name, step.value, step.capturedAt);
        break;
      case 'action':
        harness.input(step.action);
        break;
      case 'disconnect':
        harness.disconnect(step.playerId);
        break;
      case 'reconnect':
        harness.reconnect(step.playerId);
        break;
      case 'abort':
        harness.abort();
        break;
    }
  };
  const advanceTo = (at: number, due: ScenarioStep[] = []) => {
    // Bound each advance using the same 20 ms simulation ticks, with a shorter
    // final tick at exact receipt time. Inputs arrive before that authority tick.
    const advance = (milliseconds: number, drive?: () => void) => {
      const before = harness.time;
      harness.advance(milliseconds, drive);
      if (milliseconds > 0 && harness.time === before)
        throw new Error('Scenario clock did not advance.');
    };
    while (at - harness.time > 120000) advance(120000);
    if (at === harness.time) due.forEach(apply);
    else
      advance(at - harness.time, () => {
        if (harness.time === at) due.forEach(apply);
      });
  };
  sample();
  for (let index = 0; index < steps.length;) {
    const at = steps[index].at,
      due: ScenarioStep[] = [];
    while (index < steps.length && steps[index].at === at)
      due.push(steps[index++]);
    advanceTo(at, due);
    sample();
  }
  advanceTo(endAt);
  sample();
  return { samples, progress: harness.progressView() };
}
