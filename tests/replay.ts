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
import {
  GyroPointer,
  PointerSmoother,
} from '../src/client/controls/motion/pointer.ts';
import { CHOP } from '../src/client/controls/motion/chop.ts';
import { compassHeading } from '../src/client/controls/motion/heading.ts';
import { wrapAngle } from '../src/client/controls/motion/calibration.ts';
import {
  isMotionTrace,
  type MotionTrace,
  type TraceSegment,
} from '../src/client/controls/motion/trace.ts';
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

/**
 * The tilt pointer exactly as the controller runs it: `MotionProcessor.sample` per
 * event, one pointer integration per sample (dt capped at 50 ms), then the
 * adaptive smoother. Recorded taps act as presses; recorded holds lock the aim
 * for a swing, as Whack-a-Mole's button does. Anchored, as the controller
 * runs unless a game opts out; pass `anchor: false` for plain aim.
 */
export async function replayTilt(
  trace: MotionTrace,
  gain?: number,
  { anchor = true }: { anchor?: boolean } = {},
): Promise<CursorSample[]> {
  const { MotionProcessor } =
    await import('../src/client/controls/motion/processor.ts');

  const motion = new MotionProcessor(),
    pointer = new GyroPointer(),
    smoother = new PointerSmoother();
  if (gain !== undefined) pointer.gain = gain;
  pointer.anchoring = anchor;
  const presses = [
    ...trace.segments.flatMap((s) =>
      (s.taps ?? []).map((t) => ({ t, kind: 'tap' as const })),
    ),
    ...trace.segments.flatMap((s) =>
      (s.holds ?? []).flatMap(([down, up]) => [
        { t: down, kind: 'down' as const },
        { t: up, kind: 'up' as const },
      ]),
    ),
  ].sort((a, b) => a.t - b.t);
  const out: CursorSample[] = [];
  let last = 0,
    press = 0;
  for (const sample of trace.samples) {
    while (press < presses.length && presses[press].t <= sample.t) {
      const { t, kind } = presses[press++],
        at = t - sample.t + sample.at;
      if (kind === 'tap') pointer.holdForPress(at);
      else if (kind === 'down')
        pointer.lockAt(at - CHOP.touchLookbackMs, CHOP.swing);
      else pointer.unlock(at);
      smoother.reset();
    }
    motion.sample(sample);
    const dt = last ? Math.min(0.05, (sample.at - last) / 1000) : 0;
    last = sample.at;
    const p = smoother.sample(
      pointer.update(
        motion.rate,
        motion.up,
        dt,
        sample.at,
        anchor ? motion.aim : undefined,
      ),
      sample.at,
    );
    out.push({ ...p, at: sample.at, t: sample.t });
  }
  return out;
}

/**
 * How far the cursor strays from where the phone points: segments labelled
 * `center…` all point at the middle of the TV, so each one's resting cursor
 * is compared with the first's (% of width / height).
 */
export function returnErrors(trace: MotionTrace, cursor: CursorSample[]) {
  const rest = (segment: TraceSegment) => {
    // The second half, once the player has settled.
    const from = (segment.start + segment.end) / 2,
      path = cursor.filter((c) => c.t >= from && c.t <= segment.end);
    return path.length
      ? {
          x: path.reduce((sum, c) => sum + c.x, 0) / path.length,
          y: path.reduce((sum, c) => sum + c.y, 0) / path.length,
        }
      : null;
  };
  const centers = trace.segments.filter((s) => s.label.startsWith('center')),
    home = centers[0] && rest(centers[0]);
  if (!home) return [];
  return centers.slice(1).flatMap((segment) => {
    const at = rest(segment);
    return at
      ? [
          {
            label: segment.label,
            dx: (at.x - home.x) * 100,
            dy: (at.y - home.y) * 100,
          },
        ]
      : [];
  });
}

export interface CompassReport {
  readings: number;
  hz: number;
  /** Median accuracy iOS reported (degrees), or null when unrated. */
  accuracy: number | null;
  /** Spread of the heading while pointing still (degrees, standard deviation). */
  noise: number | null;
  /** The compass lag that best matches the gyro's turns (ms), or null. */
  lagMs: number | null;
}

