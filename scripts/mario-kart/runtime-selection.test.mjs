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
