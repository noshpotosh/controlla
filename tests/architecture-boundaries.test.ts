import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { test } from 'node:test';
import ts from 'typescript';
import type { RoundSnapshot } from '../src/client/api/index.ts';
import { games } from '../src/client/minigames/catalog.ts';
import { neonHarvest } from '../src/client/minigames/neon-harvest/index.ts';
import type { NeonHarvestState } from '../src/client/minigames/neon-harvest/game.ts';
import { createScreen } from '../src/client/game-screen/screen.ts';
import { SessionProgress } from '../src/client/engine/progress.ts';

// Tests run from the package directory, like the existing file-backed tests.
const root = resolve(process.cwd());
const harness = join(root, 'src/client/devtools/game-harness');
const targetDirectory = join(root, 'src/client/minigames/neon-harvest');
const api = join(root, 'src/client/api/index.ts');
const catalog = join(root, 'src/client/minigames/catalog.ts');
const config = ts.readConfigFile(join(root, 'tsconfig.json'), (file) =>
  ts.sys.readFile(file),
);
assert.equal(config.error, undefined);
const options = ts.parseJsonConfigFileContent(
  config.config,
  ts.sys,
  root,
).options;

interface ImportEdge {
  specifier: string;
  typeOnly: boolean;
  resolved?: string;
}

function within(file: string, directory: string): boolean {
  return file === directory || file.startsWith(directory + sep);
}

function isSource(file: string): boolean {
  return /\.[cm]?[jt]sx?$/.test(file);
}

function productionFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = join(directory, entry.name);
    if (entry.isDirectory()) return productionFiles(file);
    return isSource(file) &&
      !/\.(?:test|spec)\.[cm]?[jt]sx?$/.test(file) &&
      !file.endsWith('.d.ts')
      ? [file]
      : [];
  });
}

const edgeCache = new Map<string, ImportEdge[]>();

/** Resolve imports/re-exports, import types and literal dynamic imports as TS does. */
function imports(file: string, sourceText?: string): ImportEdge[] {
  const cached = sourceText === undefined ? edgeCache.get(file) : undefined;
  if (cached) return cached;
  const source = ts.createSourceFile(
    file,
    sourceText ?? readFileSync(file, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
  );
  const result: ImportEdge[] = [];
  const add = (specifier: string, typeOnly: boolean) => {
    result.push({
      specifier,
      typeOnly,
      resolved: ts.resolveModuleName(specifier, file, options, ts.sys)
        .resolvedModule?.resolvedFileName,
    });
  };
  const visit = (node: ts.Node): void => {
    if (
      ts.isImportDeclaration(node) &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      const clause = node.importClause;
      const bindings = clause?.namedBindings;
      const typeOnly =
        clause?.phaseModifier === ts.SyntaxKind.TypeKeyword ||
        !!(
          clause &&
          !clause.name &&
          bindings &&
          ts.isNamedImports(bindings) &&
          bindings.elements.length > 0 &&
          bindings.elements.every((binding) => binding.isTypeOnly)
        );
      add(node.moduleSpecifier.text, typeOnly);
    } else if (
      ts.isExportDeclaration(node) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      const clause = node.exportClause;
      const typeOnly =
        node.isTypeOnly ||
        !!(
          clause &&
          ts.isNamedExports(clause) &&
          clause.elements.length > 0 &&
          clause.elements.every((binding) => binding.isTypeOnly)
        );
      add(node.moduleSpecifier.text, typeOnly);
    } else if (
      ts.isImportTypeNode(node) &&
      ts.isLiteralTypeNode(node.argument) &&
      ts.isStringLiteral(node.argument.literal)
    ) {
      add(node.argument.literal.text, true);
    } else if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference)
    ) {
      const expression = node.moduleReference.expression;
      if (expression && ts.isStringLiteral(expression))
        add(expression.text, node.isTypeOnly);
    } else if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) &&
          node.expression.text === 'require'))
    ) {
      const specifier = node.arguments[0];
      assert.ok(
        specifier && ts.isStringLiteralLike(specifier),
        `${relative(root, file)} uses an opaque dynamic import; the boundary cannot be verified`,
      );
      add(specifier.text, false);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  if (sourceText === undefined) edgeCache.set(file, result);
  return result;
}

