/**
 * Replays recorded motion traces through the controller's pointer pipeline.
 *
 *   npm run replay                  # every trace in tests/fixtures/motion
 *   npm run replay -- <trace.json>  # one trace
 *
 * Library use (tests): `loadTrace`, `replayTilt`, `segmentReport`.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { GyroPointer, PointerSmoother } from '../src/core/pointer.ts';
import {
  isMotionTrace,
  type MotionTrace,
  type RawMotionSample,
  type TraceSegment,
} from '../src/core/motion/trace.ts';
import type { Point } from '../src/core/types.ts';

export const FIXTURE_DIR = resolve(import.meta.dirname, 'fixtures', 'motion');

export function loadTrace(path: string): MotionTrace {
  const trace: unknown = JSON.parse(readFileSync(path, 'utf8'));
  if (!isMotionTrace(trace)) throw new Error(`${path} is not a motion trace`);
  return trace;
}

export function fixtureTraces(): string[] {
  try {
    return readdirSync(FIXTURE_DIR)
      .filter((f) => f.endsWith('.json'))
      .sort()
      .map((f) => join(FIXTURE_DIR, f));
  } catch {
    return [];
  }
}

export interface CursorSample extends Point {
  /** `at` of the motion sample that produced this point. */
  at: number;
  /** Sample `t`, for matching against segments. */
  t: number;
}

/** Browser globals `Motion` touches, stubbed for Node. */
function withBrowserStubs<T>(clock: { now: number }, run: () => T): T {
  const g = globalThis as Record<string, unknown>;
  const saved = new Map<string, PropertyDescriptor | undefined>();
  const stub = (key: string, value: unknown) => {
    saved.set(key, Object.getOwnPropertyDescriptor(g, key));
    Object.defineProperty(g, key, {
      value,
      configurable: true,
      writable: true,
    });
  };
  stub('window', globalThis);
  stub('innerWidth', 390);
  stub('innerHeight', 844);
  stub('devicePixelRatio', 3);
  const nowDescriptor = Object.getOwnPropertyDescriptor(performance, 'now');
  Object.defineProperty(performance, 'now', {
    value: () => clock.now,
    configurable: true,
  });
  try {
    return run();
  } finally {
    if (nowDescriptor) Object.defineProperty(performance, 'now', nowDescriptor);
    else Reflect.deleteProperty(performance, 'now');
    for (const [key, descriptor] of saved)
      if (descriptor) Object.defineProperty(g, key, descriptor);
      else Reflect.deleteProperty(g, key);
  }
}

const toEvent = (s: RawMotionSample) =>
  ({
    timeStamp: s.t,
    interval: s.interval,
    acceleration: s.accel && { x: s.accel[0], y: s.accel[1], z: s.accel[2] },
    accelerationIncludingGravity: s.accelG && {
      x: s.accelG[0],
      y: s.accelG[1],
      z: s.accelG[2],
    },
    rotationRate: s.rate && {
      alpha: s.rate[0],
      beta: s.rate[1],
      gamma: s.rate[2],
    },
  }) as unknown as DeviceMotionEvent;

/**
 * The tilt pointer exactly as the controller runs it: `Motion.sample` per
 * event, one pointer integration per sample (dt capped at 50 ms), then the
 * adaptive smoother. Recorded taps act as presses.
 */
export async function replayTilt(
  trace: MotionTrace,
  gain?: number,
): Promise<CursorSample[]> {
  const { Motion } = await import('../src/client/motion.ts');
  const clock = { now: trace.samples[0]?.at ?? 0 };
  return withBrowserStubs(clock, () => {
    const motion = new Motion(),
      pointer = new GyroPointer(),
      smoother = new PointerSmoother();
    if (gain !== undefined) pointer.gain = gain;
    const taps = trace.segments
      .flatMap((s) => s.taps ?? [])
      .sort((a, b) => a - b);
    const out: CursorSample[] = [];
    let last = 0,
      tap = 0;
    for (const sample of trace.samples) {
      while (tap < taps.length && taps[tap] <= sample.t) {
        pointer.holdForPress(taps[tap] - sample.t + sample.at);
        smoother.reset();
        tap++;
      }
      clock.now = sample.at;
      motion.sample(toEvent(sample));
      const dt = last ? Math.min(0.05, (sample.at - last) / 1000) : 0;
      last = sample.at;
      const p = smoother.sample(
        pointer.update(motion.rate, motion.up, dt, sample.at),
        sample.at,
      );
      out.push({ ...p, at: sample.at, t: sample.t });
    }
    return out;
  });
}

