import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  appendFile,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import { discoverTests, isGameTest } from '../scripts/test-discovery.ts';

const root = resolve(import.meta.dirname, '..');

void test('discovery selects every source test once, including new colocated TSX, and excludes artifacts', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'controlla-test-discovery-'));
  try {
    const expected = [
      'tests/z.test.ts',
      'tests/nested/a.test.tsx',
      'src/client/minigames/generated-proof/game.test.tsx',
      'src/client/devtools/game-harness/controller.test.ts',
      'src/client/controls/probe/logic.test.ts',
    ].sort();
    const excluded = [
      '.worktrees/other/tests/ignored.test.ts',
      'scripts/ignored.test.ts',
      'tests/node_modules/ignored.test.ts',
      'src/dist/ignored.test.ts',
      'src/build/ignored.test.tsx',
      'tests/coverage/ignored.test.ts',
      'src/.worktrees/other/ignored.test.ts',
      'src/generated/ignored.test.ts',
      'tests/benchmark.ts',
      'tests/replay.ts',
      'tests/fixture.ts',
    ];
    for (const path of [...expected, ...excluded]) {
      await mkdir(dirname(join(directory, path)), { recursive: true });
      await writeFile(join(directory, path), '');
    }
    await symlink(
      join(directory, 'src/client'),
      join(directory, 'tests/source-link'),
      'dir',
    );
    assert.deepEqual(await discoverTests(directory), expected);
    assert.deepEqual((await discoverTests(directory)).filter(isGameTest), [
      'src/client/devtools/game-harness/controller.test.ts',
      'src/client/minigames/generated-proof/game.test.tsx',
    ]);
    // A newly scaffolded test appears on the next discovery, without registration.
    await writeFile(
      join(directory, 'src/client/minigames/generated-proof/extra.test.ts'),
      '',
    );
    assert.deepEqual(
      await discoverTests(directory),
      [
        ...expected,
        'src/client/minigames/generated-proof/extra.test.ts',
      ].sort(),
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

void test('the real runner executes newly generated TS/TSX suites exactly once and propagates failures', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'controlla-test-runner-'));
  try {
    await mkdir(join(directory, 'scripts'));
    await mkdir(join(directory, 'tests'));
    await mkdir(join(directory, 'src/client/minigames/proof'), {
      recursive: true,
    });
    await symlink(
      join(root, 'node_modules'),
      join(directory, 'node_modules'),
      'dir',
    );
    await writeFile(join(directory, 'package.json'), '{"type":"module"}');
    for (const path of ['scripts/run-tests.ts', 'scripts/test-discovery.ts'])
      await cp(join(root, path), join(directory, path));
    const marker = join(directory, 'executed.txt');
    const source = (name: string) => `
import { test } from 'node:test';
import { appendFile } from 'node:fs/promises';
void test(${JSON.stringify(name)}, async () => {
  await appendFile(${JSON.stringify(marker)}, ${JSON.stringify(name + '\n')});
});
`;
    await writeFile(
      join(directory, 'tests/engine-round.test.ts'),
      source('lifecycle'),
    );
    await writeFile(
      join(directory, 'src/client/minigames/proof/game.test.tsx'),
      source('generated'),
    );
    await writeFile(
      join(directory, 'tests/unrelated.test.ts'),
      source('unrelated'),
    );
    const run = (...args: string[]) =>
      spawnSync(
        process.execPath,
        [
          '--import',
          import.meta.resolve('tsx'),
          join(directory, 'scripts/run-tests.ts'),
          ...args,
        ],
        {
          cwd: directory,
          encoding: 'utf8',
          // This is an independent runner, not a child suite of this Node test.
          env: { ...process.env, NODE_TEST_CONTEXT: undefined },
        },
      );
    const full = run();
    assert.equal(full.status, 0, full.stdout + full.stderr);
    assert.deepEqual(
      (await readFile(marker, 'utf8')).trim().split('\n').sort(),
      ['generated', 'lifecycle', 'unrelated'],
    );
    await writeFile(marker, '');
    const game = run('--game');
    assert.equal(game.status, 0, game.stdout + game.stderr);
    assert.deepEqual(
      (await readFile(marker, 'utf8')).trim().split('\n').sort(),
      ['generated', 'lifecycle'],
    );
    await appendFile(
      join(directory, 'tests/engine-round.test.ts'),
      "\nvoid test('failure', () => { throw new Error('failure sentinel'); });\n",
    );
    const failing = run('--game');
    assert.equal(failing.status, 1, failing.stdout + failing.stderr);
    assert.match(failing.stdout + failing.stderr, /failure sentinel/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
