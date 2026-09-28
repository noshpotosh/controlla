import assert from 'node:assert/strict';
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
import { test } from 'node:test';
import ts from 'typescript';

const root = resolve(import.meta.dirname, '..');
const loader = import.meta.resolve('tsx');

async function fixture() {
  const directory = await mkdtemp(
    join(tmpdir(), 'controlla-control-scaffold-'),
  );
  await symlink(
    join(root, 'node_modules'),
    join(directory, 'node_modules'),
    'dir',
  );
  for (const path of ['scripts', 'src/client/controls', 'src/core', 'docs'])
    await mkdir(join(directory, path), { recursive: true });
  await cp(
    join(root, 'scripts/new-control.ts'),
    join(directory, 'scripts/new-control.ts'),
  );
  await cp(
    join(root, 'scripts/templates'),
    join(directory, 'scripts/templates'),
    { recursive: true },
  );
  await writeFile(
    join(directory, 'package.json'),
    JSON.stringify({ type: 'module' }),
  );
  await writeFile(
    join(directory, 'src/client/controls/api.ts'),
    `// Independent control contract. No core import.\nexport type WidgetType = 'pointer' | "button";\nexport interface ControlDefinition { type: WidgetType; }\n`,
  );
  await writeFile(
    join(directory, 'src/client/controls/registry.ts'),
    `import { button } from './button/definition.ts';\n\n/** Library controls */\nexport const definitions = [\n  button,\n  // control:new inserts above this line\n];\n`,
  );
  await writeFile(
    join(directory, 'src/client/controls/views.ts'),
    `import { Button } from './button/Button.tsx';\n\n// Each view narrows its own props.\nexport const views = {\n  button: Button,\n  // control:new inserts above this line\n};\n`,
  );
  await writeFile(
    join(directory, 'src/client/controls/controls.css'),
    `@import './button/styles.css';\n/* control-generator:imports */\n`,
  );
  await writeFile(
    join(directory, 'src/core/types.ts'),
    `// The scaffolder must not write here.\nexport type WidgetType = 'core-sentinel';\n`,
  );
  await writeFile(
    join(directory, 'docs/INPUTS.md'),
    `# Inputs\n\n| Type | Output | Channel | Notes |\n\n## Motion\n`,
  );
  return directory;
}

function run(directory: string, ...args: string[]) {
  return spawnSync(
    process.execPath,
    ['--import', loader, join(directory, 'scripts/new-control.ts'), ...args],
    { cwd: directory, encoding: 'utf8' },
  );
}

async function tree(
  directory: string,
  prefix = '',
): Promise<Record<string, string>> {
  const entries: Record<string, string> = {};
  for (const file of await readdir(join(directory, prefix), {
    withFileTypes: true,
  })) {
    if (file.name === 'node_modules') continue;
    const relative = join(prefix, file.name);
    if (file.isDirectory())
      Object.assign(entries, await tree(directory, relative));
    else entries[relative] = await readFile(join(directory, relative), 'utf8');
  }
  return entries;
}

