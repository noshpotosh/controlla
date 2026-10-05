import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inspectDoubleDash } from './disc.mjs';

function fixture() {
  const block = 2048;
  const image = Buffer.alloc(0x8000 + block * 2);
  image.write('CISO');
  image.writeUInt32LE(block, 4);
  image[8] = 1;
  image[10] = 1; // Logical block 1 is absent; the FST is in logical block 2.
  const disc = image.subarray(0x8000);
  disc.write('GM4E01');
  disc.writeUInt32BE(0xc2339f3d, 0x1c);
  disc.write('Mario Kart Double Dash!', 0x20);
  disc.writeUInt32BE(block * 2, 0x424);
  disc.writeUInt32BE(43, 0x428);
  const fst = image.subarray(0x8000 + block);
  fst[0] = 1;
  fst.writeUInt32BE(2, 8);
  fst.writeUInt32BE(1024, 16);
  fst.writeUInt32BE(32, 20);
  fst.write('Course.arc\0', 24);
  return image;
}

async function withImage(bytes, run) {
  const folder = await mkdtemp(join(tmpdir(), 'controlla-disc-'));
  try {
    const path = join(folder, 'test.ciso');
    await writeFile(path, bytes);
    await run(path);
  } finally { await rm(folder, { recursive: true, force: true }); }
}

test('reads the filesystem beyond an absent CISO block and permits a trailing footer', async () => {
  await withImage(Buffer.concat([fixture(), Buffer.alloc(576)]), async path => {
    const info = await inspectDoubleDash(path);
    assert.equal(info.gameId, 'GM4E01');
    assert.equal(info.trailingBytes, 576);
    assert.deepEqual(info.files, [{ path: 'Course.arc', offset: 1024, size: 32 }]);
  });
});

test('rejects truncated payloads before attempting a game boot', async () => {
  await withImage(fixture().subarray(0, -1), path => assert.rejects(inspectDoubleDash(path), /truncated/));
});

test('rejects a different game and corrupt filesystem names', async () => {
  const wrong = fixture();
  wrong.write('GXXX01', 0x8000);
  await withImage(wrong, path => assert.rejects(inspectDoubleDash(path), /GM4E01/));
  const corrupt = fixture();
  corrupt.writeUInt32BE(0xffffff, 0x8000 + 2048 + 12);
  await withImage(corrupt, path => assert.rejects(inspectDoubleDash(path), /filesystem name/));
});
