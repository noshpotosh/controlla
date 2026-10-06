import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

assert.ok(process.env.DOLPHIN_WASM_OUTPUT_DIR, 'Choose an isolated arithmetic candidate output.');
const output = resolve(process.env.DOLPHIN_WASM_OUTPUT_DIR);
const manifest = JSON.parse(readFileSync(resolve(output, 'controlla-core-build.json')));
assert.equal(manifest.pairedArithmeticRegression, true, 'Candidate must include the alias regression.');
const hash = file => createHash('sha256').update(readFileSync(file)).digest('hex');
if (manifest.guardedScalarPairedMadd) {
  assert.equal(manifest.scalarPairedStatusRegression, true);
  assert.equal(manifest.guardedScalarPairedMaddPatchSha256,
    hash(new URL('./patches/0033-guarded-scalar-paired-madd.patch', import.meta.url)));
}
if (manifest.guardedScalarPairedMultiply) {
  assert.equal(manifest.scalarPairedStatusRegression, true);
  assert.equal(manifest.guardedScalarPairedMultiplyPatchSha256,
    hash(new URL('./patches/0032-guarded-scalar-paired-multiply.patch', import.meta.url)));
}
if (manifest.directScalarPaired)
  assert.equal(manifest.pairedFpEligibility, true, 'Direct scalar paired requires patch-0031 evidence');
if (manifest.pairedFpEligibility)
  assert.equal(manifest.pairedFpEligibilityPatchSha256,
    hash(new URL('./patches/0031-paired-fp-eligibility-attribution.patch', import.meta.url)));
if (manifest.guardedInlinePaired)
  assert.equal(manifest.guardedInlinePairedPatchSha256,
    hash(new URL('./patches/0030-guarded-inline-paired-add-sub.patch', import.meta.url)));
if (manifest.inlineNormalFprf)
  assert.equal(manifest.inlineNormalFprfPatchSha256,
    hash(new URL('./patches/0029-inline-normal-fprf.patch', import.meta.url)));
if (manifest.sampledFpHelperTiming)
  assert.equal(manifest.sampledFpHelperTimingPatchSha256,
    hash(new URL('./patches/0028-sampled-fp-helper-timing.patch', import.meta.url)));
assert.equal(manifest.pairedArithmeticRegressionPatchSha256,
  hash(new URL('./patches/0022-test-paired-arithmetic-aliases.patch', import.meta.url)));
if (manifest.pairedDifferentialRegression)
  assert.equal(manifest.pairedDifferentialRegressionPatchSha256,
    hash(new URL('./patches/0024-differential-paired-arithmetic.patch', import.meta.url)));
if (manifest.pairedStatusRegression)
  assert.equal(manifest.pairedStatusRegressionPatchSha256,
    hash(new URL('./patches/0027-paired-status-regression.patch', import.meta.url)));
if (manifest.finitePairedAddSub) {
  assert.equal(manifest.pairedDifferentialRegression, true,
    'Finite add/sub candidate requires differential comparisons');
  assert.equal(manifest.finitePairedAddSubPatchSha256,
    hash(new URL('./patches/0026-finite-paired-add-sub.patch', import.meta.url)));
}
for (const [file, expected] of [['dolphin-core-upstream.wasm', manifest.wasmSha256],
  ['dolphin-core-upstream.js', manifest.loaderSha256]])
  assert.equal(hash(resolve(output, file)), expected, `Integrity mismatch: ${file}`);
const { default: createCore } = await import(pathToFileURL(resolve(output, 'dolphin-core-upstream.js')));
const core = await createCore({ noInitialRun: true });
try {
  assert.equal(core.ccall('CoreInit', 'number', [], []), 1);
  const result = core.ccall('RunPpcWasmSinglePrecisionArithmeticSmoke', 'number', [], []);
  assert.equal(result, 1, `Generated-WASM arithmetic regression failed with code ${result}`);
  // Read once after the first cold smoke: a pre-smoke report can stay cached.
  let firstSmokeFpHelperCalls;
  if (manifest.guardedInlinePaired) {
    const stats = core.ccall('GetPpcWasmHelperStats', 'string', [], []);
    const calls = stats.match(/imports system:\d+ fp:(\d+)/);
    assert.ok(calls, 'Missing FP helper-call report after cold arithmetic smoke');
    firstSmokeFpHelperCalls = Number(calls[1]);
    assert.ok(Number.isSafeInteger(firstSmokeFpHelperCalls));
    console.log(`Cold arithmetic smoke FP helper calls: ${firstSmokeFpHelperCalls}. This is not gameplay coverage.`);
  }
  if (manifest.optInFpAttribution) {
    assert.equal(manifest.optInFpAttributionPatchSha256,
      hash(new URL('./patches/0025-opt-in-fp-opcode-attribution.patch', import.meta.url)));
    core.ccall('SetPpcProfileEnabled', null, ['number'], [1]);
    assert.equal(core.ccall('RunPpcWasmSinglePrecisionArithmeticSmoke', 'number', [], []), 1,
      'Arithmetic comparison must also pass with opcode attribution enabled');
    core.ccall('SetPpcProfileEnabled', null, ['number'], [0]);
    assert.equal(core.ccall('RunPpcWasmSinglePrecisionArithmeticSmoke', 'number', [], []), 1);
    console.log('Arithmetic comparisons passed with CPU profiling disabled and enabled.');
  }
  console.log('Generated WASM scalar alias results, FPRF updates and next-PC passed. No game was booted.');
  if (manifest.pairedDifferentialRegression) console.log('All 3744 paired differential cases passed.');
  if (manifest.scalarPairedStatusRegression) console.log('All 6144 scalar paired direct-helper and generated Rc/status/exception comparisons passed.');
  if (manifest.pairedStatusRegression) console.log('All 1536 paired Rc/status/exception comparisons passed.');
  manifest.pairedArithmeticVerification = {
    checkedAt: new Date().toISOString(),
    wasmSha256: manifest.wasmSha256,
    scalarAliasCases: 4,
    differentialCases: manifest.pairedDifferentialRegression ? 3744 : 0,
    reference: 'native-interpreter',
    ...(firstSmokeFpHelperCalls !== undefined ? { firstSmokeFpHelperCalls } : {}),
    ...(manifest.pairedStatusRegression ? { pairedStatusCases: 1536 } : {}),
    ...(manifest.scalarPairedStatusRegression ? { scalarPairedStatusCases: 6144 } : {}),
    ...(manifest.finitePairedAddSub ? { pairedAddSubCases: 576, finitePairedAddSubPatchSha256: manifest.finitePairedAddSubPatchSha256 } : {}),
  };
  writeFileSync(resolve(output, 'controlla-core-build.json'), JSON.stringify(manifest, null, 2) + '\n');
  process.exit(0);
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
