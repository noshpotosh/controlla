import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const stage = resolve(repo, 'work/double-dash-build');
const defaultOutput = resolve(stage, 'cores/dolphin');
const output = resolve(process.env.DOLPHIN_WASM_OUTPUT_DIR || defaultOutput);
const nativeBackend = resolve(stage, 'vendor/dolphin/Source/Core/VideoBackends/WebGPU/WebGPUGfx.cpp');
const nativeCpu = resolve(stage, 'vendor/dolphin/Source/Core/Core/PowerPC/CachedInterpreter/CachedInterpreter.cpp');
const nativeFifo = resolve(stage, 'vendor/dolphin/Source/Core/VideoCommon/Fifo.cpp');
const fifoIdleSleep = readFileSync(nativeFifo, 'utf8').includes('WASM idle FIFO sleep candidate');
if (fifoIdleSleep) {
  if (output === defaultOutput) throw new Error('FIFO sleep candidate requires an isolated DOLPHIN_WASM_OUTPUT_DIR.');
  const check = spawnSync('git', ['-C', resolve(stage, 'vendor/dolphin'), 'apply', '--reverse', '--check',
    resolve(repo, 'scripts/mario-kart/patches/0011-sleep-empty-wasm-fifo.patch')], { encoding: 'utf8' });
  if (check.status !== 0) throw new Error('FIFO sleep source does not match patch 0011: ' + check.stderr);
}
const nativePixelEngine = resolve(stage, 'vendor/dolphin/Source/Core/VideoCommon/PixelEngine.cpp');
const pixelEngineDiagnostics = readFileSync(nativePixelEngine, 'utf8').includes('pefinish:v=1');
if (pixelEngineDiagnostics) {
  if (output === defaultOutput) throw new Error('Pixel engine diagnostic requires an isolated DOLPHIN_WASM_OUTPUT_DIR.');
  const check = spawnSync('git', ['-C', resolve(stage, 'vendor/dolphin'), 'apply', '--reverse', '--check',
    resolve(repo, 'scripts/mario-kart/patches/0012-observe-pixel-engine-finish.patch')], { encoding: 'utf8' });
  if (check.status !== 0) throw new Error('Pixel engine diagnostic does not match patch 0012: ' + check.stderr);
}
const fifoGateDiagnostics = readFileSync(nativeCpu, 'utf8').includes('fifogate:v=1');
if (fifoGateDiagnostics) {
  if (output === defaultOutput) throw new Error('FIFO diagnostic source requires an isolated DOLPHIN_WASM_OUTPUT_DIR.');
  const check = spawnSync('git', ['-C', resolve(stage, 'vendor/dolphin'), 'apply', '--reverse', '--check',
    resolve(repo, 'scripts/mario-kart/patches/0009-observe-fifo-drain-gates.patch')], { encoding: 'utf8' });
  if (check.status !== 0) throw new Error('FIFO diagnostic source does not match patch 0009: ' + check.stderr);
}
const destinationAlphaPrototype = readFileSync(nativeBackend, 'utf8').includes('GetBlendShaderId()');
if (destinationAlphaPrototype && output === defaultOutput) {
  throw new Error('Experimental destination-alpha source requires an isolated DOLPHIN_WASM_OUTPUT_DIR.');
}
if (destinationAlphaPrototype) {
  const patchCheck = spawnSync('git', ['-C', resolve(stage, 'vendor/dolphin'), 'apply', '--reverse', '--check',
    resolve(repo, 'scripts/mario-kart/patches/0008-emulate-destination-alpha.patch')], { encoding: 'utf8' });
  if (patchCheck.status !== 0) throw new Error('Destination-alpha prototype source does not match patch 0008: ' + patchCheck.stderr);
}
const cache = readFileSync(resolve(stage, 'build/dolphin-wasm/CMakeCache.txt'), 'utf8');
const configuredOutput = cache.match(/^DOLPHIN_WASM_OUTPUT_DIR:[^=]+=(.*)$/m)?.[1];
if (!configuredOutput || resolve(configuredOutput) !== output) {
  throw new Error('Configured WASM output differs from the requested output. Reconfigure with the same DOLPHIN_WASM_OUTPUT_DIR.');
}
const manifest = JSON.parse(readFileSync(resolve(stage, 'controlla-macos-toolchain.json'), 'utf8'));
const hash = path => createHash('sha256').update(readFileSync(path)).digest('hex');
for (const [name, record] of Object.entries(manifest.tools)) {
  if (hash(record.path) !== record.sha256) throw new Error(`${name} changed since configuration. Reconfigure the build.`);
}
const sdk = resolve(repo, 'work/emsdk');
const env = { ...process.env,
  EM_CONFIG: resolve(sdk, '.emscripten'),
  EMSDK_NODE: resolve(sdk, 'node/24.19.0_64bit/bin/node'),
  EMSDK_PYTHON: resolve(sdk, 'python/3.13.3_64bit/bin/python3'),
  PATH: [resolve(sdk, 'python/3.13.3_64bit/bin'), resolve(sdk, 'upstream/emscripten'), process.env.PATH].join(':'),
};
const result = spawnSync(manifest.tools.cmake.path, ['--build', resolve(stage, 'build/dolphin-wasm'), '--target', 'dolphin_web_core', '--parallel', '4'], { env, stdio: 'inherit' });
if (result.status !== 0) process.exit(result.status ?? 1);
const wasm = resolve(output, 'dolphin-core-upstream.wasm');
const js = resolve(output, 'dolphin-core-upstream.js');
if (!readFileSync(js, 'utf8').includes('SetControllerInputState')) throw new Error('Built loader lacks the four-controller native export.');
// Compilation validates the module without instantiating or booting game code.
const module = new WebAssembly.Module(readFileSync(wasm));
writeFileSync(output === defaultOutput ? resolve(stage, 'controlla-core-build.json') : resolve(output, 'controlla-core-build.json'), JSON.stringify({
  platform: manifest.platform, wasmSha256: hash(wasm), loaderSha256: hash(js),
  toolchainSha256: hash(resolve(stage, 'controlla-macos-toolchain.json')),
  wasmExportCount: WebAssembly.Module.exports(module).length,
  patches: ['0001-four-controller-state.patch', '0002-controller-worker-transport.patch', '0003-four-controller-devices.patch', '0007-restore-console-depth-conversion.patch', ...(destinationAlphaPrototype ? ['0008-emulate-destination-alpha.patch'] : []), ...(fifoGateDiagnostics ? ['0009-observe-fifo-drain-gates.patch'] : []), ...(fifoIdleSleep ? ['0011-sleep-empty-wasm-fifo.patch'] : []), ...(pixelEngineDiagnostics ? ['0012-observe-pixel-engine-finish.patch'] : [])].map(name => ({ name, sha256: hash(resolve(repo, 'scripts/mario-kart/patches', name)) })),
  fifoIdleSleep,
  nativeFifoSha256: hash(nativeFifo),
  nativeBackendSha256: hash(nativeBackend),
  nativeCpuSha256: hash(nativeCpu),
  fifoGateDiagnostics,
  pixelEngineDiagnostics,
  nativePixelEngineSha256: hash(nativePixelEngine),
  destinationAlphaPrototype,
  validatedGameplay: false,
}, null, 2) + '\n');
console.log('Four-controller WASM built and module syntax validated. Browser gameplay remains unverified.');
