import type { InputEnvironment, InputEffects } from './contracts.ts';
import type {
  ControlPort,
  ControllerConfig,
  Widget,
} from '../../controls/api.ts';
import type { MotionSnapshot } from '../../controls/motion/contracts.ts';
import {
  channelOf,
  PRESS_SLOTS,
  usesPressSlot,
} from '../../controls/registry.ts';
import {
  parseActivationValue,
  parseControlValue,
  valueFitsEnvelope,
} from '../../controls/value.ts';
import {
  clampGain,
  GyroPointer,
  pointerBounds,
  PointerSmoother,
} from '../../controls/motion/pointer.ts';
import { CHOP, ChopDetector } from '../../controls/motion/chop.ts';
import { encodeInput, type InputFrame } from '../../engine/protocol.ts';
import type { WidgetValueMessage } from '../../engine/reliable-input.ts';
import type { Point } from '../../../core/types.ts';

const WIDGET_THROTTLE_MS = 30;

export function screenTilt(point: Point, angle: number): Point {
  const radians = (Number.isFinite(angle) ? angle : 0) * Math.PI / 180;
  return {
    x: clampUnit(point.x * Math.cos(radians) + point.y * Math.sin(radians)),
    y: clampUnit(-point.x * Math.sin(radians) + point.y * Math.cos(radians)),
  };
}

