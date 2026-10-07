import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { test } from 'node:test';
import { renderLayoutIndex } from '../src/client/controls/layout/index-file.ts';
import { layouts } from '../src/client/controls/layouts/index.ts';

void test('regenerated catalogs load after layout creation and deletion from their relocated directory', async () => {
  const fixture = await mkdtemp(join(tmpdir(), 'controlla-layout-library-'));
  const controls = join(fixture, 'src/client/controls');
  const catalog = join(controls, 'layouts');
  try {
    await mkdir(catalog, { recursive: true });
    await mkdir(join(controls, 'layout'));
    await mkdir(join(controls, 'motion'));
    await writeFile(join(fixture, 'package.json'), '{"type":"module"}');
    for (const file of [
      'api.ts',
      'layout/schema.ts',
      'motion/registration.ts',
      'motion/metadata-registry.ts',
      'motion/pointer-definition.ts',
      'motion/accelerometer-definition.ts',
      'motion/chop-definition.ts',
      'motion/jolt-definition.ts',
    ])
      await cp(resolve('src/client/controls', file), join(controls, file));
    const probe = {
      ...layouts['aim-and-pulse'],
      id: 'ownership-probe',
      name: 'Ownership probe',
    };
    for (const layout of [layouts['aim-and-pulse'], probe])
      await writeFile(
        join(catalog, `${layout.id}.json`),
        JSON.stringify(layout),
      );
    const created = join(catalog, 'created.ts');
    await writeFile(
      created,
      renderLayoutIndex(['ownership-probe', 'aim-and-pulse']),
    );
    const loaded = await import(pathToFileURL(created).href);
    assert.deepEqual(Object.keys(loaded.layouts), [
      'aim-and-pulse',
      'ownership-probe',
    ]);
    assert.deepEqual(loaded.layouts['ownership-probe'], probe);
    await rm(join(catalog, 'ownership-probe.json'));
    const deleted = join(catalog, 'deleted.ts');
    await writeFile(deleted, renderLayoutIndex(['aim-and-pulse']));
    const remaining = await import(pathToFileURL(deleted).href);
    assert.deepEqual(Object.keys(remaining.layouts), ['aim-and-pulse']);
    assert.deepEqual(
      remaining.layouts['aim-and-pulse'],
      layouts['aim-and-pulse'],
    );
  } finally {
    await rm(fixture, { recursive: true, force: true });
  }
});
