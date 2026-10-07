/** Headless controls-owned composition. No transport, browser effects or input names. */
import type { ControlValue, Vector, WidgetType } from '../api.ts';
import type {
  MotionClocks,
  MotionCommand,
  MotionDefinition,
  MotionInputProcessor,
  MotionOutput,
  ValidatedMotionSample,
} from './registration.ts';
import { motionDefinitionFor } from './registry.ts';

export interface MotionBinding {
  action: string;
  type: WidgetType;
  config: unknown;
}
interface BoundInput {
  action: string;
  definition: MotionDefinition<object>;
  processor: MotionInputProcessor<object>;
  held: boolean;
  activations: number;
  lockedAim: Vector | null;
}
export interface MotionEffects {
  activation(
    action: string,
    value: ControlValue | undefined,
    capture: { at: number; aim?: Vector },
  ): void;
  haptic(ms: number): void;
}
export interface MotionControlsSnapshot {
  readonly point: Readonly<Vector>;
  readonly confidence: number;
  readonly vector: boolean;
  readonly inputs: Readonly<
    Record<string, Readonly<{ held: boolean; activations: number }>>
  >;
}
export class MotionControls {
  private inputs: BoundInput[] = [];
  private point: Vector = { x: 0.5, y: 0.5 };
  private confidence = 1;
  private disposed = false;
  constructor(
    private readonly clocks: MotionClocks,
    private readonly effects: MotionEffects,
  ) {}
  configure(bindings: readonly MotionBinding[]): boolean {
    if (this.disposed) return false;
    const prepared = bindings.map((binding) => {
      const definition = motionDefinitionFor(binding.type);
      const config = definition?.validateConfig(binding.config);
      return definition && config?.ok
        ? { binding, definition, config: config.value }
        : null;
    });
    if (
      prepared.some((input) => input === null) ||
      new Set(bindings.map((binding) => binding.action)).size !==
        bindings.length ||
      new Set(bindings.map((binding) => binding.type)).size !==
        bindings.length ||
      prepared.reduce(
        (sum, input) => sum + Number(input?.definition.transport.motionVector),
        0,
      ) > 1 ||
      prepared.reduce(
        (sum, input) => sum + (input?.definition.transport.pressSlots ?? 0),
        0,
      ) > 4
    )
      return false;
    this.cancel();
    const old = this.inputs;
    this.inputs = prepared.flatMap((input) => {
      if (!input) return [];
      const existing = old.find(
        (candidate) => candidate.definition.type === input.definition.type,
      );
      const processor =
        existing?.processor ?? input.definition.create(this.clocks);
      processor.configure(input.config);
      return [
        {
          action: input.binding.action,
          definition: input.definition,
          processor,
          held: false,
          activations: existing?.activations ?? 0,
          lockedAim: null,
        },
      ];
    });
    this.cancel(); // Project configured bounds/neutral values before the first sample.
    for (const input of old)
      if (!this.inputs.some((current) => current.processor === input.processor))
        input.processor.dispose();
    return true;
  }
  getSnapshot(): MotionControlsSnapshot {
    return Object.freeze({
      point: Object.freeze({ ...this.point }),
      confidence: this.confidence,
      vector: this.inputs.some(
        (input) => input.definition.transport.motionVector,
      ),
      inputs: Object.freeze(
        Object.fromEntries(
          this.inputs.map((input) => [
            input.action,
            Object.freeze({ held: input.held, activations: input.activations }),
          ]),
        ),
      ),
    });
  }
  has(action: string) {
    return this.inputs.some((input) => input.action === action);
  }
  command(action: string, command: MotionCommand): void {
    if (this.disposed) return;
    const input = this.inputs.find((candidate) => candidate.action === action);
    if (input) this.outputs(input, input.processor.command(command));
  }
  commandAll(command: MotionCommand): void {
    if (this.disposed) return;
    // Calibration moves the vector before dependent gestures recapture it.
    for (const input of this.ordered())
      this.outputs(input, input.processor.command(command));
  }
  capturePress(at: number): Vector | undefined {
    if (this.disposed) return undefined;
    const input = this.inputs.find(
      (candidate) => candidate.definition.transport.motionVector,
    );
    if (!input) return undefined;
    this.outputs(
      input,
      input.processor.command({ type: 'press', down: true, at }),
    );
    return { ...this.point };
  }
  process(sample: ValidatedMotionSample): void {
    if (this.disposed) return;
    for (const input of this.ordered())
      this.outputs(input, input.processor.process(sample));
  }
  private ordered() {
    return [...this.inputs].sort(
      (a, b) =>
        Number(b.definition.transport.motionVector) -
        Number(a.definition.transport.motionVector),
    );
  }
  private outputs(input: BoundInput, outputs: readonly MotionOutput[]): void {
    for (const output of outputs) {
      switch (output.type) {
        case 'value':
          if (
            input.definition.transport.motionVector &&
            typeof output.value === 'object' &&
            'x' in output.value &&
            'y' in output.value
          ) {
            this.point = { x: output.value.x, y: output.value.y };
            this.confidence = output.confidence ?? this.confidence;
          }
          break;
        case 'held':
          input.held = output.down;
          break;
        case 'haptic':
          this.effects.haptic(output.ms);
          break;
        case 'activation':
          input.activations++;
          this.effects.activation(input.action, output.value, {
            at: output.at,
            ...(output.capture === 'locked-aim' && input.lockedAim
              ? { aim: { ...input.lockedAim } }
              : {}),
          });
          break;
        case 'aim-lock': {
          const vector = this.inputs.find(
            (candidate) => candidate.definition.transport.motionVector,
          );
          if (vector)
            this.outputs(
              vector,
              vector.processor.command({
                type: 'aim-lock',
                at: output.captureAt,
                policy: output.policy,
              }),
            );
          input.lockedAim = { ...this.point };
          break;
        }
        case 'aim-release': {
          const vector = this.inputs.find(
            (candidate) => candidate.definition.transport.motionVector,
          );
          if (vector)
            this.outputs(
              vector,
              vector.processor.command({
                type: 'aim-release',
                at: output.at,
                ...(output.immediate ? { immediate: true } : {}),
              }),
            );
          if (output.immediate) input.lockedAim = null;
          break;
        }
      }
    }
  }
  cancel(): void {
    this.commandAll({ type: 'cancel', at: this.clocks.localTime() });
  }
  dispose(): void {
    if (this.disposed) return;
    this.cancel();
    for (const input of this.inputs) input.processor.dispose();
    this.inputs = [];
    this.disposed = true;
  }
}