/** Phone-side input processing. Transport and browser resource ownership stay outside. */
export class ControllerInput {
  private config: ControllerConfig | null = null;
  private active = false;
  private adjustingAim = false;
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
  private chopDetector = new ChopDetector();
  private lastChopSample = -1;
  /** The swing button is held: aim is frozen and swings whack. */
  private aimHeld = false;
  /** When the swing button was last let go, and the aim it had locked. */
  private releasedAt: number | null = null;
  private lockedAim: Point = { x: 0.5, y: 0.5 };
  private chops = 0;
  private pointerPoint: Point = { x: 0.5, y: 0.5 };
  private recenters = 0;
  /** Tilt that reads as level: the grip the player last recentered at. */
  private tiltZero: Point = { x: 0, y: 0 };
  private lastTilt: Point = { x: 0, y: 0 };
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
      adjustingAim: this.adjustingAim,
      point: Object.freeze(this.previewPoint()),
      sensitivity: this.gyroPointer.gain,
      recenters: this.recenters,
      chops: this.chops,
      aimHeld: this.aimHeld,
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
      config.schemaVersion !== 1 ||
      !Array.isArray(config.widgets) ||
      config.widgets.length > 24
    )
      return false;
    const changed =
      this.config?.generation !== config.generation ||
      this.config?.configId !== config.configId;
    this.config = structuredClone(config);
    // The game may keep the cursor inside its play field.
    const bounds = pointerBounds(config.sensors.pointer.bounds);
    this.gyroPointer.setBounds(bounds);
    this.gyroPointer.anchoring = config.sensors.pointer.anchor !== false;
    this.pointerPoint = {
      x: Math.min(bounds.right, Math.max(bounds.left, this.pointerPoint.x)),
      y: Math.min(bounds.bottom, Math.max(bounds.top, this.pointerPoint.y)),
    };
    if (changed) {
      this.letGoOfAim();
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
    return true;
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
    this.letGoOfAim();
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
  /**
   * The swing button. Holding it locks the aim where the big screen showed
   * the cursor as the thumb touched down; while held, a sharp swing whacks.
   * Releasing lets aiming move the cursor on from there at once, while the
   * swing's rebound never does.
   */
  holdAim(down: boolean) {
    const config = this.config;
    if (this.terminal || !this.active || !config?.sensors.chop?.enabled) return;
    const local = this.environment.localTime();
    if (down && !this.aimHeld) {
      this.aimHeld = true;
      this.releasedAt = null;
      this.chopDetector.reset();
      this.freezeAim(local - CHOP.touchLookbackMs);
    } else if (!down && this.aimHeld) {
      this.aimHeld = false;
      this.releasedAt = local;
      this.lockedAim = { ...this.latestPoint };
      if (config.sensors.pointer.enabled) {
        this.pointerPoint = this.latestPoint = this.gyroPointer.unlock(local);
        this.pointerSmoother.reset();
      }
    }
  }
  private freezeAim(captureAt: number) {
    if (!this.config?.sensors.pointer.enabled) return;
    this.pointerPoint = this.latestPoint = this.gyroPointer.lockAt(
      captureAt,
      CHOP.swing,
    );
    this.pointerSmoother.reset();
  }
  private letGoOfAim() {
    if (!this.aimHeld && this.releasedAt === null) return;
    this.aimHeld = false;
    this.releasedAt = null;
    this.gyroPointer.release(this.environment.localTime());
  }
  recenter() {
    if (this.terminal) return;
    this.gyroPointer.recenter();
    if (this.aimHeld) this.freezeAim(this.environment.localTime());
    this.pointerSmoother.reset();
    this.pointerPoint = this.latestPoint = this.gyroPointer.current;
    // Tilt is absolute, so recentering makes the current grip level.
    this.tiltZero = { ...this.lastTilt };
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
      this.chopDetector.reset();
      this.releasedAt = null;
      if (this.aimHeld) this.freezeAim(local);
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
    // Swings only whack while the button holds the aim still, or when one
    // already under way is recognised just after the button is let go.
    if (
      config.sensors.chop?.enabled &&
      motion.sequence !== this.lastChopSample
    ) {
      this.lastChopSample = motion.sequence;
      const sampleAt = motion.at!;
      const chop = motion.pointerFresh
        ? this.chopDetector.sample(
            motion.rate,
            motion.accelFresh ? motion.gravity : null,
            sampleAt,
          )
        : null;
      const widget = config.widgets.find((w) => w.type === 'chop'),
        releasedAt = this.releasedAt;
      if (
        chop &&
        widget &&
        (this.aimHeld ||
          (releasedAt !== null &&
            sampleAt - releasedAt <= CHOP.releaseGraceMs &&
            chop.onsetAt <= releasedAt))
      ) {
        this.chops++;
        this.haptic(20);
        // Always the locked aim, even once letting go has moved the cursor on.
        this.action(widget.action, chop.strength, config.generation, {
          at: chop.onsetAt,
          aim: this.aimHeld ? { ...this.latestPoint } : { ...this.lockedAim },
        });
      }
    }
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
            motion.aim,
          ),
          sampleAt,
        );
      }
      point = this.pointerPoint;
    } else if (config.sensors.tilt.enabled) {
      if (motion.accelFresh) this.lastTilt = { ...motion.tilt };
      point = motion.accelFresh
        ? screenTilt({
            x: motion.tilt.x - this.tiltZero.x,
            y: motion.tilt.y - this.tiltZero.y,
          }, this.environment.screenAngle?.() ?? 0)
        : { x: 0, y: 0 };
    }
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
        buttons: this.buttonState | this.aimHeldMask(),
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
  /** Frames show the swing's press slot held while the aim is locked. */
  private aimHeldMask() {
    if (!this.aimHeld || !this.config) return 0;
    const slot = this.config.widgets
      .filter((widget) => usesPressSlot(widget.type))
      .findIndex((widget) => widget.type === 'chop');
    return slot >= 0 && slot < PRESS_SLOTS ? 1 << slot : 0;
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
    capture?: { at: number; aim?: Point },
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
    } else if (widget.type === 'shake' || widget.type === 'chop') {
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
  press(
    action: string,
    down: boolean,
    generation = this.config?.generation,
    capture?: { at: number; aim?: Point },
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
      if (config.sensors.pointer.enabled && !capture?.aim) {
        this.pointerPoint = this.latestPoint =
          this.gyroPointer.holdForPress(local);
        this.pointerSmoother.reset();
      }
      this.edges[button] = (this.edges[button] + 1) % 256;
      // A gesture's press is dated to when it began, matching its captured aim.
      this.edgeTimes[button] =
        this.environment.authorityTime() -
        (capture
          ? Math.min(CHOP.maxBackdateMs, Math.max(0, local - capture.at))
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

const clampUnit = (v: number) => Math.max(-1, Math.min(1, v));