/** Traverse project modules recursively; type edges may be included separately. */
function dependencies(
  entry: string,
  includeTypes = false,
  overrides = new Map<string, string>(),
): Set<string> {
  const seen = new Set<string>();
  const pending = [entry];
  while (pending.length) {
    const file = pending.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    if (!isSource(file)) continue;
    for (const edge of imports(file, overrides.get(file))) {
      if (edge.typeOnly && !includeTypes) continue;
      if (
        edge.resolved &&
        within(edge.resolved, root) &&
        !edge.resolved.includes(`${sep}node_modules${sep}`)
      )
        pending.push(edge.resolved);
    }
  }
  return seen;
}

void test('Neon Harvest production modules import only their own folder or the author API', () => {
  const files = productionFiles(targetDirectory);
  assert.ok(files.length >= 3, 'descriptor, game and renderer are present');
  for (const file of files) {
    for (const edge of imports(file)) {
      assert.ok(
        edge.resolved &&
          (within(edge.resolved, targetDirectory) || edge.resolved === api),
        `${relative(root, file)} imports ${edge.specifier} outside the author boundary`,
      );
    }
  }
  assert.equal(
    imports(api).filter((edge) => !edge.typeOnly).length,
    0,
    'the author API has no runtime imports',
  );
  const runtime = dependencies(join(targetDirectory, 'index.ts'));
  assert.ok(
    [...runtime].every((file) => within(file, targetDirectory) || file === api),
  );
});

void test('the catalog is the only production module that imports Neon Harvest', () => {
  const incoming = [
    ...productionFiles(join(root, 'src')),
    ...productionFiles(join(root, 'app')),
  ]
    .filter((file) => !within(file, targetDirectory) && !within(file, harness))
    .flatMap((file) =>
      imports(file)
        .filter(
          (edge) => edge.resolved && within(edge.resolved, targetDirectory),
        )
        .map(() => file),
    );
  assert.deepEqual(incoming, [catalog]);
  assert.equal(games.filter((game) => game.id === neonHarvest.id).length, 1);
  assert.ok(
    games.includes(neonHarvest),
    'registration retains descriptor identity',
  );
});

void test('game and harness dependency graphs stay outside shell, network ownership and tooling', () => {
  const forbidden = [
    'src/client/shell',
    'src/client/runtime.ts',
    'server',
    'src/client/devtools/motion-lab',
    'src/client/devtools/designer',
    'src/client/devtools/gallery',
    'src/client/devtools/preview',
  ].map((path) => join(root, path));
  const entries = [
    join(harness, 'harness.ts'),
    join(targetDirectory, 'index.ts'),
  ];
  for (const entry of entries) {
    for (const file of dependencies(entry, true)) {
      assert.ok(
        !forbidden.some((directory) => within(file, directory)),
        `${relative(root, entry)} reaches ${relative(root, file)}`,
      );
      for (const edge of imports(file).filter((edge) => !edge.typeOnly)) {
        assert.ok(
          !/^(?:ws|react|next|vinext)(?:\/|$)/.test(edge.specifier),
          `${relative(root, file)} imports shell/network package ${edge.specifier}`,
        );
      }
    }
  }
  for (const file of dependencies(
    join(root, 'src/client/shell/App.tsx'),
    true,
  )) {
    assert.ok(
      !within(file, harness),
      `the shipped shell reaches the game harness: ${relative(root, file)}`,
    );
  }
  const screenForbidden = [
    ...forbidden,
    join(root, 'src/client/engine/progress.ts'),
    join(harness, 'harness.ts'),
    join(root, 'src/games'),
    join(harness, 'games'),
  ];
  for (const file of dependencies(
    join(root, 'src/client/game-screen/screen.ts'),
  )) {
    assert.ok(
      !screenForbidden.some((directory) => within(file, directory)),
      `screen reaches authority or a concrete game: ${relative(root, file)}`,
    );
  }
});

