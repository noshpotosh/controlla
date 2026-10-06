import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { selectRuntime } from './runtime-selection.mjs';

test('rebuilt mode requires matching binary and loader evidence', async () => {
  const repo = await mkdtemp(join(tmpdir(), 'controlla-core-'));
  try {
    assert.throws(() => selectRuntime(repo, 'rebuilt'), /ENOENT/);
    const stage = join(repo, 'work/double-dash-build');
    const cores = join(stage, 'cores/dolphin');
    await mkdir(cores, { recursive: true });
    const wasm = Buffer.from('test module'), js = Buffer.from('test loader');
    const hash = bytes => createHash('sha256').update(bytes).digest('hex');
    await writeFile(join(cores, 'dolphin-core-upstream.wasm'), wasm);
    await writeFile(join(cores, 'dolphin-core-upstream.js'), js);
    await writeFile(join(stage, 'controlla-core-build.json'), JSON.stringify({ wasmSha256: hash(wasm), loaderSha256: hash(js) }));
    assert.equal(selectRuntime(repo, 'rebuilt').coreHash, hash(wasm));
    await writeFile(join(cores, 'dolphin-core-upstream.wasm'), 'changed binary');
    assert.throws(() => selectRuntime(repo, 'rebuilt'), /differs/);
    assert.equal(selectRuntime(repo).rebuilt, false);
    assert.throws(() => selectRuntime(repo, 'unknown'), /must be/);
  } finally { await rm(repo, { recursive: true, force: true }); }
});

