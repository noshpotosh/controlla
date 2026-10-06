import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const build = resolve(repo, 'work/double-dash-build');
const sdk = resolve(repo, 'work/emsdk');
const rust = resolve(repo, 'work/rust');
if (process.platform !== 'darwin' || process.arch !== 'arm64') throw new Error('This configuration targets Apple Silicon macOS.');
const paths = {
  emcc: resolve(sdk, 'upstream/emscripten/emcc'),
  emcmake: resolve(sdk, 'upstream/emscripten/emcmake'),
  cmake: resolve(repo, 'work/build-tools/cmake/data/bin/cmake'),
  ninja: resolve(repo, 'work/build-tools/bin/ninja'),
  cargo: resolve(rust, 'cargo/bin/cargo'),
  rustc: resolve(rust, 'cargo/bin/rustc'),
};
for (const path of Object.values(paths)) if (!existsSync(path)) throw new Error(`Build dependency missing: ${path}`);
const env = { ...process.env,
  EM_CONFIG: resolve(sdk, '.emscripten'),
  EMSDK_NODE: resolve(sdk, 'node/24.19.0_64bit/bin/node'),
  EMSDK_PYTHON: resolve(sdk, 'python/3.13.3_64bit/bin/python3'),
  CARGO_HOME: resolve(rust, 'cargo'), RUSTUP_HOME: resolve(rust, 'rustup'),
  PATH: [...new Set(Object.values(paths).map(dirname)), resolve(sdk, 'python/3.13.3_64bit/bin'), process.env.PATH].join(':'),
};
const records = Object.fromEntries(Object.entries(paths).map(([name, path]) => {
  const result = name === 'emcmake' ? { status: 0, stdout: 'Emscripten CMake wrapper (version follows emcc)' } : spawnSync(path, ['--version'], { env, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`${name} version check failed: ${result.stderr}`);
  return [name, { path, sha256: createHash('sha256').update(readFileSync(path)).digest('hex'), version: result.stdout.trim() }];
}));
if (!records.emcc.version.includes('5.0.7')) throw new Error('Expected Emscripten 5.0.7.');
const provenance = { platform: 'darwin-arm64', tools: records, rustTarget: 'wasm32-unknown-emscripten' };
const manifest = resolve(build, 'controlla-macos-toolchain.json');
writeFileSync(manifest, JSON.stringify(provenance, null, 2) + '\n');
const lockHash = createHash('sha256').update(readFileSync(manifest)).digest('hex');
const cargoHash = createHash('sha256').update(readFileSync(resolve(build, 'tools/naga-spirv-wgsl/Cargo.lock'))).digest('hex');
// Preserve the upstream Windows verifier; this generated entry point records
// the actual macOS tools rather than claiming compatibility with Windows hashes.
const scalarDispatch = process.env.DOLPHIN_WEB_DIRECT_SCALAR_PAIRED || '1';
if (!['0', '1'].includes(scalarDispatch)) throw new Error('DOLPHIN_WEB_DIRECT_SCALAR_PAIRED must be 0 or 1.');
const source = readFileSync(resolve(build, 'tools/configure-upstream-wasm.mjs'), 'utf8')
  .replace('-DXXH_VECTOR=0 ', `-DXXH_VECTOR=0 -DDOLPHIN_WEB_DIRECT_SCALAR_PAIRED=${scalarDispatch} `)
  .replace('const toolchain = verifyWasmToolchain();', `const toolchain = ${JSON.stringify({ paths, lock: { rust: { target: 'wasm32-unknown-emscripten' } }, hashes: { lock: lockHash, cargoLock: cargoHash } })};`)
  .replace('`${dirname(rustc)};${dirname(emcc)};${process.env.PATH ?? ""}`', '`${dirname(rustc)}:${dirname(emcc)}:${process.env.PATH ?? ""}`');
const generated = resolve(build, 'tools/configure-controlla-macos.mjs');
writeFileSync(generated, source);
const result = spawnSync(process.execPath, [generated], { cwd: build, env, stdio: 'inherit' });
process.exitCode = result.status ?? 1;
