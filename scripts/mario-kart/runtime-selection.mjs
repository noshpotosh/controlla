import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export function selectRuntime(repo, mode = 'prebuilt', candidateOutput = process.env.DOUBLE_DASH_CORE_OUTPUT_DIR) {
  if (mode === 'prebuilt') return { path: resolve(repo, 'work/wasm-dolphin'), rebuilt: false, coreHash: null };
  if (mode === 'candidate') {
    if (!candidateOutput) throw new Error('Set DOUBLE_DASH_CORE_OUTPUT_DIR for candidate mode.');
    const coreDirectory = resolve(repo, candidateOutput);
    const path = resolve(repo, 'work/double-dash-build');
    const manifest = JSON.parse(readFileSync(resolve(coreDirectory, 'controlla-core-build.json'), 'utf8'));
    const verification = manifest.pairedArithmeticVerification;
    if (!manifest.nativeInputAbiChecked || !manifest.referencePairedArithmetic ||
        !manifest.directReferenceDispatch || !manifest.pairedDifferentialRegression ||
        verification?.wasmSha256 !== manifest.wasmSha256 || verification?.differentialCases !== 3744)
      throw new Error('Candidate requires verified controller ABI and reference arithmetic comparisons.');
    const hash = file => createHash('sha256').update(readFileSync(file)).digest('hex');
    if (manifest.guardedScalarPairedMadd && (!manifest.scalarPairedStatusRegression ||
        verification.scalarPairedStatusCases !== 6144 || !manifest.guardedScalarPairedMaddPatchSha256 ||
        manifest.guardedScalarPairedMaddPatchSha256 !==
        hash(resolve(repo, 'scripts/mario-kart/patches/0033-guarded-scalar-paired-madd.patch'))))
      throw new Error('Candidate guarded scalar madd evidence mismatch.');
    if (manifest.guardedScalarPairedMultiply && (!manifest.scalarPairedStatusRegression ||
        verification.scalarPairedStatusCases !== 6144 || !manifest.guardedScalarPairedMultiplyPatchSha256 ||
        manifest.guardedScalarPairedMultiplyPatchSha256 !==
        hash(resolve(repo, 'scripts/mario-kart/patches/0032-guarded-scalar-paired-multiply.patch'))))
      throw new Error('Candidate guarded scalar multiply evidence mismatch.');
    if (manifest.directScalarPaired && !manifest.pairedFpEligibility)
      throw new Error('Candidate direct scalar paired reference requires patch-0031 evidence.');
    if (manifest.pairedFpEligibility && manifest.pairedFpEligibilityPatchSha256 !==
        hash(resolve(repo, 'scripts/mario-kart/patches/0031-paired-fp-eligibility-attribution.patch')))
      throw new Error('Candidate paired FP eligibility patch provenance mismatch.');
    if (manifest.guardedInlinePaired && manifest.guardedInlinePairedPatchSha256 !==
        hash(resolve(repo, 'scripts/mario-kart/patches/0030-guarded-inline-paired-add-sub.patch')))
      throw new Error('Candidate guarded inline paired patch provenance mismatch.');
    if (manifest.inlineNormalFprf && manifest.inlineNormalFprfPatchSha256 !==
        hash(resolve(repo, 'scripts/mario-kart/patches/0029-inline-normal-fprf.patch')))
      throw new Error('Candidate inline normal FPRF patch provenance mismatch.');
    if (manifest.sampledFpHelperTiming && manifest.sampledFpHelperTimingPatchSha256 !==
        hash(resolve(repo, 'scripts/mario-kart/patches/0028-sampled-fp-helper-timing.patch')))
      throw new Error('Candidate FP helper timing patch provenance mismatch.');
    for (const [name, field] of [
      ['0021-reference-paired-arithmetic.patch', 'referencePairedArithmeticPatchSha256'],
      ['0023-direct-reference-paired-dispatch.patch', 'directReferenceDispatchPatchSha256'],
      ['0024-differential-paired-arithmetic.patch', 'pairedDifferentialRegressionPatchSha256'],
    ]) {
      if (manifest[field] !== hash(resolve(repo, 'scripts/mario-kart/patches', name)))
        throw new Error('Candidate patch provenance mismatch: ' + name);
    }
    if (manifest.scalarPairedStatusRegression && (!manifest.pairedStatusRegression || verification.scalarPairedStatusCases !== 6144))
      throw new Error('Candidate scalar paired status regression evidence mismatch.');
    if (manifest.pairedStatusRegression && (verification.pairedStatusCases !== 1536 ||
        manifest.pairedStatusRegressionPatchSha256 !==
        hash(resolve(repo, 'scripts/mario-kart/patches/0027-paired-status-regression.patch'))))
      throw new Error('Candidate paired status regression evidence mismatch.');
    if (manifest.finitePairedAddSub && manifest.finitePairedAddSubPatchSha256 !==
        hash(resolve(repo, 'scripts/mario-kart/patches/0026-finite-paired-add-sub.patch')))
      throw new Error('Candidate finite paired arithmetic patch provenance mismatch.');
    if (manifest.optInFpAttribution && manifest.optInFpAttributionPatchSha256 !==
        hash(resolve(repo, 'scripts/mario-kart/patches/0025-opt-in-fp-opcode-attribution.patch')))
      throw new Error('Candidate FP attribution patch provenance mismatch.');
    for (const [name, expected] of [['dolphin-core-upstream.wasm', manifest.wasmSha256], ['dolphin-core-upstream.js', manifest.loaderSha256]]) {
      if (!/^[0-9a-f]{64}$/.test(expected || '') || hash(resolve(coreDirectory, name)) !== expected)
        throw new Error('Candidate binary integrity mismatch: ' + name);
    }
    return { path, coreDirectory, rebuilt: true, coreHash: manifest.wasmSha256 };
  }
  if (mode !== 'rebuilt') throw new Error('DOUBLE_DASH_RUNTIME must be prebuilt, rebuilt, or candidate.');
  const path = resolve(repo, 'work/double-dash-build');
  const manifest = JSON.parse(readFileSync(resolve(path, 'controlla-core-build.json'), 'utf8'));
  for (const [name, expected] of [['dolphin-core-upstream.wasm', manifest.wasmSha256], ['dolphin-core-upstream.js', manifest.loaderSha256]]) {
    if (!/^[0-9a-f]{64}$/.test(expected || '')) throw new Error('Incomplete rebuilt-core manifest.');
    const actual = createHash('sha256').update(readFileSync(resolve(path, 'cores/dolphin', name))).digest('hex');
    if (actual !== expected) throw new Error(`Rebuilt ${name} differs from its build manifest.`);
  }
  return { path, rebuilt: true, coreHash: manifest.wasmSha256 };
}
