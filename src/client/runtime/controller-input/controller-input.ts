import type { InputEnvironment, InputEffects } from './contracts.ts';
import type {
  ControlPort,
  ControllerConfig,
  Widget,
} from '../../controls/api.ts';
import type { MotionControlPort } from '../../controls/motion/contracts.ts';
import type { MotionSnapshot } from '../../controls/motion/contracts.ts';
import {
  channelOf,
  kindOf,
  PRESS_SLOTS,
  usesPressSlot,
} from '../../controls/registry.ts';
import {
  parseActivationValue,
  parseControlValue,
  valueFitsEnvelope,
} from '../../controls/value.ts';
import { clampGain } from '../../controls/motion/pointer.ts';
import { MotionControls } from '../../controls/motion/composition.ts';
import { motionBindings } from '../../controls/motion/configuration.ts';
import { motionDefinitionFor } from '../../controls/motion/registry.ts';
import { encodeInput, type InputFrame } from '../../engine/protocol.ts';
import type { WidgetValueMessage } from '../../engine/reliable-input.ts';
import type { Point } from '../../../core/types.ts';

const WIDGET_THROTTLE_MS = 30;
const MAX_BACKDATE_MS = 400;

/** Phone-side input processing. Transport and browser resource ownership stay outside. */
export class ControllerInput {
  private config: ControllerConfig | null = null;
  private active = false;
  private adjustingAim = false;
  private terminal = false;
  private epoch = 0;
  private lastSend = 0;
  private nextSend = 0;
  private seq = 0;
  private latestPoint: Point = { x: 0.5, y: 0.5 };
  private velocity: Point = { x: 0, y: 0 };
  private buttonState = 0;
  private edges = [0, 0, 0, 0];
  private edgeTimes = [0, 0, 0, 0];
  private motionControls: MotionControls;
  private recenters = 0;
  private sensitivity = 1.35;
  private sendRate = 60;
  private widgetLastSent = new Map<string, number>();
  private widgetPending = new Map<
    string,
    { sample: WidgetValueMessage; cancel: () => void }
  >();
  private widgetLatest = new Map<string, WidgetValueMessage>();
  private widgetSequences = new Map<string, number>();

  constructor(
    private readonly environment: InputEnvironment,
    private readonly effects: InputEffects,
  ) {
    this.motionControls = new MotionControls(
      {
        localTime: () => environment.localTime(),
        authorityTime: (at) =>
          environment.authorityTime() - (environment.localTime() - at),
      },
      {
        activation: (action, value, capture) =>
          this.action(action, value, this.config?.generation, capture),
        haptic: (ms) => this.haptic(ms),
      },
    );
  }

  getSnapshot() {
    return Object.freeze({
      epoch: this.epoch,
      adjustingAim: this.adjustingAim,
      point: Object.freeze(this.previewPoint()),
      sensitivity: this.sensitivity,
      recenters: this.recenters,
      motion: this.motionControls.getSnapshot(),
    });
  }