/** What the compass in a trace is like, to tune `COMPASS` against. */
export async function compassReport(
  trace: MotionTrace,
): Promise<CompassReport> {
  const { MotionProcessor } =
    await import('../src/client/controls/motion/processor.ts');
  const motion = new MotionProcessor(),
    gyro: { at: number; yaw: number }[] = [],
    readings: { at: number; t: number; heading: number }[] = [],
    accuracies: number[] = [];
  for (const sample of trace.samples) {
    motion.sample(sample);
    const o = sample.orientation,
      heading = o ? compassHeading(o) : null;
    if (o && heading !== null) {
      readings.push({ at: o.at, t: o.t, heading });
      if (o.accuracy !== null && o.accuracy >= 0) accuracies.push(o.accuracy);
    }
    const yaw = motion.aim.yaw;
    if (yaw !== null)
      gyro.push({ at: sample.at, yaw: wrapAngle(yaw - motion.compass.offset) });
  }
  const span =
    readings.length > 1 ? (readings.at(-1)!.at - readings[0].at) / 1000 : 0;
  const DEG = 180 / Math.PI;
  const circularSpread = (angles: number[]) => {
    if (angles.length < 2) return null;
    const mean = Math.atan2(
      angles.reduce((s, a) => s + Math.sin(a), 0),
      angles.reduce((s, a) => s + Math.cos(a), 0),
    );
    return (
      Math.sqrt(
        angles.reduce((s, a) => s + wrapAngle(a - mean) ** 2, 0) /
          angles.length,
      ) * DEG
    );
  };
  const inside = (labels: (label: string) => boolean) => (t: number) =>
    trace.segments.some((s) => labels(s.label) && t >= s.start && t <= s.end);
  const still = inside((l) => l.startsWith('center') || l === 'still'),
    turning = inside((l) => l.includes('turn'));
  // Lag: the delay at which compass minus gyro heading varies least while turning.
  let lagMs: number | null = null,
    best = Infinity;
  const turns = readings.filter((r) => turning(r.t));
  if (turns.length > 30 && gyro.length > 30)
    for (let lag = 0; lag <= 800; lag += 20) {
      const residuals = turns.flatMap((r) => {
        let g: number | null = null;
        for (const h of gyro) if (h.at <= r.at - lag) g = h.yaw;
        return g === null ? [] : [wrapAngle(r.heading - g)];
      });
      const spread = circularSpread(residuals);
      if (spread !== null && spread < best) {
        best = spread;
        lagMs = lag;
      }
    }
  accuracies.sort((a, b) => a - b);
  return {
    readings: readings.length,
    hz: span > 0 ? (readings.length - 1) / span : 0,
    accuracy: accuracies.length
      ? accuracies[Math.floor(accuracies.length / 2)]
      : null,
    noise: circularSpread(
      readings.filter((r) => still(r.t)).map((r) => r.heading),
    ),
    lagMs,
  };
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
    const compass = await compassReport(trace);
    if (compass.readings)
      console.log(
        `  compass: ${compass.readings} readings (${compass.hz.toFixed(0)} Hz), accuracy ${compass.accuracy ?? 'n/a'}°, still noise ${compass.noise?.toFixed(2) ?? 'n/a'}°, best lag ${compass.lagMs ?? 'n/a'} ms`,
      );
    else console.log('  compass: none recorded');
    const plain = await replayTilt(trace, undefined, { anchor: false }),
      before = returnErrors(trace, plain),
      after = returnErrors(trace, cursor);
    if (before.length)
      console.table(
        before.map((b, i) => ({
          'back at center': b.label,
          'plain dx/dy %': `${b.dx.toFixed(1)} / ${b.dy.toFixed(1)}`,
          'anchored dx/dy %': `${after[i].dx.toFixed(1)} / ${after[i].dy.toFixed(1)}`,
        })),
      );
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main(process.argv.slice(2)).catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
