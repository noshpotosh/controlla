import { readFile } from 'node:fs/promises';

// Analyze saved renderer reports without running a core or reading game files.
const paths = process.argv.slice(2);
if (paths.length !== 2) {
  console.error('Usage: node scripts/mario-kart/analyze-race.mjs <start.json> <end.json>');
  process.exit(1);
}
const frames = await Promise.all(paths.map(async path => {
  const report = JSON.parse(await readFile(path, 'utf8'));
  if (!report.frame?.causalTelemetry) throw new Error(`${path}: missing frame telemetry`);
  return report.frame;
}));
const [start, end] = frames;
const positiveDelta = (label, a, b) => {
  if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a)
    throw new Error(`${label}: expected finite increasing counters`);
  return b - a;
};
for (const key of ['loadedCheckpointGeneration', 'loadedCheckpointTicks', 'loadedCheckpointPpcPc']) {
  if (start[key] == null || start[key] !== end[key])
    throw new Error(`${key}: interval crosses or lacks a restored checkpoint`);
}
if (start.loadedCheckpointGeneration < 1) throw new Error('Race checkpoint has not loaded');
const seconds = positiveDelta('wall time', start.causalTelemetry.capturedAtMs,
  end.causalTelemetry.capturedAtMs) / 1000;
const presentedFrames = positiveDelta('presented frames', start.presentedFrame, end.presentedFrame);
const ticks = positiveDelta('simulation ticks', start.coreTicks, end.coreTicks);
if (!Number.isFinite(start.coreTicksPerSecond) || start.coreTicksPerSecond <= 0 ||
    start.coreTicksPerSecond !== end.coreTicksPerSecond)
  throw new Error('Missing or changed simulation clock rate');
const webgpu = frames.map(frame => frame.causalTelemetry.webgpu);
const flags = ['stateCacheEnabled', 'producerStateCacheEnabled', 'consumerStateCacheEnabled',
  'uboCacheEnabled', 'uniformFastEnabled', 'uboPackEnabled', 'geometryPackEnabled'];
const configuration = {};
for (const key of flags) {
  if (webgpu[0]?.[key] !== webgpu[1]?.[key]) throw new Error(`${key}: changed during interval`);
  configuration[key] = webgpu[1]?.[key] ?? null;
}
const warnings = ['Single interval; host load and exact scene progression are not controlled.'];
const parseEligibility = frame => {
  const report = /fpelig:v=1,scope=remaining-helper-calls([^|]*)/.exec(frame.ppcWasmHelperStats ?? '');
  if (!report) return null;
  const buckets = new Map();
  for (const entry of report[1].matchAll(/;mode=(\d+),rc=(\d+),zero1=(\d+),calls=(\d+)/g)) {
    const [mode, rc, zero1, calls] = entry.slice(1).map(Number);
    if (mode > 7 || rc > 1 || zero1 > 1 || !Number.isSafeInteger(calls))
      throw new Error('Invalid paired FP eligibility bucket');
    const key = mode | (rc << 3) | (zero1 << 4);
    if (buckets.has(key)) throw new Error('Duplicate paired FP eligibility bucket');
    buckets.set(key, calls);
  }
  return buckets;
};
const eligibility = frames.map(parseEligibility);
let pairedHelperEligibility = null;
if (eligibility.some(Boolean)) {
  if (!eligibility.every(Boolean)) throw new Error('Paired FP eligibility reporting changed during interval');
  const buckets = [];
  let calls = 0;
  for (const key of new Set([...eligibility[0].keys(), ...eligibility[1].keys()])) {
    const delta = (eligibility[1].get(key) ?? 0) - (eligibility[0].get(key) ?? 0);
    if (delta < 0) throw new Error('Paired FP eligibility counters reset during interval');
    if (!delta) continue;
    calls += delta;
    buckets.push({ rn: key & 3, ni: Boolean(key & 4), rc: Boolean(key & 8),
      bothSecondOperandsZero: Boolean(key & 16), calls: delta });
  }
  buckets.sort((a, b) => b.calls - a.calls);
  pairedHelperEligibility = { calls, callsPerWallSecond: calls / seconds,
    buckets: buckets.map(bucket => ({ ...bucket, fraction: bucket.calls / calls })) };
  warnings.push('Eligibility counts cover remaining paired add/sub helper calls, excluding inline successes.');
}
const parseTiming = frame => {
  const match = /fptiming:v=1,rate=(\d+),samples=(\d+),totalns=(\d+),maxns=(\d+)/
    .exec(frame.ppcWasmHelperStats ?? '');
  return match ? match.slice(1).map(Number) : null;
};
const timing = frames.map(parseTiming);
let fpTiming = null;
if (timing.every(Boolean)) {
  if (timing[0][0] !== timing[1][0] || timing[0][1] > timing[1][1] || timing[0][2] > timing[1][2])
    throw new Error('FP sampler rate changed or counters reset');
  const samples = timing[1][1] - timing[0][1];
  const sampledNs = timing[1][2] - timing[0][2];
  const extrapolatedSeconds = sampledNs * timing[1][0] / 1e9;
  fpTiming = { samples, sampledNs, meanNs: samples ? sampledNs / samples : null,
    extrapolatedSeconds, extrapolatedWallFraction: extrapolatedSeconds / seconds };
  if (samples) warnings.push('FP timing includes sampling bias, clock overhead and interruptions; not exclusive CPU cost.');
  if (extrapolatedSeconds > seconds) warnings.push('FP timing extrapolation exceeds wall time; exclusive attribution is invalid.');
}
console.log(JSON.stringify({ sources: paths, seconds, presentedFrames,
  fps: presentedFrames / seconds, nativeSpeedFraction: ticks / start.coreTicksPerSecond / seconds,
  checkpointGeneration: end.loadedCheckpointGeneration, configuration, fpTiming,
  pairedHelperEligibility, warnings }, null, 2));
