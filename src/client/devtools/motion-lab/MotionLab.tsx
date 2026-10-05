'use client';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type {
  ControllerPanelProps,
  MotionDiagnosticsPort,
} from '../../shell/extensions.ts';
import type {
  MotionTrace,
  RawMotionSample,
  RawOrientationSample,
  TraceSegment,
  Vec3,
} from '../../controls/motion/trace.ts';
import { compassDegrees } from '../../controls/motion/heading.ts';

interface Step {
  label: string;
  prompt: string;
  seconds: number;
  taps?: boolean;
  /** Shows a button to hold while swinging, like Whack-a-Mole's. */
  holds?: boolean;
}

/** Guided recording: each step becomes a labelled segment in the trace. */
export const RECORDING_SCRIPT: Step[] = [
  {
    label: 'still',
    prompt: 'Hold the phone like a remote, screen up, and keep it still.',
    seconds: 4,
  },
  {
    label: 'wiggle',
    prompt: 'Wiggle it: tilt and twist every which way, hand in place.',
    seconds: 4,
  },
  {
    label: 'tilt-roll',
    prompt: 'Roll it left and right (tip the side edges), hand in place.',
    seconds: 4,
  },
  {
    label: 'tilt-pitch',
    prompt: 'Tip the top edge up and down, hand in place.',
    seconds: 4,
  },
  {
    label: 'turn',
    prompt: 'Keep it flat and swivel the top edge left and right.',
    seconds: 4,
  },
  {
    label: 'move-right',
    prompt: 'Keep it level. Move the whole phone ~30 cm right, then hold.',
    seconds: 3,
  },
  {
    label: 'move-left',
    prompt: 'Keep it level. Move it ~30 cm left, then hold.',
    seconds: 3,
  },
  {
    label: 'move-up',
    prompt: 'Keep it level. Raise it ~30 cm, then hold.',
    seconds: 3,
  },
  {
    label: 'move-down',
    prompt: 'Keep it level. Lower it ~30 cm, then hold.',
    seconds: 3,
  },
  {
    label: 'slow-drag',
    prompt: 'Keep it level. Slowly slide it ~20 cm right over 2 seconds.',
    seconds: 4,
  },
  {
    label: 'taps',
    prompt: 'Hold it steady and tap the big button 5 times.',
    seconds: 6,
    taps: true,
  },
  {
    label: 'chop',
    prompt:
      'Point at the TV, then chop down like swinging a hammer. Do it 5 times, pausing between.',
    seconds: 8,
  },
  {
    label: 'aim-down',
    prompt:
      'No chops: aim quickly at the bottom of the TV and back up, 5 times.',
    seconds: 6,
  },
  {
    label: 'free',
    prompt: 'Point around at the TV however feels natural.',
    seconds: 8,
  },
];

/**
 * Guided recording for anchoring aim to the compass. Segments labelled
 * `center…` all point at the middle of the TV, so replay can measure how far
 * the cursor has drifted from where the phone points.
 */
export const COMPASS_SCRIPT: Step[] = [
  {
    label: 'center',
    prompt:
      'Hold it like a remote, screen up. Point at the middle of the TV and keep still.',
    seconds: 4,
  },
  {
    label: 'turn-return',
    prompt:
      'Point at the right edge of the TV, then back at the middle. Do it 3 times, then hold.',
    seconds: 8,
  },
  {
    label: 'center-after-turns',
    prompt: 'Point at the middle of the TV and keep still.',
    seconds: 3,
  },
  {
    label: 'whacks',
    prompt:
      'Point at the middle. Hold the button and whack 6 times, pointing back at the middle after each.',
    seconds: 12,
    holds: true,
  },
  {
    label: 'center-after-whacks',
    prompt: 'Point at the middle of the TV and keep still.',
    seconds: 3,
  },
  {
    label: 'pitch-sweep',
    prompt:
      'Keep pointing at the middle while slowly tipping up to the top of the TV and back down.',
    seconds: 6,
  },
  {
    label: 'slow-turn',
    prompt:
      'Very slowly turn to the right edge of the TV over 5 seconds, then hold.',
    seconds: 7,
  },
  {
    label: 'center-after-slow-turn',
    prompt: 'Point at the middle of the TV and keep still.',
    seconds: 3,
  },
  {
    label: 'center-long',
    prompt: 'Keep pointing at the middle of the TV. Hold still for 20 seconds.',
    seconds: 20,
  },
];
const SCRIPTS = { guided: RECORDING_SCRIPT, compass: COMPASS_SCRIPT };
type Script = keyof typeof SCRIPTS;
const READY_SECONDS = 2;
const CAPTURE_SECONDS = 30;