void test('screen exposes detached, deeply frozen progress and no completion capability to a renderer', () => {
  const session = new SessionProgress();
  session.open('previous-round', ['ada', 'bea']).complete([
    { playerId: 'ada', placement: 1, score: 3 },
    { playerId: 'bea', placement: 2, score: 1 },
  ]);
  const authoritative = session.view();
  const compact = session.compact(['ada', 'bea']);
  const snapshot: RoundSnapshot<NeonHarvestState> = {
    schemaVersion: 1,
    mode: 'standard',
    roundId: 'presentation-probe',
    gameId: neonHarvest.id,
    phase: 'running',
    startAt: 0,
    endAt: 30_000,
    players: [],
    cursors: {},
    events: [],
    outcomes: [],
    state: { nodes: [], scores: {}, players: {}, effects: [], wave: 0 },
    progress: compact,
    error: null,
  };
  let rendered = false;
  const screen = createScreen({
    ...neonHarvest,
    presentation: { cursors: false },
    createRenderer: () => ({
      render(presentation) {
        rendered = true;
        assert.deepEqual(Object.keys(presentation).sort(), [
          'context',
          'delay',
          'height',
          'localCursors',
          'reducedMotion',
          'snapshot',
          'time',
          'width',
        ]);
        assert.notEqual(presentation.snapshot, snapshot);
        assert.ok(Object.isFrozen(presentation.snapshot.progress));
        assert.equal(
          Reflect.set(presentation.snapshot.progress.totals, 'ada', 999),
          false,
        );
        assert.equal(
          Reflect.set(presentation.snapshot.progress.awards, 'ada', 999),
          false,
        );
        assert.equal('complete' in presentation, false);
        assert.equal('complete' in presentation.snapshot.progress, false);
      },
      dispose() {},
    }),
  });
  const context = {
    save() {},
    restore() {},
    fillRect() {},
  } as unknown as CanvasRenderingContext2D;
  screen.render(context, snapshot, 100, 640, 360);
  assert.equal(rendered, true);
  assert.deepEqual(snapshot.progress, compact);
  assert.deepEqual(session.view(), authoritative);
  screen.dispose();
});

void test('the production canvas and game screen can read presentation but cannot reach session authority or progress mutation', () => {
  const screenDirectory = join(root, 'src/client/game-screen');
  const canvas = join(root, 'src/client/GameCanvas.tsx');
  const forbidden = [
    'src/client/runtime.ts',
    'src/client/network.ts',
    'src/core/session.ts',
    'src/client/engine/round.ts',
    'src/client/engine/progress.ts',
    'src/client/engine/history.ts',
    'src/client/shell',
    'src/client/devtools',
    'src/experiments',
    'server',
  ].map((path) => join(root, path));
  for (const entry of [canvas, ...productionFiles(screenDirectory)]) {
    for (const file of dependencies(entry, true)) {
      assert.ok(
        !forbidden.some((path) => within(file, path)),
        `${relative(root, entry)} reaches authority or a broad runtime: ${relative(root, file)}`,
      );
    }
  }
  for (const file of productionFiles(screenDirectory)) {
    for (const edge of imports(file)) {
      assert.ok(
        edge.resolved &&
          (within(edge.resolved, screenDirectory) ||
            (edge.resolved === api && edge.typeOnly)),
        `${relative(root, file)} imports outside the screen contract: ${edge.specifier}`,
      );
    }
  }
  const source = ts.createSourceFile(
    'port.ts',
    readFileSync(join(screenDirectory, 'port.ts'), 'utf8'),
    ts.ScriptTarget.Latest,
    true,
  );
  const port = source.statements.find(
    (statement): statement is ts.InterfaceDeclaration =>
      ts.isInterfaceDeclaration(statement) &&
      statement.name.text === 'ScreenPort',
  );
  assert.ok(port);
  assert.deepEqual(
    port.members
      .map((member) => member.name?.getText(source) ?? '')
      .sort((a, b) => a.localeCompare(b)),
    ['advanceFrame', 'presented'],
    'the canvas port exposes only frame sampling and visible marker acknowledgments',
  );
});

void test('shell ports stay type-only and UI leaves cannot reach the runtime', () => {
  const ports = join(root, 'src/client/shell/ports.ts');
  const allowed = [
    'src/client/controls/api.ts',
    'src/core/types.ts',
    'src/core/motion/trace.ts',
    'src/client/game-screen/port.ts',
  ].map((path) => join(root, path));
  for (const edge of imports(ports))
    assert.ok(
      edge.typeOnly && allowed.includes(edge.resolved!),
      `shell contract imports implementation: ${edge.specifier}`,
    );
  for (const entry of shellLeaves()) assertShellLeaf(entry);
});

