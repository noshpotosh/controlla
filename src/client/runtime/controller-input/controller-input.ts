import type { ControlPort, ControllerConfig, Widget } from '../../controls/api.ts';
import type { MotionSnapshot } from '../../controls/motion/contracts.ts';
import { channelOf, PRESS_SLOTS, usesPressSlot } from '../../controls/registry.ts';
import {
  parseActivationValue,
  parseControlValue,
  valueFitsEnvelope,
} from '../../controls/value.ts';
import {
  clampGain,
  GyroPointer,
  PointerSmoother,
} from '../../controls/motion/pointer.ts';
import { encodeInput, type InputFrame } from '../../engine/protocol.ts';
import type { Press, WidgetValueMessage } from '../../engine/reliable-input.ts';
import type { Point } from '../../../core/types.ts';

export interface InputEnvironment {
  localTime(): number;
  authorityTime(): number;
  /** Schedule asynchronously; return cancellation. Retired callbacks are guarded too. */
  schedule(callback: () => void, delay: number): () => void;
}
export interface InputEffects {
  frame(data: ArrayBuffer): void;
  reliable(
    message:
      | WidgetValueMessage
      | { type: 'press'; press: Omit<Press, 'playerId'> },
  ): void;
  haptic(ms: number): void;
}
const WIDGET_THROTTLE_MS = 30;

/** Phone-side input processing. Transport and browser resource ownership stay outside. */
export class ControllerInput {
  private config: ControllerConfig | null = null;
  private active = false;
  private terminal = false;
  private epoch = 0;
  private lastSend = 0;
  private nextSend = 0;
  private pointerSmoother = new PointerSmoother();
  private seq = 0;
  private latestPoint: Point = { x: 0.5, y: 0.5 };
  private velocity: Point = { x: 0, y: 0 };
  private buttonState = 0;
  private edges = [0, 0, 0, 0];
  private edgeTimes = [0, 0, 0, 0];
  private gyroPointer = new GyroPointer();
  private lastPointerSample: number | null = null;
  private motionEpoch = -1;
  private lastShakeSample = -1;
  private pointerPoint: Point = { x: 0.5, y: 0.5 };
  private recenters = 0;
  private sendRate = 60;
  private lastShake = 0;
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
  ) {}

  getSnapshot() {
    return Object.freeze({
      epoch: this.epoch,
      point: Object.freeze(this.previewPoint()),
      sensitivity: this.gyroPointer.gain,
      recenters: this.recenters,
    });
  }

  configure(config: ControllerConfig) {
    if (this.terminal) return;
    const changed =
      this.config?.generation !== config.generation ||
      this.config?.configId !== config.configId;
    this.config = structuredClone(config);
    if (changed) {
      this.clearWidgetInput(true);
      this.edges = [0, 0, 0, 0];
      this.edgeTimes = [0, 0, 0, 0];
      this.buttonState = 0;
      this.seq = 0;
      this.nextSend = 0;
      this.pointerSmoother.reset();
      this.lastPointerSample = null;
      this.latestPoint = config.sensors.pointer.enabled
        ? { ...this.pointerPoint }
        : config.widgets.some((w) => w.space === 'normalized')
          ? { x: 0.5, y: 0.5 }
          : { x: 0, y: 0 };
    }
  }
  setRefreshRate(refreshRate: number) {
    if (this.terminal) return;
    this.sendRate = this.config?.sensors.pointer.enabled
      ? Math.min(this.config.sensors.pointer.rateHz, refreshRate)
      : 60;
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
  }
  end() {
    this.dispose();
  }
  dispose() {
    if (this.terminal) return;
    this.active = false;
    this.clearWidgetInput(true);
    this.buttonState = 0;
    this.terminal = true;
  }
  setSensitivity(gain: number) {
    if (!this.terminal) this.gyroPointer.gain = clampGain(gain);
  }
  recenter() {
    if (this.terminal) return;
    this.gyroPointer.recenter();
    this.pointerSmoother.reset();
    this.pointerPoint = this.latestPoint = this.gyroPointer.current;
    this.recenters++;
  }
  tick(motion: MotionSnapshot) {
    if (!this.active || this.terminal || !this.config) return;
    const config = this.config;
    const local = this.environment.localTime(),
      time = this.environment.authorityTime();
    let point = this.latestPoint;
    if (motion.epoch !== this.motionEpoch) {
      this.motionEpoch = motion.epoch;
      this.lastPointerSample = null;
      this.gyroPointer.resumeAt(this.pointerPoint);
      this.pointerSmoother.reset();
    }
    if (
      config.sensors.shake.enabled &&
      motion.accelFresh &&
      motion.sequence !== this.lastShakeSample &&
      Math.abs(Math.hypot(...motion.gravity) - 9.81) >
        config.sensors.shake.thresholdG * 9.81 &&
      local - this.lastShake > 600
    ) {
      this.lastShake = local;
      const shake = config.widgets.find((w) => w.type === 'shake');
      if (shake) this.action(shake.action, 1, config.generation);
    }
    this.lastShakeSample = motion.sequence;
    if (config.sensors.pointer.enabled && motion.pointerFresh) {
      // Integrate once per motion sample so a stalled sensor never replays
      // its last rate.
      const sampleAt = motion.at!;
      if (sampleAt !== this.lastPointerSample) {
        const dt =
          this.lastPointerSample !== null
            ? Math.min(0.05, (sampleAt - this.lastPointerSample) / 1000)
            : 0;
        this.lastPointerSample = sampleAt;
        this.pointerPoint = this.pointerSmoother.sample(
          this.gyroPointer.update(
            [...motion.rate],
            [...motion.up],
            dt,
            sampleAt,
          ),
          sampleAt,
        );
      }
      point = this.pointerPoint;
    } else if (config.sensors.tilt.enabled)
      point = motion.accelFresh ? motion.tilt : { x: 0, y: 0 };
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
        buttons: this.buttonState,
        edges: this.edges,
        edgeTimes: this.edgeTimes,
        confidence: config.sensors.pointer.enabled
          ? motion.confidence
          : config.sensors.tilt.enabled
            ? Number(motion.accelFresh)
            : 1,
      };
      this.effects.frame(encodeInput(frame));
    }
  }
  previewPoint() {
    return { ...this.latestPoint };
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
  action(action: string, raw: unknown, generation = this.config?.generation) {
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
    const sample: WidgetValueMessage = {
      type: 'widget',
      action,
      generation: config.generation,
      seq: (this.widgetSequences.get(action) ?? -1) + 1,
      time: this.environment.authorityTime(),
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
    } else if (widget.type === 'shake') {
      this.press(action, true, generation);
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
    if (!config?.sensors.pointer.enabled && !config?.sensors.tilt.enabled) {
      this.latestPoint = config?.widgets.some(
        (widget) => widget.space === 'normalized',
      )
        ? { x: 0.5, y: 0.5 }
        : { x: 0, y: 0 };
      this.velocity = { x: 0, y: 0 };
    }
    if (resetSequence) this.widgetSequences.clear();
  }
  press(action: string, down: boolean, generation = this.config?.generation) {
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
      if (config.sensors.pointer.enabled) {
        this.pointerPoint = this.latestPoint = this.gyroPointer.holdForPress(
          this.environment.localTime(),
        );
        this.pointerSmoother.reset();
      }
      this.edges[button] = (this.edges[button] + 1) % 256;
      this.edgeTimes[button] = this.environment.authorityTime();
      this.effects.reliable({
        type: 'press',
        press: {
          generation: config.generation,
          button,
          counter: this.edges[button],
          time: this.edgeTimes[button],
          ...this.latestPoint,
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