type Phase =
  | { kind: 'idle' }
  | {
      kind: 'recording';
      script: Script;
      step: number;
      ready: boolean;
      until: number;
    }
  | {
      kind: 'done';
      trace: MotionTrace;
      upload: 'sending' | 'saved' | 'failed';
      message: string;
    };

const round = (n: number, digits: number) => {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
};
const roundVec = (v: Vec3 | null, digits: number): Vec3 | null =>
  v ? [round(v[0], digits), round(v[1], digits), round(v[2], digits)] : null;
/** Sensor precision is far coarser than a double; keep uploads small. */
const compact = (s: RawMotionSample): RawMotionSample => ({
  ...(s.screenAngle === undefined ? {} : { screenAngle: s.screenAngle }),
  t: round(s.t, 2),
  at: round(s.at, 2),
  interval: s.interval === null ? null : round(s.interval, 2),
  accel: roundVec(s.accel, 4),
  accelG: roundVec(s.accelG, 4),
  rate: roundVec(s.rate, 3),
  ...(s.orientation ? { orientation: compactOrientation(s.orientation) } : {}),
});
const roundOrNull = (n: number | null, digits: number) =>
  n === null ? null : round(n, digits);
const compactOrientation = (o: RawOrientationSample): RawOrientationSample => ({
  t: round(o.t, 2),
  at: round(o.at, 2),
  alpha: roundOrNull(o.alpha, 3),
  beta: roundOrNull(o.beta, 3),
  gamma: roundOrNull(o.gamma, 3),
  absolute: o.absolute,
  heading: roundOrNull(o.heading, 3),
  accuracy: roundOrNull(o.accuracy, 1),
});

function defaultName() {
  const ua = navigator.userAgent;
  if (/iPhone/.test(ua)) return 'iphone';
  const model = /Android[^;]*;\s*([^;)]+?)(?:\sBuild|\))/.exec(ua)?.[1];
  return model ? model.trim() : 'phone';
}

function buildTrace(
  name: string,
  samples: RawMotionSample[],
  segments: TraceSegment[],
): MotionTrace {
  return {
    version: 1,
    name,
    recordedAt: new Date().toISOString(),
    device: {
      userAgent: navigator.userAgent,
      screen: {
        w: screen.width,
        h: screen.height,
        dpr: devicePixelRatio || 1,
      },
    },
    samples: samples.map(compact),
    segments,
  };
}

