import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export function selectRuntime(repo, mode = 'prebuilt') {
  if (mode === 'prebuilt') return { path: resolve(repo, 'work/wasm-dolphin'), rebuilt: false, coreHash: null };
  if (mode !== 'rebuilt') throw new Error('DOUBLE_DASH_RUNTIME must be prebuilt or rebuilt.');
  const path = resolve(repo, 'work/double-dash-build');
  const manifest = JSON.parse(readFileSync(resolve(path, 'controlla-core-build.json'), 'utf8'));
  for (const [name, expected] of [['dolphin-core-upstream.wasm', manifest.wasmSha256], ['dolphin-core-upstream.js', manifest.loaderSha256]]) {
    if (!/^[0-9a-f]{64}$/.test(expected || '')) throw new Error('Incomplete rebuilt-core manifest.');
    const actual = createHash('sha256').update(readFileSync(resolve(path, 'cores/dolphin', name))).digest('hex');
    if (actual !== expected) throw new Error(`Rebuilt ${name} differs from its build manifest.`);
  }
  return { path, rebuilt: true, coreHash: manifest.wasmSha256 };
}
