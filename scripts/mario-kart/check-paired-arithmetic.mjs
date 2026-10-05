import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

assert.ok(process.env.DOLPHIN_WASM_OUTPUT_DIR, 'Choose an isolated arithmetic candidate output.');
const output = resolve(process.env.DOLPHIN_WASM_OUTPUT_DIR);
const manifest = JSON.parse(readFileSync(resolve(output, 'controlla-core-build.json')));
assert.equal(manifest.pairedArithmeticRegression, true, 'Candidate must include the alias regression.');
const hash = file => createHash('sha256').update(readFileSync(file)).digest('hex');
assert.equal(manifest.pairedArithmeticRegressionPatchSha256,
  hash(new URL('./patches/0022-test-paired-arithmetic-aliases.patch', import.meta.url)));
if (manifest.pairedDifferentialRegression)
  assert.equal(manifest.pairedDifferentialRegressionPatchSha256,
    hash(new URL('./patches/0024-differential-paired-arithmetic.patch', import.meta.url)));
for (const [file, expected] of [['dolphin-core-upstream.wasm', manifest.wasmSha256],
  ['dolphin-core-upstream.js', manifest.loaderSha256]])
  assert.equal(hash(resolve(output, file)), expected, `Integrity mismatch: ${file}`);
const { default: createCore } = await import(pathToFileURL(resolve(output, 'dolphin-core-upstream.js')));
const core = await createCore({ noInitialRun: true });
try {
  assert.equal(core.ccall('CoreInit', 'number', [], []), 1);
  const result = core.ccall('RunPpcWasmSinglePrecisionArithmeticSmoke', 'number', [], []);
  assert.equal(result, 1, `Generated-WASM arithmetic regression failed with code ${result}`);
  console.log('Generated WASM scalar alias results, FPRF updates and next-PC passed. No game was booted.');
  if (manifest.pairedDifferentialRegression) console.log('All 3744 paired differential cases passed.');
  process.exit(0);
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