  getConfiguration() {
    return this.config ? structuredClone(this.config) : null;
  }
  beginAdjustAim() {
    if (!this.terminal) this.adjustingAim = true;
  }
  finishAdjustAim() {
    if (!this.terminal) this.adjustingAim = false;
  }
  configure(config: ControllerConfig) {
    if (
      this.terminal ||
      !config ||
      config.schemaVersion !== 2 ||
      !Array.isArray(config.widgets) ||
      config.widgets.length > 24 ||
      config.widgets.some((widget) => !widget || !kindOf(widget.type))
    )
      return false;
    const changed =
      this.config?.generation !== config.generation ||
      this.config?.configId !== config.configId;
    const bindings = motionBindings(config);
    if (
      !bindings ||
      ((changed || JSON.stringify(this.config) !== JSON.stringify(config)) &&
        !this.motionControls.configure(bindings))
    )
      return false;
    this.config = structuredClone(config);
    this.motionControls.commandAll({
      type: 'sensitivity',
      value: this.sensitivity,
      at: this.environment.localTime(),
    });
    if (changed) {
      this.clearWidgetInput(true);
      this.edges = [0, 0, 0, 0];
      this.edgeTimes = [0, 0, 0, 0];
      this.buttonState = 0;
      this.seq = 0;
      this.nextSend = 0;
      this.latestPoint = this.motionControls.getSnapshot().vector
        ? { ...this.motionControls.getSnapshot().point }
        : config.widgets.some((w) => w.space === 'normalized')
          ? { x: 0.5, y: 0.5 }
          : { x: 0, y: 0 };
    }
    return true;
  }
  setRefreshRate(refreshRate: number) {
    if (this.terminal) return;
    this.sendRate = this.motionControls.frameRate(refreshRate);
  }
  setActive(active: boolean) {
    if (this.terminal || active === this.active) return;
    this.active = active;
    if (!active) this.retire();
  }
  private retire() {
    if (this.terminal) return;
    this.clearWidgetInput();
    this.buttonState = 0;
    this.motionControls.cancel();
  }
  end() {
    this.dispose();
  }
  dispose() {
    if (this.terminal) return;
    this.active = false;
    this.clearWidgetInput(true);
    this.buttonState = 0;
    this.motionControls.dispose();
    this.terminal = true;
  }
  setSensitivity(gain: number) {
    if (this.terminal) return;
    this.sensitivity = clampGain(gain);
    this.motionControls.commandAll({
      type: 'sensitivity',
      value: this.sensitivity,
      at: this.environment.localTime(),
    });
  }
  /** Commands and observation belong to one named action, configuration and epoch. */
  motionPortFor(widget: Widget, generation: number): MotionControlPort {
    const epoch = this.epoch,
      configId = this.config?.configId,
      action = widget.action,
      id = widget.id,
      type = widget.type;
    const valid = () =>
      !this.terminal &&
      this.active &&
      epoch === this.epoch &&
      this.config?.generation === generation &&
      this.config.configId === configId &&
      this.config.widgets.some(
        (candidate) =>
          candidate.id === id &&
          candidate.action === action &&
          candidate.type === type,
      ) &&
      this.motionControls.has(action);
    const retired = Object.freeze({
      held: false,
      activations: 0,
      point: Object.freeze({ x: 0.5, y: 0.5 }),
    });
    return {
      getSnapshot: () => {
        if (!valid()) return retired;
        const snapshot = this.motionControls.getSnapshot();
        return Object.freeze({
          ...snapshot.inputs[action],
          point: snapshot.point,
        });
      },
      command: (command) => {
        if (!valid()) return;
        this.motionControls.command(action, {
          ...command,
          at: this.environment.localTime(),
        });
        if (this.motionControls.getSnapshot().vector)
          this.latestPoint = { ...this.motionControls.getSnapshot().point };
      },
    };
  }
  recenter() {
    if (this.terminal) return;
    this.motionControls.commandAll({
      type: 'recenter',
      at: this.environment.localTime(),
    });
    if (this.motionControls.getSnapshot().vector)
      this.latestPoint = { ...this.motionControls.getSnapshot().point };
    this.recenters++;
  }
  tick(motion: MotionSnapshot) {
    if (!this.active || this.terminal || !this.config) return;
    const config = this.config;
    const local = this.environment.localTime(),
      time = this.environment.authorityTime();
    this.motionControls.process({
      ...motion,
      linearAcceleration:
        'linearAcceleration' in motion
          ? (motion.linearAcceleration as
              | import('../../controls/motion/registration.ts').Vec3
              | null)
          : null,
    });
    const state = this.motionControls.getSnapshot();
    const point = state.vector ? { ...state.point } : this.latestPoint;
    if (local >= this.nextSend) {
      const interval = 1000 / this.sendRate;
      // Keep the deadline anchored instead of accumulating timer overshoot.
      // After a suspension, send once without trying to catch up old frames.
      this.nextSend =
        local - this.nextSend > interval
          ? local + interval
          : this.nextSend + interval;
      const dt = Math.max(0.001, (local - this.lastSend) / 1000);
      this.velocity = {
        x: Math.max(-8, Math.min(8, (point.x - this.latestPoint.x) / dt)),
        y: Math.max(-8, Math.min(8, (point.y - this.latestPoint.y) / dt)),
      };
      this.latestPoint = point;
      this.lastSend = local;
      const frame: InputFrame = {
        seq: this.seq++ % 65536,
        time,
        generation: config.generation,
        ...point,
        vx: this.velocity.x,
        vy: this.velocity.y,
        buttons: this.buttonState | this.motionHeldMask(),
        edges: this.edges,
        edgeTimes: this.edgeTimes,
        confidence: state.vector ? state.confidence : 1,
      };
      this.effects.frame(encodeInput(frame));
    }
  }
  previewPoint() {
    return { ...this.latestPoint };
  }
  private motionHeldMask() {
    if (!this.config) return 0;
    const inputs = this.motionControls.getSnapshot().inputs;
    return this.config.widgets
      .filter((widget) => usesPressSlot(widget.type))
      .reduce(
        (mask, widget, slot) =>
          slot < PRESS_SLOTS && inputs[widget.action]?.held
            ? mask | (1 << slot)
            : mask,
        0,
      );
  }
  setPoint(point: Point) {
    if (!this.terminal) this.latestPoint = { ...point };
  }
  /** A view retains its configuration epoch even after React starts unmounting it. */
  portFor(widget: Widget, generation: number): ControlPort {
    const epoch = this.epoch,
      action = widget.action;
    const active = () =>
      this.active &&
      !this.terminal &&
      epoch === this.epoch &&
      this.config?.generation === generation;
    return {
      value: (value) => {
        if (active()) this.action(action, value, generation);
      },
      press: (down) => {
        if (active()) this.press(action, down, generation);
      },
      haptic: (ms) => {
        if (active()) this.haptic(ms);
      },
    };
  }
  /**
   * `capture` dates a gesture's press to when it began, in local time, and
   * may carry the aim it locked.
   */
  action(
    action: string,
    raw: unknown,
    generation = this.config?.generation,
    capture?: { at: number; aim?: Point; time?: number },
  ) {
    const config = this.config;
    if (
      !config ||
      generation !== config.generation ||
      !this.active ||
      this.terminal ||
      !valueFitsEnvelope(raw)
    )
      return;
    const widget = config.widgets.find((w) => w.action === action);
    if (!widget || channelOf(widget.type).channel === 'press') return;
    const value = parseControlValue(widget.type, raw);
    if (value === undefined) return;
    if (capture)
      capture = {
        ...capture,
        time:
          this.environment.authorityTime() -
          Math.min(
            MAX_BACKDATE_MS,
            Math.max(0, this.environment.localTime() - capture.at),
          ),
      };
    const sample: WidgetValueMessage = {
      type: 'widget',
      action,
      generation: config.generation,
      seq: (this.widgetSequences.get(action) ?? -1) + 1,
      time: capture?.time ?? this.environment.authorityTime(),
      value,
    };
    this.widgetSequences.set(action, sample.seq);
    this.widgetLatest.set(action, sample);
    const { throttle, drivesPointer } = channelOf(widget.type),
      at = this.environment.localTime(),
      wait =
        WIDGET_THROTTLE_MS -
        (at - (this.widgetLastSent.get(action) ?? -Infinity));
    if (!throttle || wait <= 0) this.sendWidget(sample);
    else {
      const pending = this.widgetPending.get(action);
      if (pending) pending.sample = sample;
      else {
        const epoch = this.epoch;
        const pendingValue = {
          sample,
          cancel: this.environment.schedule(() => {
            if (
              this.active &&
              !this.terminal &&
              epoch === this.epoch &&
              this.widgetPending.get(action) === pendingValue
            )
              this.flushWidget(action);
          }, wait),
        };
        this.widgetPending.set(action, pendingValue);
      }
    }
    if (drivesPointer) {
      const point = value as Point;
      this.setPoint(
        widget.space === 'normalized'
          ? { x: (point.x + 1) / 2, y: (point.y + 1) / 2 }
          : { ...point },
      );
    } else if (motionDefinitionFor(widget.type)?.transport.pressSlots === 1) {
      this.press(action, true, generation, capture);
      this.press(action, false, generation);
    }
  }
  private sendWidget(sample: WidgetValueMessage) {
    const pending = this.widgetPending.get(sample.action);
    if (pending) pending.cancel();
    this.widgetPending.delete(sample.action);
    if (
      sample.generation !== this.config?.generation ||
      !this.active ||
      this.terminal
    )
      return;
    this.widgetLastSent.set(sample.action, this.environment.localTime());
    this.effects.reliable(structuredClone(sample));
  }
  private flushWidget(action: string) {
    const pending = this.widgetPending.get(action);
    if (pending) this.sendWidget(pending.sample);
  }
  private clearWidgetInput(resetSequence = false) {
    this.epoch++;
    for (const { cancel } of this.widgetPending.values()) cancel();
    this.widgetPending.clear();
    this.widgetLatest.clear();
    this.widgetLastSent.clear();
    // Retiring a held touch control also retires its legacy continuous frame.
    // Its old unmount callback is deliberately inert and cannot send a release.
    const config = this.config;
    if (!this.motionControls.getSnapshot().vector) {
      this.latestPoint = config?.widgets.some(
        (widget) => widget.space === 'normalized',
      )
        ? { x: 0.5, y: 0.5 }
        : { x: 0, y: 0 };
      this.velocity = { x: 0, y: 0 };
    }
    if (resetSequence) this.widgetSequences.clear();
  }
  press(
    action: string,
    down: boolean,
    generation = this.config?.generation,
    capture?: { at: number; aim?: Point; time?: number },
  ) {
    const config = this.config;
    if (
      !config ||
      generation !== config.generation ||
      !this.active ||
      this.terminal
    )
      return;
    const buttons = config.widgets.filter((w) => usesPressSlot(w.type));
    const button = buttons.findIndex((w) => w.action === action);
    if (button < 0 || button >= PRESS_SLOTS) return;
    const mask = 1 << button;
    if (down && !(this.buttonState & mask)) {
      const both = channelOf(buttons[button].type).channel === 'both';
      const sample = this.widgetLatest.get(action);
      const value =
        both && sample
          ? parseActivationValue(buttons[button].type, sample.value)
          : undefined;
      if (
        both &&
        (!sample ||
          sample.generation !== config.generation ||
          value === undefined)
      )
        return;
      this.flushWidget(action);
      const local = this.environment.localTime();
      // A gesture that captured its own aim leaves the cursor alone.
      if (!capture?.aim) {
        const point = this.motionControls.capturePress(local);
        if (point) this.latestPoint = point;
      }
      this.edges[button] = (this.edges[button] + 1) % 256;
      // A gesture's press is dated to when it began, matching its captured aim.
      this.edgeTimes[button] =
        capture?.time ??
        this.environment.authorityTime() -
          (capture
            ? Math.min(MAX_BACKDATE_MS, Math.max(0, local - capture.at))
            : 0);
      this.effects.reliable({
        type: 'press',
        press: {
          generation: config.generation,
          button,
          counter: this.edges[button],
          time: this.edgeTimes[button],
          ...(capture?.aim ?? this.latestPoint),
          ...(both ? { value } : {}),
        },
      });
    }
    this.buttonState = down
      ? this.buttonState | mask
      : this.buttonState & ~mask;
  }
  haptic(ms = 10) {
    if (this.active && !this.terminal && this.config?.haptics.enabled)
      this.effects.haptic(ms);
  }
}