void test('control:new registers a template in controls only and duplicate creation changes nothing', async () => {
  const directory = await fixture();
  try {
    const before = await tree(directory);
    const created = run(directory, 'vector-probe');
    assert.equal(created.status, 0, created.stderr);
    const files = await tree(directory);
    assert.equal(files['src/core/types.ts'], before['src/core/types.ts']);
    assert.match(files['src/client/controls/api.ts'], /\| 'vector-probe';/);
    assert.match(
      files['src/client/controls/registry.ts'],
      /import \{ vectorProbe \} from '\.\/vector-probe\/definition\.ts';/,
    );
    assert.match(files['src/client/controls/registry.ts'], /\n  vectorProbe,/);
    assert.match(
      files['src/client/controls/views.ts'],
      /import \{ VectorProbe \} from '\.\/vector-probe\/VectorProbe\.tsx';/,
    );
    assert.match(
      files['src/client/controls/views.ts'],
      /'vector-probe': VectorProbe,/,
    );
    assert.match(
      files['src/client/controls/controls.css'],
      /@import '\.\/vector-probe\/styles\.css';\n\/\* control-generator:imports \*\//,
    );
    assert.match(
      files['docs/INPUTS.md'],
      /\| `vector-probe` \| TODO \| TODO \|/,
    );
    assert.match(
      files['src/client/controls/vector-probe/definition.ts'],
      /from '\.\.\/api\.ts'/,
    );
    assert.match(
      files['src/client/controls/vector-probe/definition.ts'],
      /type: 'vector-probe'/,
    );
    assert.match(
      files['src/client/controls/vector-probe/VectorProbe.tsx'],
      /export function VectorProbe/,
    );
    assert.match(
      files['src/client/controls/vector-probe/VectorProbe.tsx'],
      /port\.value\(vectorProbeValue/,
    );
    assert.match(
      files['src/client/controls/vector-probe/logic.ts'],
      /export function vectorProbeValue/,
    );
    assert.match(
      files['src/client/controls/vector-probe/styles.css'],
      /\.ctl-vector-probe__body/,
    );
    for (const [path, source] of Object.entries(files).filter(([path]) =>
      path.startsWith('src/client/controls/vector-probe/'),
    ))
      assert.doesNotMatch(source, /__(TYPE|PASCAL|CAMEL|TITLE)__/, path);
    const duplicate = run(directory, 'vector-probe');
    assert.notEqual(duplicate.status, 0);
    assert.match(duplicate.stderr, /already exists/);
    assert.deepEqual(await tree(directory), files);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

void test('control:new --from preserves the source while registering the copied control', async () => {
  const directory = await fixture();
  try {
    assert.equal(run(directory, 'source-probe').status, 0);
    const before = await tree(directory);
    const copied = run(directory, 'copied-probe', '--from', 'source-probe');
    assert.equal(copied.status, 0, copied.stderr);
    const files = await tree(directory);
    for (const [path, text] of Object.entries(before).filter(([path]) =>
      path.startsWith('src/client/controls/source-probe/'),
    ))
      assert.equal(files[path], text);
    assert.equal(files['src/core/types.ts'], before['src/core/types.ts']);
    assert.match(
      files['src/client/controls/copied-probe/definition.ts'],
      /export const copiedProbe:/,
    );
    assert.match(
      files['src/client/controls/copied-probe/definition.ts'],
      /type: 'copied-probe'/,
    );
    assert.match(
      files['src/client/controls/copied-probe/CopiedProbe.tsx'],
      /export function CopiedProbe/,
    );
    assert.match(
      files['src/client/controls/copied-probe/styles.css'],
      /\.ctl-copied-probe__body/,
    );
    assert.match(files['src/client/controls/api.ts'], /\| 'copied-probe';/);
    assert.match(files['src/client/controls/registry.ts'], /\n  copiedProbe,/);
    assert.match(
      files['src/client/controls/views.ts'],
      /'copied-probe': CopiedProbe,/,
    );
    assert.match(
      files['src/client/controls/controls.css'],
      /@import '\.\/copied-probe\/styles\.css';/,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

void test('control:new rejects an already registered type before creating any files', async () => {
  const directory = await fixture();
  try {
    const before = await tree(directory);
    const duplicate = run(directory, 'pointer');
    assert.notEqual(duplicate.status, 0);
    assert.match(
      duplicate.stderr,
      /already registered in src\/client\/controls\/api\.ts/,
    );
    assert.deepEqual(await tree(directory), before);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

for (const [original, copied, outputType] of [
  ['stick', 'copied-stick', 'StickOutput'],
  ['dpad', 'copied-dpad', 'DpadOutput'],
] as const) {
  void test(`control:new --from ${original} preserves shared types and typechecks the actual library copy`, async () => {
    const directory = await fixture();
    try {
      await cp(
        join(root, 'src/client/controls'),
        join(directory, 'src/client/controls'),
        {
          recursive: true,
        },
      );
      if (original === 'stick') {
        // Both halves matter: external aliases keep their names/references, while
        // source-owned named imports follow the renamed definition declaration.
        await writeFile(
          join(directory, 'src/client/controls/stick/identity.ts'),
          `
import type { StickOutput as StickShared } from '../api.ts';
import { stick as StickDefinition } from './definition.ts';
export type { StickOutput } from '../api.ts';
export { stick as StickSource } from './definition.ts';
export const StickIdentity = (value: StickShared) => ({ value, definition: StickDefinition });
`,
        );
      }
      const before = await tree(
        join(directory, 'src/client/controls', original),
      );
      const generated = run(directory, copied, '--from', original);
      assert.equal(generated.status, 0, generated.stderr);
      assert.deepEqual(
        await tree(join(directory, 'src/client/controls', original)),
        before,
      );
      const copy = await tree(join(directory, 'src/client/controls', copied));
      const view = Object.keys(copy).find((name) => name.endsWith('.tsx'))!;
      assert.ok(copy[view].includes(outputType));
      assert.ok(copy['logic.ts'].includes(outputType));
      if (original === 'stick') {
        assert.match(copy['identity.ts'], /StickOutput as StickShared/);
        assert.match(copy['identity.ts'], /value: StickShared/);
        assert.match(
          copy['identity.ts'],
          /copiedStick as CopiedStickDefinition/,
        );
        assert.match(copy['identity.ts'], /definition: CopiedStickDefinition/);
        assert.match(copy['identity.ts'], /export type \{ StickOutput \}/);
        assert.match(copy['identity.ts'], /copiedStick as CopiedStickSource/);
        assert.match(copy['identity.ts'], /export const CopiedStickIdentity/);
      }
      const files = Object.keys(copy)
        .filter((file) => /\.tsx?$/.test(file))
        .map((file) => join(directory, 'src/client/controls', copied, file));
      const program = ts.createProgram(
        [
          ...files,
          join(directory, 'src/client/controls/registry.ts'),
          join(directory, 'src/client/controls/views.ts'),
        ],
        {
          target: ts.ScriptTarget.ESNext,
          module: ts.ModuleKind.ESNext,
          moduleResolution: ts.ModuleResolutionKind.Bundler,
          jsx: ts.JsxEmit.ReactJSX,
          strict: true,
          noEmit: true,
          skipLibCheck: true,
          allowImportingTsExtensions: true,
          esModuleInterop: true,
        },
      );
      const errors = ts.getPreEmitDiagnostics(program);
      assert.equal(
        errors.length,
        0,
        ts.formatDiagnostics(errors, {
          getCurrentDirectory: () => directory,
          getCanonicalFileName: (file) => file,
          getNewLine: () => '\n',
        }),
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
}