export function MotionLab({ motion, onClose }: ControllerPanelProps) {
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const [name, setName] = useState(defaultName);
  const recorded = useRef<RawMotionSample[]>([]);
  const segments = useRef<TraceSegment[]>([]);
  const recording = useRef(false);

  useEffect(() => {
    motion.start();
    return motion.subscribe((sample) => {
      if (recording.current) recorded.current.push(sample);
    });
  }, [motion]);

  function start(script: Script) {
    recorded.current = [];
    segments.current = [];
    recording.current = true;
    setPhase({
      kind: 'recording',
      script,
      step: 0,
      ready: true,
      until: performance.now() + READY_SECONDS * 1000,
    });
  }

  function cancel() {
    recording.current = false;
    setPhase({ kind: 'idle' });
  }

  function captureLast() {
    const end = performance.now(),
      start = end - CAPTURE_SECONDS * 1000,
      samples = motion.recentSamples().filter((s) => s.t >= start);
    finish(samples, [
      {
        label: 'capture',
        prompt: `Saved from the last ${CAPTURE_SECONDS} seconds`,
        start,
        end,
      },
    ]);
  }

  function finish(samples: RawMotionSample[], segs: TraceSegment[]) {
    recording.current = false;
    const trace = buildTrace(name || 'phone', samples, segs);
    setPhase({
      kind: 'done',
      trace,
      upload: 'sending',
      message: `Uploading ${samples.length} samples…`,
    });
    fetch('/__controlla/motion-trace', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(trace),
    })
      .then(async (response) => {
        const body = (await response.json()) as {
          path?: string;
          error?: string;
        };
        if (!response.ok || !body.path)
          throw new Error(body.error ?? `HTTP ${response.status}`);
        setPhase({
          kind: 'done',
          trace,
          upload: 'saved',
          message: `Saved to ${body.path}`,
        });
      })
      .catch((error: unknown) =>
        setPhase({
          kind: 'done',
          trace,
          upload: 'failed',
          message: `Upload failed (${error instanceof Error ? error.message : 'unknown error'}). Download it instead.`,
        }),
      );
  }

  function download(trace: MotionTrace) {
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(trace)], { type: 'application/json' }),
    );
    const a = document.createElement('a');
    a.href = url;
    a.download = `${trace.name}-motion.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  // Advance the guided script: a short "get ready", then the recorded step.
  useEffect(() => {
    if (phase.kind !== 'recording') return;
    const timer = setInterval(() => {
      const t = performance.now();
      if (t < phase.until) return;
      const script = SCRIPTS[phase.script],
        step = script[phase.step];
      if (phase.ready) {
        segments.current.push({
          label: step.label,
          prompt: step.prompt,
          start: t,
          end: t + step.seconds * 1000,
          ...(step.taps ? { taps: [] } : {}),
          ...(step.holds ? { holds: [] } : {}),
        });
        setPhase({
          kind: 'recording',
          script: phase.script,
          step: phase.step,
          ready: false,
          until: t + step.seconds * 1000,
        });
      } else if (phase.step + 1 < script.length)
        setPhase({
          kind: 'recording',
          script: phase.script,
          step: phase.step + 1,
          ready: true,
          until: t + READY_SECONDS * 1000,
        });
      else finish(recorded.current, segments.current);
    }, 50);
    return () => clearInterval(timer);
  });

  const granted = motion.permission() === 'granted';
  const script = phase.kind === 'recording' ? SCRIPTS[phase.script] : [],
    step = phase.kind === 'recording' ? script[phase.step] : undefined;
  /** When the hold button went down, while it is held. */
  const holdDown = useRef<number | null>(null);
  const endHold = (at: number) => {
    const down = holdDown.current;
    holdDown.current = null;
    if (down !== null) segments.current.at(-1)?.holds?.push([down, at]);
  };

  return (
    <div className="motion-lab">
      <div className="motion-lab-head">
        <span className="eyebrow lime">MOTION LAB</span>
        <Button size="sm" variant="outline" onClick={onClose}>
          Close
        </Button>
      </div>
      {!granted ? (
        <p className="error">Tap Enable motion first.</p>
      ) : phase.kind === 'idle' ? (
        <>
          <p className="note">
            Records exactly what your phone’s motion sensors report, so we can
            tune pointing against real data. The guided set takes about 75
            seconds.
          </p>
          <div className="motion-lab-name">
            <label htmlFor="motion-lab-name">Phone name</label>
            <Input
              id="motion-lab-name"
              value={name}
              maxLength={40}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <Button className="action" onClick={() => start('guided')}>
            Record guided set
          </Button>
          <Button variant="outline" onClick={() => start('compass')}>
            Record compass set (about 70 s)
          </Button>
          <Button variant="outline" onClick={captureLast}>
            Save the last {CAPTURE_SECONDS} seconds
          </Button>
        </>
      ) : phase.kind === 'recording' && step ? (
        <div className="motion-lab-step">
          <span className="eyebrow">
            STEP {phase.step + 1} OF {script.length}
          </span>
          <h1>{phase.ready ? 'Get ready…' : step.prompt}</h1>
          {phase.ready ? <p className="note">Next: {step.prompt}</p> : null}
          <Countdown until={phase.until} />
          {step.taps && !phase.ready ? (
            <Button
              className="action motion-lab-tap"
              onPointerDown={(e) =>
                segments.current.at(-1)?.taps?.push(e.timeStamp)
              }
            >
              Tap
            </Button>
          ) : null}
          {step.holds && !phase.ready ? (
            <Button
              className="action motion-lab-tap"
              onPointerDown={(e) => {
                holdDown.current = e.timeStamp;
              }}
              onPointerUp={(e) => endHold(e.timeStamp)}
              onPointerCancel={(e) => endHold(e.timeStamp)}
            >
              Hold to whack
            </Button>
          ) : null}
          <Button variant="outline" onClick={cancel}>
            Cancel
          </Button>
        </div>
      ) : phase.kind === 'done' ? (
        <>
          <output className={phase.upload === 'failed' ? 'error' : 'note'}>
            {phase.message}
          </output>
          <Button variant="outline" onClick={() => download(phase.trace)}>
            Download JSON
          </Button>
          <Button className="action" onClick={() => setPhase({ kind: 'idle' })}>
            Record another
          </Button>
        </>
      ) : null}
      <LiveReadout motion={motion} />
    </div>
  );
}

function Countdown({ until }: { until: number }) {
  const [left, setLeft] = useState<number | null>(null);
  useEffect(() => {
    const update = () =>
      setLeft(Math.max(0, (until - performance.now()) / 1000));
    update();
    const timer = setInterval(update, 100);
    return () => clearInterval(timer);
  }, [until]);
  return (
    <p className="motion-lab-countdown">
      {left === null ? '' : `${left.toFixed(1)} s`}
    </p>
  );
}

interface Readout {
  hz: number;
  accelAvailable: boolean;
  still: boolean;
  rate: number[];
  accel: number[];
  /** Latest compass reading, if the phone reports one. */
  compass: RawOrientationSample | null;
}

/** Snapshot of the recent samples: rate, stillness, per-channel peaks. */
function summarize(samples: RawMotionSample[]): Readout | null {
  const last = samples.at(-1);
  if (!last) return null;
  const span = samples.length > 1 ? last.t - samples[0].t : 0,
    tail = samples.slice(-12),
    recent = samples.slice(-30),
    // Peak magnitude per channel over the last ~0.5 s shows which one reacts.
    peaks = (pick: (s: RawMotionSample) => Vec3 | null) =>
      [0, 1, 2].map((i) =>
        Math.max(0, ...recent.map((s) => Math.abs(pick(s)?.[i] ?? 0))),
      );
  return {
    hz: span > 0 ? ((samples.length - 1) * 1000) / span : 0,
    accelAvailable: last.accel !== null,
    still:
      tail.length >= 12 &&
      tail.every(
        (s) =>
          s.accel !== null &&
          s.rate !== null &&
          Math.hypot(...s.accel) < 0.15 &&
          Math.hypot(...s.rate) < 8,
      ),
    rate: peaks((s) => s.rate),
    accel: peaks((s) => s.accel),
    compass: samples.findLast((s) => s.orientation)?.orientation ?? null,
  };
}

/** Live sensor view: which channels respond to which movement. */
function LiveReadout({ motion }: { motion: MotionDiagnosticsPort }) {
  const [readout, setReadout] = useState<Readout | null>(null);
  useEffect(() => {
    const recent: RawMotionSample[] = [];
    const off = motion.subscribe((s) => {
      recent.push(s);
      if (recent.length > 120) recent.shift();
    });
    const timer = setInterval(() => setReadout(summarize(recent)), 100);
    return () => {
      off();
      clearInterval(timer);
    };
  }, [motion]);

  if (!readout) return <p className="note">Waiting for motion samples…</p>;
  return (
    <div className="motion-lab-live" aria-label="Live motion readout">
      <p className="note">
        {Math.round(readout.hz)} samples/s · gravity-free acceleration{' '}
        {readout.accelAvailable ? 'available' : 'missing'} ·{' '}
        <span className={readout.still ? 'lime' : ''}>
          {readout.still ? '● still' : '○ moving'}
        </span>
      </p>
      <p className="note">
        Compass: <CompassReading reading={readout.compass} />
      </p>
      <Bars
        title="Rotation (as reported)"
        names={['alpha', 'beta', 'gamma']}
        values={readout.rate}
        full={200}
        unit="°/s"
      />
      <Bars
        title="Hand acceleration (gravity removed)"
        names={['x', 'y', 'z']}
        values={readout.accel}
        full={5}
        unit="m/s²"
      />
    </div>
  );
}

function CompassReading({ reading }: { reading: RawOrientationSample | null }) {
  if (!reading) return <>no orientation events</>;
  if (reading.accuracy !== null && reading.accuracy < 0)
    return <>uncalibrated (wave the phone in a figure 8)</>;
  const heading = compassDegrees(reading);
  if (heading === null) return <>no heading (orientation is relative)</>;
  return (
    <>
      {heading.toFixed(1)}°
      {reading.accuracy === null ? '' : ` · ±${reading.accuracy.toFixed(0)}°`}
    </>
  );
}

function Bars({
  title,
  names,
  values,
  full,
  unit,
}: {
  title: string;
  names: string[];
  values: number[];
  full: number;
  unit: string;
}) {
  return (
    <div className="motion-lab-bars">
      <span>{title}</span>
      {names.map((n, i) => (
        <div key={n} className="motion-lab-bar">
          <span>{n}</span>
          <i style={{ width: `${Math.min(100, (values[i] / full) * 100)}%` }} />
          <small>
            {values[i].toFixed(unit === '°/s' ? 0 : 2)} {unit}
          </small>
        </div>
      ))}
    </div>
  );
}
