/** Headless controls-owned composition. No transport, browser effects or input names. */
import { PRESS_SLOTS } from './registration.ts';
import type { ControlValue, Vector, WidgetType } from '../api.ts';
import type {
  MotionClocks,
  MotionCommand,
  MotionDefinition,
  MotionInputProcessor,
  MotionOutput,
  ValidatedMotionSample,
} from './registration.ts';
import { motionDefinitionFor, motionDefinitions } from './registry.ts';

export interface MotionBinding {
  action: string;
  type: WidgetType;
  config: unknown;
}
interface BoundInput {
  action: string;
  config: object;
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
  settingsChanged?(values: Readonly<Record<string, number>>): void;
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
  private readonly settingDefinitions = Object.assign(
    {},
    ...motionDefinitions.map((definition) => definition.settings ?? {}),
  ) as NonNullable<MotionDefinition<object>['settings']>;
  private readonly settings: Record<string, number> = Object.fromEntries(
    Object.entries(this.settingDefinitions).map(([key, setting]) => [
      key,
      setting.default,
    ]),
  );
  getSettings(action?: string): Readonly<Record<string, number>> {
    const supported =
      action === undefined
        ? this.settingDefinitions
        : (this.inputs.find((input) => input.action === action)?.definition
            .settings ?? {});
    return Object.freeze(
      Object.fromEntries(
        Object.keys(supported).map((key) => [key, this.settings[key]]),
      ),
    );
  }
  restoreSettings(json: string | null): void {
    if (!json || this.disposed) return;
    try {
      const values: unknown = JSON.parse(json);
      if (!values || typeof values !== 'object' || Array.isArray(values))
        return;
      for (const [key, value] of Object.entries(values))
        if (typeof value === 'number') this.setSetting(key, value);
    } catch {
      /* Invalid saved preferences retain the current settings. */
    }
  }
  private setSetting(key: string, value: number): boolean {
    const setting = Object.hasOwn(this.settingDefinitions, key)
      ? this.settingDefinitions[key]
      : undefined;
    if (!setting || this.disposed) return false;
    this.settings[key] = Number.isFinite(value)
      ? Math.max(setting.min, Math.min(setting.max, value))
      : setting.default;
    this.applySettings();
    this.effects.settingsChanged?.(this.getSettings());
    return true;
  }
  private applySettings(): void {
    for (const input of this.inputs)
      for (const key of Object.keys(input.definition.settings ?? {}))
        this.outputs(
          input,
          input.processor.command({
            type: key,
            value: this.settings[key],
            at: this.clocks.localTime(),
          } as MotionCommand),
        );
  }
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
      prepared.reduce(
        (sum, input) => sum + Number(input?.definition.transport.motionVector),
        0,
      ) > 1 ||
      prepared.reduce(
        (sum, input) => sum + (input?.definition.transport.pressSlots ?? 0),
        0,
      ) > PRESS_SLOTS
    )
      return false;
    this.cancel();
    const old = this.inputs;
    this.inputs = prepared.flatMap((input) => {
      if (!input) return [];
      const existing = old.find(
        (candidate) =>
          candidate.action === input.binding.action &&
          candidate.definition.type === input.definition.type,
      );
      const processor =
        existing?.processor ?? input.definition.create(this.clocks);
      processor.configure(input.config);
      return [
        {
          action: input.binding.action,
          config: input.config,
          definition: input.definition,
          processor,
          held: false,
          activations: existing?.activations ?? 0,
          lockedAim: null,
        },
      ];
    });
    this.cancel(); // Project configured bounds/neutral values before the first sample.
    this.applySettings();
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
  frameRate(refreshRate: number): number {
    const config = this.inputs.find(
      (input) => input.definition.transport.motionVector,
    )?.config;
    const rate = config && 'rateHz' in config ? config.rateHz : undefined;
    return typeof rate === 'number' && Number.isFinite(rate) && rate > 0
      ? Math.min(
          rate,
          Number.isFinite(refreshRate) && refreshRate > 0 ? refreshRate : 60,
        )
      : 60;
  }
  has(action: string) {
    return this.inputs.some((input) => input.action === action);
  }
  command(action: string, command: MotionCommand): void {
    if (this.disposed) return;
    const input = this.inputs.find((candidate) => candidate.action === action);
    if (!input) return;
    if ('value' in command && input.definition.settings?.[command.type]) {
      this.setSetting(command.type, command.value);
      return;
    }
    this.outputs(input, input.processor.command(command));
  }
  commandAll(command: MotionCommand): void {
    if (this.disposed) return;
    if ('value' in command && this.setSetting(command.type, command.value))
      return;
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