const shell = join(root, 'src/client/shell');
const composition = join(shell, 'App.tsx');
const adapter = join(shell, 'runtime-adapter.ts');
function shellLeaves() {
  return productionFiles(shell).filter(
    (file) => file !== composition && file !== adapter,
  );
}
function assertShellLeaf(entry: string, overrides = new Map<string, string>()) {
  const forbidden = [
    composition,
    adapter,
    ...[
      'src/client/runtime.ts',
      'src/client/network.ts',
      'src/client/motion.ts',
      'src/client/GameCanvas.tsx',
      'src/client/engine',
      'src/client/minigames',
      'src/core/session.ts',
      'src/core/pointer.ts',
      'src/client/devtools',
      'src/client/devtools/motion-lab/MotionLab.tsx',
      'src/experiments',
      'server',
      'src/client/devtools/designer',
      'src/client/devtools/gallery',
      'src/client/devtools/preview',
    ].map((path) => join(root, path)),
  ];
  for (const file of dependencies(entry, true, overrides)) {
    assert.ok(
      !forbidden.some((path) => within(file, path)),
      `${relative(root, entry)} reaches implementation: ${relative(root, file)}`,
    );
    for (const edge of imports(file, overrides.get(file)))
      assert.ok(
        !/^(?:node:|ws$)/.test(edge.specifier),
        `${relative(root, entry)} reaches server package ${edge.specifier}`,
      );
  }
}

void test('shell boundary rejects direct, type-only, alias, re-export and dynamic escapes including through helper modules', () => {
  const entry = join(shell, 'RoomScreen.tsx'),
    helper = join(shell, 'standings.ts');
  for (const source of [
    "import { Runtime } from '../runtime.ts';",
    "import type { Runtime } from '../runtime.ts';",
    "type R = import('../runtime.ts').Runtime;",
    "export { Runtime } from '@/src/client/runtime.ts';",
    "export * from '../network.ts';",
    "const lazy = () => import('../motion.ts');",
    "import './runtime-adapter.ts';",
    "export { default } from './App.tsx';",
    "import { games } from '../minigames/catalog.ts';",
    "import '../devtools/motion-lab/MotionLab.tsx';",
  ]) {
    assert.throws(
      () => assertShellLeaf(entry, new Map([[entry, source]])),
      /reaches implementation/,
    );
    assert.throws(
      () =>
        assertShellLeaf(
          entry,
          new Map([
            [entry, "export * from './standings.ts';"],
            [helper, source],
          ]),
        ),
      /reaches implementation/,
    );
  }
  assert.throws(
    () =>
      assertShellLeaf(
        entry,
        new Map([[entry, 'const load = (path: string) => import(path);']]),
      ),
    /opaque dynamic import/,
  );
});

