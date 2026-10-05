import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const stage = resolve(repo, 'work/double-dash-build');
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
const wasm = resolve(stage, 'cores/dolphin/dolphin-core-upstream.wasm');
const js = resolve(stage, 'cores/dolphin/dolphin-core-upstream.js');
if (!readFileSync(js, 'utf8').includes('SetControllerInputState')) throw new Error('Built loader lacks the four-controller native export.');
// Compilation validates the module without instantiating or booting game code.
const module = new WebAssembly.Module(readFileSync(wasm));
writeFileSync(resolve(stage, 'controlla-core-build.json'), JSON.stringify({
  platform: manifest.platform, wasmSha256: hash(wasm), loaderSha256: hash(js),
  toolchainSha256: hash(resolve(stage, 'controlla-macos-toolchain.json')),
  wasmExportCount: WebAssembly.Module.exports(module).length,
  patches: ['0001-four-controller-state.patch', '0002-controller-worker-transport.patch', '0003-four-controller-devices.patch'].map(name => ({ name, sha256: hash(resolve(repo, 'scripts/mario-kart/patches', name)) })),
  validatedGameplay: false,
}, null, 2) + '\n');
console.log('Four-controller WASM built and module syntax validated. Browser gameplay remains unverified.');