const rms = (values: number[]) =>
  values.length
    ? Math.sqrt(values.reduce((sum, v) => sum + v * v, 0) / values.length)
    : 0;

export interface SegmentReport {
  label: string;
  samples: number;
  seconds: number;
  /** RMS of each reported rotation channel [alpha, beta, gamma] (°/s). */
  rateRms: number[];
  /** Which reported rotation channel moved most. */
  rateChannel: string;
  /** RMS of gravity-removed acceleration [x, y, z] (m/s²), if reported. */
  accelRms: number[] | null;
  /** Axis and sign of the first acceleration pulse above 1 m/s². */
  firstPush: string;
  /** Cursor change over the segment (% of width / height). */
  dx: number;
  dy: number;
  /** Largest distance from the starting cursor position (% of width). */
  excursion: number;
}

export function segmentReport(
  trace: MotionTrace,
  cursor: CursorSample[],
  segment: TraceSegment,
): SegmentReport {
  const inside = (t: number) => t >= segment.start && t <= segment.end,
    samples = trace.samples.filter((s) => inside(s.t)),
    path = cursor.filter((c) => inside(c.t)),
    rates = [0, 1, 2].map((i) => rms(samples.map((s) => s.rate?.[i] ?? 0))),
    accel = samples.every((s) => s.accel)
      ? [0, 1, 2].map((i) => rms(samples.map((s) => s.accel![i])))
      : null,
    names = ['alpha', 'beta', 'gamma'];
  let firstPush = '—';
  for (const s of samples) {
    const a = s.accel;
    if (!a) break;
    const i = [0, 1, 2].reduce(
      (m, j) => (Math.abs(a[j]) > Math.abs(a[m]) ? j : m),
      0,
    );
    if (Math.abs(a[i]) > 1) {
      firstPush = `${a[i] > 0 ? '+' : '-'}${'xyz'[i]}`;
      break;
    }
  }
  const start = path[0],
    end = path.at(-1);
  return {
    label: segment.label,
    samples: samples.length,
    seconds: (segment.end - segment.start) / 1000,
    rateRms: rates,
    rateChannel: names[rates.indexOf(Math.max(...rates))],
    accelRms: accel,
    firstPush,
    dx: start && end ? (end.x - start.x) * 100 : 0,
    dy: start && end ? (end.y - start.y) * 100 : 0,
    excursion: start
      ? Math.max(
          0,
          ...path.map((c) => Math.hypot(c.x - start.x, c.y - start.y)),
        ) * 100
      : 0,
  };
}

async function main(paths: string[]) {
  const files = paths.length ? paths : fixtureTraces();
  if (!files.length) {
    console.log(
      'No traces yet. Record some in the Motion Lab (Aim settings → Motion lab).',
    );
    return;
  }
  for (const file of files) {
    const trace = loadTrace(file),
      cursor = await replayTilt(trace),
      span =
        trace.samples.length > 1
          ? (trace.samples.at(-1)!.t - trace.samples[0].t) / 1000
          : 0;
    console.log(
      `\n${trace.name} — ${trace.samples.length} samples over ${span.toFixed(1)} s (${Math.round(trace.samples.length / Math.max(span, 0.001))} Hz)`,
    );
    console.log(`  ${trace.device.userAgent}`);
    console.table(
      trace.segments.map((segment) => {
        const r = segmentReport(trace, cursor, segment);
        return {
          segment: r.label,
          'rotation α/β/γ °/s': r.rateRms.map((v) => v.toFixed(0)).join(' / '),
          'most rotation': r.rateChannel,
          'accel x/y/z m/s²': r.accelRms
            ? r.accelRms.map((v) => v.toFixed(2)).join(' / ')
            : 'n/a',
          'first push': r.firstPush,
          'tilt cursor dx %': r.dx.toFixed(1),
          'tilt cursor dy %': r.dy.toFixed(1),
          'max move %': r.excursion.toFixed(1),
        };
      }),
    );
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  await main(process.argv.slice(2));
