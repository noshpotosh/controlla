import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { selectRuntime } from './runtime-selection.mjs';
import { createInterface } from 'node:readline';
import { controllerPacket, nativeControllerArguments } from './controller-input.mjs';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const candidate = selectRuntime(repo, 'rebuilt');
const disc = resolve(process.env.DOUBLE_DASH_DISC || resolve(repo, 'Mario Kart - Double Dash!! (USA).ciso'));
const { default: createCore } = await import(pathToFileURL(resolve(candidate.path, 'cores/dolphin/dolphin-core-upstream.js')).href);
const core = await createCore({ noInitialRun: true });
const call = (name, result = 'number', args = [], values = []) => core.ccall(name, result, args, values);
call('SetVideoBackend', 'number', ['string'], ['Software Renderer']);
call('SetCpuCore', 'number', ['string'], ['cached']);
const cpuThread = Number(process.env.DOUBLE_DASH_PROBE_CPU_THREAD ?? 1);
if (cpuThread !== 0 && cpuThread !== 1) throw new Error('DOUBLE_DASH_PROBE_CPU_THREAD must be 0 or 1.');
if (call('SetCpuThread', 'number', ['number'], [cpuThread]) !== 1) throw new Error('Core rejected CPU thread configuration.');
core.FS.writeFile('/double-dash.ciso', readFileSync(disc), { canOwn: true });
const mounted = call('MountDisc', 'number', ['string'], ['/double-dash.ciso']);
if (!mounted) throw new Error('Dolphin DiscIO rejected the game image.');
console.log('Native DiscIO mounted:', call('GetGameId', 'string'), call('GetGameTitle', 'string'));
const accepted = call('BootDisc', 'number', ['string'], ['/double-dash.ciso']);
console.log('Boot submission:', accepted, call('GetCoreStatus', 'string'));
const start = performance.now();
// The browser consumes PCM continuously. Keep that same mixer behavior without
// playing sound: muting skips mixing and would not exercise the audio path.
let audioFrames = 0;
const audioTimer = setInterval(() => {
  if (call('GetCoreStateName', 'string') === 'Running') audioFrames += call('MixAudio', 'number', ['number'], [960]);
}, 20);
const durationMs = Number(process.env.DOUBLE_DASH_PROBE_MS || 15000);
if (!Number.isFinite(durationMs) || durationMs < 1000 || durationMs > 900000) throw new Error('Probe duration must be 1000–900000 ms.');
const startButtonAt = Number(process.env.DOUBLE_DASH_PROBE_START_AT || 0);
let startPressed = false, startReleased = false;
const inputPlan = JSON.parse(process.env.DOUBLE_DASH_PROBE_INPUTS || '[]');
if (!Array.isArray(inputPlan) || inputPlan.some(step => !Number.isInteger(step.at) || step.at < 0 || step.at > durationMs || !Number.isInteger(step.mask) || step.mask < 0 || step.mask > 4095)) throw new Error('Input plan requires {at: milliseconds, mask: button bits} entries within the probe duration.');
inputPlan.sort((a, b) => a.at - b.at);
let nextInput = 0, generation = 2;
const appliedInputs = [];
const samples = [];
const captures = [];
const captureRoot = resolve(repo, `work/double-dash-captures/${Date.now()}`);
let nextCaptureMs = 15000;
function capture(elapsedMs) {
  const width = call('FrameWidth'), height = call('FrameHeight'), pointer = call('FrameBuffer');
  const path = resolve(captureRoot, `${Math.floor(elapsedMs / 1000)}.rgba`);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, Buffer.from(core.HEAPU8.slice(pointer, pointer + width * height * 4)));
  captures.push({ elapsedMs, width, height, path });
  writeFileSync(resolve(repo, 'work/double-dash-live-frame.json'), JSON.stringify(captures.at(-1)));
}
const releases = new Map();
const commands = process.env.DOUBLE_DASH_PROBE_INTERACTIVE === '1' ? createInterface({ input: process.stdin }) : null;
commands?.on('line', line => {
  try {
    const command = JSON.parse(line);
    if (command.capture === true) { capture(Math.round(performance.now() - start)); return; }
    const holdMs = command.holdMs ?? 200;
    if (!Number.isInteger(holdMs) || holdMs < 1 || holdMs > 5000) throw new Error('holdMs must be 1–5000.');
    const port = command.port ?? 0;
    const neutral = { connected: true, mask: 0, stickX: 128, stickY: 128, cStickX: 128, cStickY: 128, triggerLeft: 0, triggerRight: 0, analogA: 0, analogB: 0 };
    const state = { ...neutral, ...command.state };
    const packet = controllerPacket(port, state, ++generation);
    clearTimeout(releases.get(port));
    const set = packet => {
      const accepted = call('SetControllerInputState', 'number', Array(12).fill('number'), nativeControllerArguments(packet));
      const entry = { elapsedMs: Math.round(performance.now() - start), packet, accepted };
      appliedInputs.push(entry); console.log(JSON.stringify({ interactiveInput: entry }));
    };
    set(packet);
    releases.set(port, setTimeout(() => set(controllerPacket(port, neutral, ++generation)), holdMs));
  } catch (error) { console.log(JSON.stringify({ commandError: error.message })); }
});
const timer = setInterval(() => {
  call('PumpHostJobs', null);
  const elapsed = performance.now() - start;
  if (startButtonAt > 0 && elapsed >= startButtonAt && !startPressed) {
    call('SetControllerInputState', 'number', Array(12).fill('number'), [0, 1, 16, 128, 128, 128, 128, 0, 0, 0, 0, 1]);
    startPressed = true;
  }
  if (startPressed && elapsed >= startButtonAt + 1000 && !startReleased) {
    call('SetControllerInputState', 'number', Array(12).fill('number'), [0, 1, 0, 128, 128, 128, 128, 0, 0, 0, 0, 2]);
    startReleased = true;
  }
  while (nextInput < inputPlan.length && elapsed >= inputPlan[nextInput].at) {
    const step = inputPlan[nextInput++];
    const accepted = call('SetControllerInputState', 'number', Array(12).fill('number'), [0, 1, step.mask, 128, 128, 128, 128, 0, 0, step.mask & 1 ? 255 : 0, step.mask & 2 ? 255 : 0, ++generation]);
    appliedInputs.push({ ...step, elapsedMs: Math.round(elapsed), accepted });
  }
  const sample = {
    elapsedMs: Math.round(performance.now() - start), state: call('GetCoreStateName', 'string'),
    status: call('GetCoreStatus', 'string'), pc: call('GetPPCPC'),
    video: call('GetVideoStats', 'string'),
    audio: call('GetAudioStats', 'string'), audioFrames,
  };
  samples.push(sample);
  if (elapsed >= nextCaptureMs) { capture(sample.elapsedMs); nextCaptureMs += 15000; }
  console.log(JSON.stringify(sample));
  if (sample.elapsedMs >= durationMs) {
    clearInterval(timer);
    clearInterval(audioTimer);
    commands?.close();
    releases.forEach(clearTimeout);
    const output = resolve(repo, 'work/double-dash-boot-probe.json');
    mkdirSync(dirname(output), { recursive: true });
    const width = call('FrameWidth');
    const height = call('FrameHeight');
    const pointer = call('FrameBuffer');
    writeFileSync(resolve(repo, 'work/double-dash-frame.rgba'), Buffer.from(core.HEAPU8.slice(pointer, pointer + width * height * 4)));
    writeFileSync(resolve(repo, 'work/double-dash-frame-size.json'), JSON.stringify({ width, height }));
    writeFileSync(output, JSON.stringify({ coreHash: candidate.coreHash, mounted, accepted, cpuThread, startButtonAt, startPressed, startReleased, appliedInputs, samples, captures, browserValidated: false }, null, 2) + '\n');
    process.exit(accepted ? 0 : 1);
  }
}, 1000);
