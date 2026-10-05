import { test } from 'node:test';
import assert from 'node:assert/strict';
import { saveProgress, resumeProgress, loadProgressFile, readSavedProgressBytes, resumeComparisonProgress } from './progress.mjs';

test('progress survives a new adapter and is isolated by game/core key', async () => {
  const records = new Map();
  const store = { write: async (key, record) => records.set(key, structuredClone(record)), read: async key => records.get(key) };
  await saveProgress({ loaded: true, saveStateFile: async () => ({ saved: true, bytes: new Uint8Array([1, 2, 3]) }) }, store, 'GM4E01:core-a');
  let restored;
  const adapter = { loaded: true, loadStateFile: async bytes => { restored = bytes; return { loaded: true }; } };
  await assert.rejects(resumeProgress(adapter, store, 'GM4E01:core-b'), /No progress/);
  assert.equal(restored, undefined);
  await resumeProgress(adapter, store, 'GM4E01:core-a');
  assert.deepEqual(restored, new Uint8Array([1, 2, 3]));
});

test('failed or empty emulator saves preserve previous progress', async () => {
  let writes = 0;
  const store = { write: async () => { writes++; } };
  for (const result of [{ saved: false, bytes: new Uint8Array([1]) }, { saved: true, bytes: new Uint8Array() }]) {
    await assert.rejects(saveProgress({ loaded: true, saveStateFile: async () => result }, store, 'key'));
  }
  await assert.rejects(saveProgress({ loaded: false }, store, 'key'), /Start Double Dash/);
  assert.equal(writes, 0);
});

test('storage and native restore failures are reported', async () => {
  await assert.rejects(saveProgress({ loaded: true, saveStateFile: async () => ({ saved: true, bytes: new Uint8Array([1]) }) }, { write: async () => { throw new Error('Quota exceeded'); } }, 'key'), /Quota exceeded/);
  await assert.rejects(resumeProgress({ loaded: true, loadStateFile: async () => ({ loaded: false, error: 'Invalid state' }) }, { read: async () => ({ bytes: new Uint8Array([1]) }) }, 'key'), /Invalid state/);
});

test('explicit checkpoint import delegates compatibility and reports native rejection', async () => {
  let received;
  const bytes = new Uint8Array([9, 8, 7]);
  await loadProgressFile({ loaded: true, loadStateFile: async data => { received = data; return { loaded: true }; } }, bytes);
  assert.equal(received, bytes);
  await assert.rejects(loadProgressFile({ loaded: false }, bytes), /Start Double Dash/);
  await assert.rejects(loadProgressFile({ loaded: true, loadStateFile() {} }, new Uint8Array()), /nonempty/);
  await assert.rejects(loadProgressFile({ loaded: true, loadStateFile: async () => ({ loaded: false, error: 'Incompatible checkpoint' }) }, bytes), /Incompatible checkpoint/);
});

test('saved checkpoint export is read only and independent of a running engine', async () => {
  const bytes = new Uint8Array([4, 5, 6]);
  let readKey;
  const result = await readSavedProgressBytes({ read: async key => { readKey = key; return { bytes }; } }, 'game:core');
  assert.equal(readKey, 'game:core');
  assert.deepEqual(result, bytes);
  result[0] = 99;
  assert.equal(bytes[0], 4);
  await assert.rejects(readSavedProgressBytes({ read: async () => undefined }, 'missing'), /No saved checkpoint/);
});

test('explicit cross-core comparison restores same-game bytes without overwriting saves', async () => {
  const source = 'a'.repeat(64);
  let readKey, loaded;
  const store = { read: async key => { readKey = key; return { bytes: new Uint8Array([7, 8]), savedAt: 12 }; }, write: async () => assert.fail('comparison must not write saved progress') };
  const adapter = { loaded: true, loadStateFile: async bytes => { loaded = bytes; return { loaded: true }; } };
  await resumeComparisonProgress(adapter, store, 'GM4E01:' + 'b'.repeat(64), source);
  assert.equal(readKey, 'GM4E01:' + source);
  assert.deepEqual(loaded, new Uint8Array([7, 8]));
  await assert.rejects(resumeComparisonProgress(adapter, store, 'GM4E01:current', 'another-game:key'), /exact comparison/);
  await assert.rejects(resumeComparisonProgress(adapter, store, 'invalid:key', source), /Invalid comparison game/);
  await assert.rejects(resumeComparisonProgress({ loaded: true, loadStateFile: async () => ({ loaded: false, error: 'Incompatible core' }) }, store, 'GM4E01:current', source), /Incompatible core/);
});
