// Exercise the compiled emulator's state serialization with the user's disc.
// This does not validate browser storage, WebGPU restoration, or racing.
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { selectRuntime } from './runtime-selection.mjs';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const candidate = selectRuntime(repo, 'rebuilt');
const { default: createCore } = await import(pathToFileURL(resolve(candidate.path, 'cores/dolphin/dolphin-core-upstream.js')));
const core = await createCore({ noInitialRun: true });
const call = (name, type = 'number', args = [], values = []) => core.ccall(name, type, args, values);
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const timeout = setTimeout(() => { console.error('Native state check exceeded 60 seconds.'); process.exit(1); }, 60000);
let pump;
try {
  call('SetVideoBackend', 'number', ['string'], ['Software Renderer']);
  call('SetCpuCore', 'number', ['string'], ['cached']);
  call('SetCpuThread', 'number', ['number'], [1]);
  const disc = process.env.DOUBLE_DASH_DISC || resolve(repo, 'Mario Kart - Double Dash!! (USA).ciso');
  core.FS.writeFile('/double-dash.ciso', readFileSync(disc), { canOwn: true });
  if (!call('BootDisc', 'number', ['string'], ['/double-dash.ciso'])) throw new Error('Boot rejected.');
  pump = setInterval(() => {
    call('PumpHostJobs', null);
    if (call('GetCoreStateName', 'string') === 'Running') call('MixAudio', 'number', ['number'], [960]);
  }, 20);
  for (let i = 0; i < 100 && call('GetCoreStateName', 'string') !== 'Running'; i++) await wait(100);
  if (call('GetCoreStateName', 'string') !== 'Running') throw new Error('Boot did not reach Running.');
  await wait(5000);
  const path = '/round-trip.sav';
  if (call('SaveStateFile', 'number', ['string'], [path]) !== 1) throw new Error('Save request rejected.');
  let size = 0, previous = 0, stable = 0;
  for (let i = 0; i < 80; i++) {
    await wait(200);
    try { size = core.FS.stat(path).size; } catch {}
    stable = size > 0 && size === previous ? stable + 1 : 0;
    previous = size;
    if (stable >= 3) break;
  }
  if (!size || stable < 3) throw new Error('Save file never completed.');
  const bytes = core.FS.readFile(path).slice();
  core.FS.unlink(path);
  await wait(1000);
  core.FS.writeFile('/restored.sav', bytes);
  const beforeGeneration = call('GetLastLoadedCheckpointGeneration') >>> 0;
  if (call('LoadStateFile', 'number', ['string'], ['/restored.sav']) !== 1) throw new Error('Load request rejected.');
  let afterGeneration = beforeGeneration;
  for (let i = 0; i < 100 && afterGeneration === beforeGeneration; i++) {
    await wait(100);
    afterGeneration = call('GetLastLoadedCheckpointGeneration') >>> 0;
  }
  if (afterGeneration === beforeGeneration) throw new Error('Load request accepted but the native after-load callback never completed.');
  await wait(1000);
  const evidence = { coreHash: candidate.coreHash, size, beforeGeneration, afterGeneration,
    loadedPC: call('GetLastLoadedPPCPC') >>> 0, state: call('GetCoreStateName', 'string'), browserValidated: false };
  if (evidence.state !== 'Running') throw new Error(`Core stopped after restore: ${evidence.state}`);
  mkdirSync(resolve(repo, 'work'), { recursive: true });
  writeFileSync(resolve(repo, 'work/double-dash-state-check.json'), JSON.stringify(evidence, null, 2) + '\n');
  console.log(JSON.stringify(evidence));
  process.exitCode = 0;
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  clearInterval(pump);
  clearTimeout(timeout);
  process.exit(process.exitCode || 0); // Terminate Emscripten's retained pthread pool.
}
