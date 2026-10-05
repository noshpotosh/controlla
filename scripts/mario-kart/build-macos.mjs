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
const finitePairedAddSub = readFileSync(nativeCpu, 'utf8').includes('WASM finite paired add/sub candidate');
if (finitePairedAddSub) {
  if (output === defaultOutput) throw new Error('Finite paired arithmetic candidate requires isolated output.');
  const check = spawnSync('git', ['-C', resolve(stage, 'vendor/dolphin'), 'apply', '--reverse', '--check',
    resolve(repo, 'scripts/mario-kart/patches/0026-finite-paired-add-sub.patch')], { encoding: 'utf8' });
  if (check.status !== 0) throw new Error('Finite paired arithmetic patch mismatch: ' + check.stderr);
}
const optInFpAttribution = readFileSync(nativeCpu, 'utf8').includes('WASM opt-in FP opcode attribution candidate');
if (optInFpAttribution) {
  if (output === defaultOutput) throw new Error('FP attribution candidate requires isolated output.');
  const check = spawnSync('git', ['-C', resolve(stage, 'vendor/dolphin'), 'apply', '--reverse', '--check',
    resolve(repo, 'scripts/mario-kart/patches/0025-opt-in-fp-opcode-attribution.patch')], { encoding: 'utf8' });
  if (check.status !== 0) throw new Error('FP attribution patch mismatch: ' + check.stderr);
}
const pairedDifferentialRegression = readFileSync(nativeCpu, 'utf8').includes('WASM paired differential regression');
if (pairedDifferentialRegression) {
  if (output === defaultOutput) throw new Error('Paired differential regression requires isolated output.');
  const check = spawnSync('git', ['-C', resolve(stage, 'vendor/dolphin'), 'apply', '--reverse', '--check',
    resolve(repo, 'scripts/mario-kart/patches/0024-differential-paired-arithmetic.patch')], { encoding: 'utf8' });
  if (check.status !== 0) throw new Error('Paired differential regression patch mismatch: ' + check.stderr);
}
const directReferenceDispatch = readFileSync(nativeCpu, 'utf8').includes('WASM direct reference dispatch candidate');
if (directReferenceDispatch) {
  if (output === defaultOutput) throw new Error('Direct reference dispatch requires isolated output.');
  const check = spawnSync('git', ['-C', resolve(stage, 'vendor/dolphin'), 'apply', '--reverse', '--check',
    resolve(repo, 'scripts/mario-kart/patches/0023-direct-reference-paired-dispatch.patch')], { encoding: 'utf8' });
  if (check.status !== 0) throw new Error('Direct reference dispatch patch mismatch: ' + check.stderr);
}
const pairedArithmeticRegression = readFileSync(nativeCpu, 'utf8').includes('WASM paired arithmetic regression');
if (pairedArithmeticRegression) {
  if (output === defaultOutput) throw new Error('Paired arithmetic regression requires isolated output.');
  const check = spawnSync('git', ['-C', resolve(stage, 'vendor/dolphin'), 'apply', '--reverse', '--check',
    resolve(repo, 'scripts/mario-kart/patches/0022-test-paired-arithmetic-aliases.patch')], { encoding: 'utf8' });
  if (check.status !== 0) throw new Error('Paired regression patch mismatch: ' + check.stderr);
}
const referencePairedArithmetic = readFileSync(nativeCpu, 'utf8').includes('WASM reference paired arithmetic candidate');
if (referencePairedArithmetic) {
  if (output === defaultOutput) throw new Error('Reference paired arithmetic requires an isolated DOLPHIN_WASM_OUTPUT_DIR.');
  const check = spawnSync('git', ['-C', resolve(stage, 'vendor/dolphin'), 'apply', '--reverse', '--check',
    resolve(repo, 'scripts/mario-kart/patches/0021-reference-paired-arithmetic.patch')], { encoding: 'utf8' });
  if (check.status !== 0) throw new Error('Reference paired arithmetic source does not match patch 0021: ' + check.stderr);
}
const pairedSumHelpers = readFileSync(nativeCpu, 'utf8').includes('WASM paired-sum helper admission candidate');
if (pairedSumHelpers) {
  if (output === defaultOutput) throw new Error('Paired sum helper candidate requires an isolated DOLPHIN_WASM_OUTPUT_DIR.');
  const check = spawnSync('git', ['-C', resolve(stage, 'vendor/dolphin'), 'apply', '--reverse', '--check',
    resolve(repo, 'scripts/mario-kart/patches/0019-admit-paired-sum-helpers.patch')], { encoding: 'utf8' });
  if (check.status !== 0) throw new Error('Paired sum helper source does not match patch 0019: ' + check.stderr);
}
const preciseSampledProfile = readFileSync(nativeCpu, 'utf8').includes('WASM precise sampled CPU profile candidate');
if (preciseSampledProfile) {
  if (output === defaultOutput) throw new Error('Precise profile candidate requires an isolated DOLPHIN_WASM_OUTPUT_DIR.');
  const check = spawnSync('git', ['-C', resolve(stage, 'vendor/dolphin'), 'apply', '--reverse', '--check',
    resolve(repo, 'scripts/mario-kart/patches/0018-preserve-sampled-profile-precision.patch')], { encoding: 'utf8' });
  if (check.status !== 0) throw new Error('Precise profile source does not match patch 0018: ' + check.stderr);
}
const pairedSignOperations = readFileSync(nativeCpu, 'utf8').includes('WASM paired-sign candidate');
if (pairedSignOperations) {
  if (output === defaultOutput) throw new Error('Paired sign candidate requires an isolated DOLPHIN_WASM_OUTPUT_DIR.');
  const check = spawnSync('git', ['-C', resolve(stage, 'vendor/dolphin'), 'apply', '--reverse', '--check',
    resolve(repo, 'scripts/mario-kart/patches/0017-inline-paired-sign-operations.patch')], { encoding: 'utf8' });
  if (check.status !== 0) throw new Error('Paired sign source does not match patch 0017: ' + check.stderr);
}
const scaleZeroQuantizedStores = readFileSync(nativeCpu, 'utf8').includes('WASM scale-zero quantized store candidate');
if (scaleZeroQuantizedStores) {
  if (output === defaultOutput) throw new Error('Quantized store candidate requires an isolated DOLPHIN_WASM_OUTPUT_DIR.');
  const check = spawnSync('git', ['-C', resolve(stage, 'vendor/dolphin'), 'apply', '--reverse', '--check',
    resolve(repo, 'scripts/mario-kart/patches/0016-inline-scale-zero-quantized-stores.patch')], { encoding: 'utf8' });
  if (check.status !== 0) throw new Error('Quantized store source does not match patch 0016: ' + check.stderr);
}
const cachedCodeInvalidation = readFileSync(nativeCpu, 'utf8').includes('WASM cached-code invalidation candidate');
if (cachedCodeInvalidation) {
  if (output === defaultOutput) throw new Error('Cached code invalidation candidate requires an isolated DOLPHIN_WASM_OUTPUT_DIR.');
  const check = spawnSync('git', ['-C', resolve(stage, 'vendor/dolphin'), 'apply', '--reverse', '--check',
    resolve(repo, 'scripts/mario-kart/patches/0013-preserve-cached-code-invalidation.patch')], { encoding: 'utf8' });
  if (check.status !== 0) throw new Error('Cached code invalidation source does not match patch 0013: ' + check.stderr);
}
const boundedGpuDistance = readFileSync(nativeFifo, 'utf8').includes('WASM bounded CPU GPU distance candidate');
if (boundedGpuDistance) {
  if (output === defaultOutput) throw new Error('Bounded GPU distance candidate requires an isolated DOLPHIN_WASM_OUTPUT_DIR.');
  const check = spawnSync('git', ['-C', resolve(stage, 'vendor/dolphin'), 'apply', '--reverse', '--check',
    resolve(repo, 'scripts/mario-kart/patches/0014-bound-cpu-gpu-distance.patch')], { encoding: 'utf8' });
  if (check.status !== 0) throw new Error('Bounded GPU distance source does not match patch 0014: ' + check.stderr);
}
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
  patches: ['0001-four-controller-state.patch', '0002-controller-worker-transport.patch', '0003-four-controller-devices.patch', '0007-restore-console-depth-conversion.patch', ...(destinationAlphaPrototype ? ['0008-emulate-destination-alpha.patch'] : []), ...(fifoGateDiagnostics ? ['0009-observe-fifo-drain-gates.patch'] : []), ...(fifoIdleSleep ? ['0011-sleep-empty-wasm-fifo.patch'] : []), ...(pixelEngineDiagnostics ? ['0012-observe-pixel-engine-finish.patch'] : []), ...(cachedCodeInvalidation ? ['0013-preserve-cached-code-invalidation.patch'] : []), ...(boundedGpuDistance ? ['0014-bound-cpu-gpu-distance.patch'] : [])].map(name => ({ name, sha256: hash(resolve(repo, 'scripts/mario-kart/patches', name)) })),
  boundedGpuDistance,
  scaleZeroQuantizedStores,
  pairedSignOperations,
  preciseSampledProfile,
  pairedSumHelpers,
  finitePairedAddSub,
  finitePairedAddSubPatchSha256: finitePairedAddSub ? hash(resolve(repo, 'scripts/mario-kart/patches/0026-finite-paired-add-sub.patch')) : null,
  optInFpAttribution,
  optInFpAttributionPatchSha256: optInFpAttribution ? hash(resolve(repo, 'scripts/mario-kart/patches/0025-opt-in-fp-opcode-attribution.patch')) : null,
  pairedDifferentialRegression,
  pairedDifferentialRegressionPatchSha256: pairedDifferentialRegression ? hash(resolve(repo, 'scripts/mario-kart/patches/0024-differential-paired-arithmetic.patch')) : null,
  directReferenceDispatch,
  directReferenceDispatchPatchSha256: directReferenceDispatch ? hash(resolve(repo, 'scripts/mario-kart/patches/0023-direct-reference-paired-dispatch.patch')) : null,
  pairedArithmeticRegression,
  pairedArithmeticRegressionPatchSha256: pairedArithmeticRegression ? hash(resolve(repo, 'scripts/mario-kart/patches/0022-test-paired-arithmetic-aliases.patch')) : null,
  referencePairedArithmetic,
  referencePairedArithmeticPatchSha256: referencePairedArithmetic ? hash(resolve(repo, 'scripts/mario-kart/patches/0021-reference-paired-arithmetic.patch')) : null,
  pairedSumPatchSha256: pairedSumHelpers ? hash(resolve(repo, 'scripts/mario-kart/patches/0019-admit-paired-sum-helpers.patch')) : null,
  preciseProfilePatchSha256: preciseSampledProfile ? hash(resolve(repo, 'scripts/mario-kart/patches/0018-preserve-sampled-profile-precision.patch')) : null,
  pairedSignPatchSha256: pairedSignOperations ? hash(resolve(repo, 'scripts/mario-kart/patches/0017-inline-paired-sign-operations.patch')) : null,
  quantizedStorePatchSha256: scaleZeroQuantizedStores ? hash(resolve(repo, 'scripts/mario-kart/patches/0016-inline-scale-zero-quantized-stores.patch')) : null,
  fifoIdleSleep,
  cachedCodeInvalidation,
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
