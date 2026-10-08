import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { discoverTests, isGameTest } from '../scripts/test-discovery.ts';
import { catalogEntries } from '../scripts/catalog-registration.ts';
const root = resolve(import.meta.dirname, '..'),
  loader = import.meta.resolve('tsx');
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'controlla-game-scaffold-'));
  await symlink(
    join(root, 'node_modules'),
    join(directory, 'node_modules'),
    'dir',
  );
  await mkdir(join(directory, 'scripts/templates'), { recursive: true });
  await cp(join(root, 'tests/fixtures'), join(directory, 'tests/fixtures'), {
    recursive: true,
  });
  for (const path of ['src', 'components', 'lib', 'hooks'])
    await cp(join(root, path), join(directory, path), { recursive: true });
  await cp(
    join(root, 'scripts/templates/game'),
    join(directory, 'scripts/templates/game'),
    { recursive: true },
  );
  for (const file of ['new-game.ts', 'catalog-registration.ts'])
    await cp(join(root, 'scripts', file), join(directory, 'scripts', file));
  await cp(join(root, 'tsconfig.json'), join(directory, 'tsconfig.json'));
  await writeFile(
    join(directory, 'package.json'),
    JSON.stringify({ type: 'module' }),
  );
  return directory;
}
const run = (directory: string, ...args: string[]) =>
  spawnSync(
    process.execPath,
    ['--import', loader, join(directory, 'scripts/new-game.ts'), ...args],
    { cwd: directory, encoding: 'utf8' },
  );
async function files(
  directory: string,
  prefix = '',
): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  for (const entry of await readdir(join(directory, prefix), {
    withFileTypes: true,
  })) {
    if (['node_modules', '.git'].includes(entry.name)) continue;
    const path = join(prefix, entry.name);
    if (entry.isDirectory())
      Object.assign(result, await files(directory, path));
    else result[path] = await readFile(join(directory, path), 'utf8');
  }
  return result;
}
void test('game:new creates only its folder/catalog, discovers and runs its test, and typechecks the real source fixture', async (t) => {
  const directory = await fixture();
  t.after(() => rm(directory, { recursive: true, force: true }));
  const before = await files(directory);
  const generated = run(directory, 'scaffold-unit-proof');
  assert.equal(generated.status, 0, generated.stderr);
  const after = await files(directory);
  const changed = Object.keys(after)
    .filter((file) => before[file] !== after[file])
    .sort();
  assert.deepEqual(
    changed,
    [
      'src/client/minigames/catalog.ts',
      ...['game.test.ts', 'game.ts', 'index.ts', 'renderer.ts'].map(
        (file) => `src/client/minigames/scaffold-unit-proof/${file}`,
      ),
    ].sort(),
  );
  const entries = catalogEntries(after['src/client/minigames/catalog.ts']);
  assert.equal(
    entries.filter((entry) => entry.path === './scaffold-unit-proof/index.ts')
      .length,
    1,
  );
  const tests = await discoverTests(directory);
  const path = 'src/client/minigames/scaffold-unit-proof/game.test.ts';
  assert.ok(tests.includes(path));
  assert.ok(isGameTest(path));
  const check = spawnSync(
    process.execPath,
    ['--import', loader, '--test', path],
    { cwd: directory, encoding: 'utf8' },
  );
  assert.equal(check.status, 0, check.stdout + check.stderr);
  const types = spawnSync(
    process.execPath,
    [
      join(root, 'node_modules/typescript/bin/tsc'),
      '--noEmit',
      '--incremental',
      'false',
    ],
    { cwd: directory, encoding: 'utf8' },
  );
  assert.equal(types.status, 0, types.stdout + types.stderr);
  const duplicate = run(directory, 'scaffold-unit-proof');
  assert.notEqual(duplicate.status, 0);
  assert.deepEqual(
    await files(directory),
    after,
    'duplicate generation changes nothing',
  );
});
void test('game:new rejects invalid arguments and registered collisions before writing', async (t) => {
  const directory = await fixture();
  t.after(() => rm(directory, { recursive: true, force: true }));
  const before = await files(directory);
  for (const args of [
    [],
    ['../escape'],
    ['Bad'],
    ['1game'],
    ['a--b'],
    ['a'.repeat(65)],
    ['valid', '--from'],
    ['neon-harvest'],
    ['default'],
    ['find'],
  ]) {
    assert.notEqual(run(directory, ...args).status, 0, JSON.stringify(args));
    assert.deepEqual(await files(directory), before);
  }
  const catalogPath = join(directory, 'src/client/minigames/catalog.ts');
  await writeFile(
    catalogPath,
    before['src/client/minigames/catalog.ts'].replace(
      'neonHarvest, whackAMole',
      'neonHarvest, whackAMole, collisionGame',
    ) + "\nimport { collisionGame } from './collision/index.ts';\n",
  );
  const registered = await files(directory);
  assert.notEqual(run(directory, 'collision').status, 0);
  assert.deepEqual(await files(directory), registered);
});

void test('game:new supports formatted trailing-comma catalogs and keyword slugs without invalid identifiers', async (t) => {
  const directory = await fixture();
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, 'src/client/minigames/catalog.ts');
  await writeFile(
    path,
    (await readFile(path, 'utf8')).replace(
      '[neonHarvest, whackAMole]',
      '[\n  neonHarvest,\n  whackAMole,\n]',
    ),
  );
  assert.equal(run(directory, 'class').status, 0);
  const catalog = await readFile(path, 'utf8');
  assert.ok(
    catalogEntries(catalog).some((entry) => entry.name === 'classGame'),
  );
  const types = spawnSync(
    process.execPath,
    [
      join(root, 'node_modules/typescript/bin/tsc'),
      '--noEmit',
      '--incremental',
      'false',
    ],
    { cwd: directory, encoding: 'utf8' },
  );
  assert.equal(types.status, 0, types.stdout + types.stderr);
});
