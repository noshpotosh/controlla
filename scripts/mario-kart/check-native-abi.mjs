import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { selectRuntime } from './runtime-selection.mjs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const candidate = selectRuntime(repo, 'rebuilt');
const { default: createCore } = await import(pathToFileURL(resolve(candidate.path, 'cores/dolphin/dolphin-core-upstream.js')).href);
const core = await createCore({ noInitialRun: true });
for (const port of [0, 1, 2, 3]) {
  for (const connected of [1, 0]) {
    assert.equal(core.ccall('SetControllerInputState', 'number', Array(12).fill('number'),
      [port, connected, 1, 128, 128, 128, 128, 0, 0, 255, 0, 1]), 1);
  }
}
for (const port of [-1, 4]) {
  assert.equal(core.ccall('SetControllerInputState', 'number', Array(12).fill('number'),
    [port, 1, 0, 128, 128, 128, 128, 0, 0, 0, 0, 1]), 0);
}
const manifestPath = resolve(candidate.path, 'controlla-core-build.json');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
manifest.nativeInputAbiChecked = true;
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
console.log('Built WASM accepts connection/disconnection on all four ports and rejects invalid ports. No game was booted.');
// Emscripten's pthread pool keeps Node alive after the checks.
process.exit(0);