test('candidate mode checks arithmetic verification, patch provenance and exact binary integrity', async () => {
  const repo = await mkdtemp(join(tmpdir(), 'controlla-candidate-'));
  try {
    const core = join(repo, 'work/candidate');
    const patches = join(repo, 'scripts/mario-kart/patches');
    await mkdir(core, { recursive: true });
    await mkdir(patches, { recursive: true });
    const hash = bytes => createHash('sha256').update(bytes).digest('hex');
    const wasm = Buffer.from('candidate wasm'), loader = Buffer.from('candidate loader');
    await writeFile(join(core, 'dolphin-core-upstream.wasm'), wasm);
    await writeFile(join(core, 'dolphin-core-upstream.js'), loader);
    const manifest = { wasmSha256: hash(wasm), loaderSha256: hash(loader),
      nativeInputAbiChecked: true, referencePairedArithmetic: true,
      directReferenceDispatch: true, pairedDifferentialRegression: true,
      pairedArithmeticVerification: { wasmSha256: hash(wasm), differentialCases: 3744 } };
    for (const [name, field] of [
      ['0021-reference-paired-arithmetic.patch', 'referencePairedArithmeticPatchSha256'],
      ['0023-direct-reference-paired-dispatch.patch', 'directReferenceDispatchPatchSha256'],
      ['0024-differential-paired-arithmetic.patch', 'pairedDifferentialRegressionPatchSha256'],
    ]) {
      await writeFile(join(patches, name), name);
      manifest[field] = hash(name);
    }
    const save = () => writeFile(join(core, 'controlla-core-build.json'), JSON.stringify(manifest));
    await save();
    assert.equal(selectRuntime(repo, 'candidate', core).coreDirectory, core);
    manifest.pairedArithmeticVerification.wasmSha256 = 'stale'; await save();
    assert.throws(() => selectRuntime(repo, 'candidate', core), /requires verified/);
    manifest.pairedArithmeticVerification.wasmSha256 = hash(wasm); await save();
    await writeFile(join(patches, '0023-direct-reference-paired-dispatch.patch'), 'changed');
    assert.throws(() => selectRuntime(repo, 'candidate', core), /provenance/);
    await writeFile(join(patches, '0023-direct-reference-paired-dispatch.patch'), '0023-direct-reference-paired-dispatch.patch');
    const attributionPatch = '0025-opt-in-fp-opcode-attribution.patch';
    await writeFile(join(patches, attributionPatch), attributionPatch);
    manifest.optInFpAttribution = true;
    manifest.optInFpAttributionPatchSha256 = hash(attributionPatch); await save();
    assert.equal(selectRuntime(repo, 'candidate', core).coreDirectory, core);
    await writeFile(join(patches, attributionPatch), 'changed');
    assert.throws(() => selectRuntime(repo, 'candidate', core), /FP attribution patch provenance/);
    await writeFile(join(patches, attributionPatch), attributionPatch);
    const finitePatch = '0026-finite-paired-add-sub.patch';
    await writeFile(join(patches, finitePatch), finitePatch);
    manifest.finitePairedAddSub = true;
    manifest.finitePairedAddSubPatchSha256 = hash(finitePatch); await save();
    assert.equal(selectRuntime(repo, 'candidate', core).coreDirectory, core);
    await writeFile(join(patches, finitePatch), 'changed');
    assert.throws(() => selectRuntime(repo, 'candidate', core), /finite paired arithmetic patch provenance/);
    await writeFile(join(patches, finitePatch), finitePatch);
    const statusPatch = '0027-paired-status-regression.patch';
    await writeFile(join(patches, statusPatch), statusPatch);
    const timingPatch = '0028-sampled-fp-helper-timing.patch';
    await writeFile(join(patches, timingPatch), timingPatch);
    manifest.sampledFpHelperTiming = true;
    await save();
    assert.throws(() => selectRuntime(repo, 'candidate', core), /FP helper timing patch provenance/);
    manifest.sampledFpHelperTimingPatchSha256 = hash(timingPatch); await save();
    assert.equal(selectRuntime(repo, 'candidate', core).coreDirectory, core);
    await writeFile(join(patches, timingPatch), 'changed');
    assert.throws(() => selectRuntime(repo, 'candidate', core), /FP helper timing patch provenance/);
    await writeFile(join(patches, timingPatch), timingPatch);
    manifest.pairedStatusRegression = true;
    const normalPatch = '0029-inline-normal-fprf.patch';
    const eligibilityPatch = '0031-paired-fp-eligibility-attribution.patch';
    manifest.directScalarPaired = true; await save();
    assert.throws(() => selectRuntime(repo, 'candidate', core), /direct scalar paired reference requires/);
    await writeFile(join(patches, eligibilityPatch), eligibilityPatch);
    manifest.pairedFpEligibility = true; await save();
    assert.throws(() => selectRuntime(repo, 'candidate', core), /paired FP eligibility patch provenance/);
    manifest.pairedFpEligibilityPatchSha256 = hash(eligibilityPatch); await save();
    await writeFile(join(patches, eligibilityPatch), 'changed');
    assert.throws(() => selectRuntime(repo, 'candidate', core), /paired FP eligibility patch provenance/);
    await writeFile(join(patches, eligibilityPatch), eligibilityPatch);
    const inlinePatch = '0030-guarded-inline-paired-add-sub.patch';
    await writeFile(join(patches, inlinePatch), inlinePatch);
    manifest.guardedInlinePaired = true; await save();
    assert.throws(() => selectRuntime(repo, 'candidate', core), /guarded inline paired patch provenance/);
    manifest.guardedInlinePairedPatchSha256 = hash(inlinePatch); await save();
    await writeFile(join(patches, inlinePatch), 'changed');
    assert.throws(() => selectRuntime(repo, 'candidate', core), /guarded inline paired patch provenance/);
    await writeFile(join(patches, inlinePatch), inlinePatch);
    await writeFile(join(patches, normalPatch), normalPatch);
    manifest.inlineNormalFprf = true; await save();
    assert.throws(() => selectRuntime(repo, 'candidate', core), /inline normal FPRF patch provenance/);
    manifest.inlineNormalFprfPatchSha256 = hash(normalPatch); await save();
    await writeFile(join(patches, normalPatch), 'changed');
    assert.throws(() => selectRuntime(repo, 'candidate', core), /inline normal FPRF patch provenance/);
    await writeFile(join(patches, normalPatch), normalPatch);
    manifest.pairedStatusRegressionPatchSha256 = hash(statusPatch); await save();
    assert.throws(() => selectRuntime(repo, 'candidate', core), /paired status regression evidence/);
    manifest.pairedArithmeticVerification.pairedStatusCases = 1536; await save();
    assert.equal(selectRuntime(repo, 'candidate', core).coreDirectory, core);
    manifest.scalarPairedStatusRegression = true; await save();
    assert.throws(() => selectRuntime(repo, 'candidate', core), /scalar paired status regression evidence/);
    manifest.pairedArithmeticVerification.scalarPairedStatusCases = 12287; await save();
    assert.throws(() => selectRuntime(repo, 'candidate', core), /scalar paired status regression evidence/);
    manifest.pairedArithmeticVerification.scalarPairedStatusCases = 12288; await save();
    assert.equal(selectRuntime(repo, 'candidate', core).coreDirectory, core);
    const scalarMulPatch = '0032-guarded-scalar-paired-multiply.patch';
    manifest.guardedScalarPairedMultiply = true; await save();
    assert.throws(() => selectRuntime(repo, 'candidate', core), /guarded scalar multiply evidence/);
    await writeFile(join(patches, scalarMulPatch), scalarMulPatch);
    manifest.guardedScalarPairedMultiplyPatchSha256 = hash(scalarMulPatch); await save();
    assert.equal(selectRuntime(repo, 'candidate', core).coreDirectory, core);
    await writeFile(join(patches, scalarMulPatch), 'changed');
    assert.throws(() => selectRuntime(repo, 'candidate', core), /guarded scalar multiply evidence/);
    await writeFile(join(patches, scalarMulPatch), scalarMulPatch);
    manifest.pairedArithmeticVerification.scalarPairedStatusCases = 12287; await save();
    assert.throws(() => selectRuntime(repo, 'candidate', core), /guarded scalar multiply evidence/);
    manifest.pairedArithmeticVerification.scalarPairedStatusCases = 12288; await save();
    const scalarMaddPatch = '0033-guarded-scalar-paired-madd.patch';
    manifest.guardedScalarPairedMadd = true; await save();
    assert.throws(() => selectRuntime(repo, 'candidate', core), /guarded scalar madd evidence/);
    await writeFile(join(patches, scalarMaddPatch), scalarMaddPatch);
    manifest.guardedScalarPairedMaddPatchSha256 = hash(scalarMaddPatch); await save();
    assert.equal(selectRuntime(repo, 'candidate', core).coreDirectory, core);
    await writeFile(join(patches, scalarMaddPatch), 'changed');
    assert.throws(() => selectRuntime(repo, 'candidate', core), /guarded scalar madd evidence/);
    await writeFile(join(patches, scalarMaddPatch), scalarMaddPatch);
    manifest.pairedArithmeticVerification.scalarPairedStatusCases = 12287; await save();
    assert.throws(() => selectRuntime(repo, 'candidate', core), /guarded scalar madd evidence/);
    manifest.pairedArithmeticVerification.scalarPairedStatusCases = 12288; await save();
    await writeFile(join(patches, statusPatch), 'changed');
    assert.throws(() => selectRuntime(repo, 'candidate', core), /paired status regression evidence/);
    await writeFile(join(patches, statusPatch), statusPatch);
    await writeFile(join(core, 'dolphin-core-upstream.js'), 'changed');
    assert.throws(() => selectRuntime(repo, 'candidate', core), /integrity/);
  } finally { await rm(repo, { recursive: true, force: true }); }
});