void test('shell contracts cannot acquire implementations and the runtime bridge stays headless', () => {
  const ports = join(shell, 'ports.ts');
  const source = ts.createSourceFile(
    ports,
    readFileSync(ports, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
  );
  assert.ok(
    source.statements.every(
      (statement) =>
        ts.isImportDeclaration(statement) ||
        ts.isExportDeclaration(statement) ||
        ts.isInterfaceDeclaration(statement) ||
        ts.isTypeAliasDeclaration(statement),
    ),
  );
  assert.ok(
    !/\b(?:Runtime|RuntimeView|Network|Message)\b/.test(
      readFileSync(ports, 'utf8'),
    ),
  );
  for (const edge of imports(adapter)) {
    if (edge.resolved && within(edge.resolved, shell))
      assert.ok(
        edge.resolved === join(shell, 'standings.ts') ||
          (edge.resolved === ports && edge.typeOnly),
      );
  }
  for (const file of dependencies(adapter, true)) {
    assert.ok(
      !file.endsWith('.tsx'),
      `runtime adapter imports UI: ${relative(root, file)}`,
    );
    for (const edge of imports(file))
      assert.ok(!/^(?:react|next|vinext)(?:\/|$)/.test(edge.specifier));
  }
});

void test('engine, screen, controls and backend cannot depend back on the shell; moved files have no forwards', () => {
  const entries = [
    ...[
      'src/client/engine',
      'src/client/game-screen',
      'src/client/controls',
      'server',
    ].flatMap((path) => productionFiles(join(root, path))),
    ...[
      'src/client/runtime.ts',
      'src/client/network.ts',
      'src/client/motion.ts',
      'src/client/GameCanvas.tsx',
      'src/core/session.ts',
    ].map((path) => join(root, path)),
  ].filter(
    (file) =>
      ![
        'src/client/devtools/designer',
        'src/client/devtools/gallery',
        'src/client/devtools/preview',
      ].some((path) => within(file, join(root, path))),
  );
  for (const entry of entries)
    for (const file of dependencies(entry, true))
      assert.ok(
        !within(file, shell),
        `${relative(root, entry)} imports shell: ${relative(root, file)}`,
      );
  for (const old of [
    'App.tsx',
    'ControllerMenu.tsx',
    'Widgets.tsx',
    'standings.ts',
    'extensions.ts',
  ])
    assert.equal(
      existsSync(join(root, 'src/client', old)),
      false,
      `${old} must not remain as a compatibility forward`,
    );
});

function assertShellComposition(sourceText?: string) {
  const allowed = [
    'runtime-adapter.ts',
    'JoinScreen.tsx',
    'ConnectedShell.tsx',
    'extensions.ts',
    'ports.ts',
  ].map((file) => join(shell, file));
  allowed.push(join(root, 'src/client/GameCanvas.tsx'), catalog);
  for (const edge of imports(composition, sourceText))
    assert.ok(
      edge.specifier === 'react' ||
        (edge.resolved && allowed.includes(edge.resolved)),
      `composition bypasses its adapter: ${edge.specifier}`,
    );
}
void test('shell composition can assemble catalog, screen and ports but cannot bypass the runtime adapter', () => {
  assertShellComposition();
  for (const source of [
    "import { Runtime } from '../runtime.ts';",
    "import type { Runtime } from '../runtime.ts';",
    "export * from '@/src/core/session.ts';",
    "const load = () => import('../network.ts');",
    "import '../motion.ts';",
    "export * from '../devtools/DevelopmentApp.tsx';",
  ])
    assert.throws(() => assertShellComposition(source), /composition bypasses/);
});

const devtools = join(root, 'src/client/devtools');
function assertNoDeveloperDependencies(
  entry: string,
  overrides = new Map<string, string>(),
) {
  for (const file of dependencies(entry, true, overrides))
    assert.ok(
      !within(file, devtools),
      `${relative(root, entry)} reaches developer tools: ${relative(root, file)}`,
    );
}
void test('all production source graphs exclude developer tools, including erased type edges', () => {
  const entries = ['src', 'app', 'server']
    .flatMap((directory) => productionFiles(join(root, directory)))
    .filter(
      (file) => !within(file, devtools) && !within(file, join(root, 'app/dev')),
    );
  assert.ok(
    productionFiles(devtools).length > 10,
    'the relocated tool graph is present',
  );
  for (const entry of entries) assertNoDeveloperDependencies(entry);
  for (const old of [
    'src/devtools',
    'src/controls',
    'src/layouts',
    'src/experiments/architecture',
    'src/client/controls/designer',
    'src/client/controls/gallery',
    'src/client/controls/preview',
    'src/client/MotionLab.tsx',
  ])
    assert.equal(
      existsSync(join(root, old)),
      false,
      `${old} must not remain as a compatibility forward`,
    );
});
void test('production tool exclusion rejects import forms and transitive helpers at the new paths', () => {
  const entry = join(root, 'src/client/network.ts');
  const helper = join(root, 'src/core/timing.ts');
  for (const injected of [
    "import './devtools/routing.ts';",
    "import type { HarnessOptions } from './devtools/game-harness/harness.ts';",
    "type T = import('./devtools/game-harness/harness.ts').HarnessOptions;",
    "export * from '@/src/client/devtools/routing.ts';",
    "const lazy = () => import('./devtools/routing.ts');",
  ]) {
    assert.throws(
      () => assertNoDeveloperDependencies(entry, new Map([[entry, injected]])),
      /reaches developer tools/,
    );
    assert.throws(
      () =>
        assertNoDeveloperDependencies(
          entry,
          new Map([
            [entry, "export * from '../core/timing.ts';"],
            [helper, injected.replaceAll('./devtools/', '../client/devtools/')],
          ]),
        ),
      /reaches developer tools/,
    );
  }
});
