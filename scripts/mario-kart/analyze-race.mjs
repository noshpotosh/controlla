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
  checkpointGeneration: end.loadedCheckpointGeneration, configuration, fpTiming, warnings }, null, 2));
