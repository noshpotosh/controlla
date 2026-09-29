import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { builtinModules } from 'node:module';
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
const minigames = join(root, 'src/client/minigames');
/** Every shipped game owns one folder under minigames/. */
const gameDirectories = readdirSync(minigames, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => join(minigames, entry.name));
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
  /** A literal `import()` call, which bundlers split into a lazy chunk. */
  dynamic?: boolean;
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
  const add = (specifier: string, typeOnly: boolean, dynamic = false) => {
    result.push({
      specifier,
      typeOnly,
      ...(dynamic && { dynamic }),
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
      add(
        specifier.text,
        false,
        node.expression.kind === ts.SyntaxKind.ImportKeyword,
      );
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  if (sourceText === undefined) edgeCache.set(file, result);
  return result;
}

/** A game folder's `stage/` modules, loaded only through a literal `import()`. */
function stageDirectory(file: string): string | undefined {
  const game = gameDirectories.find((directory) => within(file, directory));
  return game && join(game, 'stage');
}
function lazyStage(file: string, edge: ImportEdge): boolean {
  const stage = stageDirectory(file);
  return (
    !!edge.dynamic &&
    !!stage &&
    !!edge.resolved &&
    within(edge.resolved, stage) &&
    !within(file, stage)
  );
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
    assert.ok(
      existsSync(file),
      `Missing graph target: ${relative(root, file)}`,
    );
    if (!isSource(file)) continue;
    for (const edge of imports(file, overrides.get(file))) {
      if (edge.typeOnly && !includeTypes) continue;
      // A game's lazily loaded 3D stage is outside every eager graph.
      if (lazyStage(file, edge)) continue;
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

const shared = join(root, 'src/shared');
const backend = join(root, 'server');
const nodeModules = new Set(
  builtinModules.flatMap((name) => [name, `node:${name}`]),
);

function assertSharedBoundary(
  entry: string,
  overrides = new Map<string, string>(),
) {
  for (const file of dependencies(entry, true, overrides)) {
    assert.ok(
      within(file, shared),
      `shared contract reaches implementation: ${relative(root, file)}`,
    );
    for (const edge of imports(file, overrides.get(file)))
      assert.ok(
        edge.resolved && within(edge.resolved, shared),
        `shared contract imports outside shared: ${edge.specifier}`,
      );
  }
}

function assertBackendBoundary(
  entry: string,
  overrides = new Map<string, string>(),
) {
  for (const file of dependencies(entry, true, overrides)) {
    assert.ok(
      within(file, backend) || within(file, shared),
      `backend reaches implementation: ${relative(root, file)}`,
    );
    if (within(file, shared)) {
      assertSharedBoundary(file, overrides);
      continue;
    }
    for (const edge of imports(file, overrides.get(file)))
      assert.ok(
        nodeModules.has(edge.specifier) ||
          edge.specifier === 'ws' ||
          (edge.resolved &&
            (within(edge.resolved, backend) || within(edge.resolved, shared))),
        `backend imports outside its boundary: ${edge.specifier}`,
      );
  }
}

void test('backend and shared contracts have independent implementation boundaries', () => {
  for (const entry of productionFiles(shared)) assertSharedBoundary(entry);
  for (const entry of productionFiles(backend)) assertBackendBoundary(entry);
  assert.equal(existsSync(join(root, 'src/core/app-protocol.ts')), false);
});

const engine = join(root, 'src/client/engine');
const engineForbidden = [
  'src/client/shell',
  'src/client/runtime',
  'src/client/transport',
  'src/client/controls/motion/processor.ts',
  'src/client/GameCanvas.tsx',
  'src/client/game-screen',
  'src/client/devtools',
  'src/client/controls/motion/pointer.ts',
  'src/client/controls/motion/anchor.ts',
  'src/client/controls/motion/heading.ts',
  'src/client/controls/motion/chop.ts',
  'src/client/controls/motion/calibration.ts',
  'src/client/controls/motion/provider.ts',
  'server',
].map((path) => join(root, path));

function assertEngineBoundary(
  entry: string,
  overrides = new Map<string, string>(),
) {
  for (const path of engineForbidden) assert.ok(existsSync(path));
  const iconVocabulary = join(root, 'src/client/controls/kit/icons.ts');
  for (const file of dependencies(entry, true, overrides)) {
    assert.ok(
      !engineForbidden.some((path) => within(file, path)) &&
        !file.endsWith('.tsx'),
      `engine reaches implementation outside its boundary: ${relative(root, file)}`,
    );
    for (const edge of imports(file, overrides.get(file)))
      assert.ok(
        edge.resolved &&
          ((within(edge.resolved, root) &&
            !edge.resolved.includes(`${sep}node_modules${sep}`)) ||
            (file === iconVocabulary && edge.specifier === 'lucide-react')),
        `engine imports an unresolved or external dependency: ${edge.specifier}`,
      );
  }
  // Controller definitions reference IconName through an erased import. Its
  // existing UI owner may be inspected above, but must never execute here.
  for (const file of dependencies(entry, false, overrides)) {
    assert.notEqual(file, iconVocabulary, 'engine executes controller icon UI');
    for (const edge of imports(file, overrides.get(file)).filter(
      (edge) => !edge.typeOnly,
    ))
      assert.ok(
        edge.resolved &&
          within(edge.resolved, root) &&
          !edge.resolved.includes(`${sep}node_modules${sep}`),
        `engine executes an external dependency: ${edge.specifier}`,
      );
  }
}

void test('engine owns headless session, input, timing and replication without browser orchestration', () => {
  for (const entry of productionFiles(engine)) assertEngineBoundary(entry);
  for (const file of dependencies(api, true))
    assert.ok(
      !within(file, engine),
      'author contracts must not reach engine internals',
    );
});

void test('engine boundary rejects erased, indirect, dynamic and unresolved dependency leaks', () => {
  const entry = join(engine, 'session.ts');
  const helper = join(engine, 'timing.ts');
  for (const source of [
    "import '@/src/client/runtime/playback/display-playback.ts';",
    "import { Runtime } from '@/src/client/runtime/runtime.ts';",
    "import type { Network } from '@/src/client/transport/network.ts';",
    "type M = import('@/src/client/controls/motion/provider.ts').Motion;",
    "export * from '@/src/client/shell/runtime-adapter.ts';",
    "const load = () => import('@/src/client/devtools/routing.ts');",
    "const load = () => require('@/server/rooms.ts');",
    "export * from '@/src/client/controls/motion/pointer.ts';",
    "import type { ReactNode } from 'react';",
    "import { ICONS } from '@/src/client/controls/kit/icons.ts';",
    "import type { Missing } from './missing-contract.ts';",
    'const load = (path: string) => import(path);',
  ]) {
    assert.throws(() =>
      assertEngineBoundary(entry, new Map([[entry, source]])),
    );
    assert.throws(() =>
      assertEngineBoundary(
        entry,
        new Map([
          [entry, "export * from './timing.ts';"],
          [helper, source],
        ]),
      ),
    );
  }
});

void test('engine relocation removes old modules and leaves only general geometry primitives in core types', () => {
  for (const name of [
    'session',
    'protocol',
    'reliable-input',
    'timing',
    'arbitration',
    'snapshots',
  ]) {
    assert.equal(existsSync(join(root, 'src/core', `${name}.ts`)), false);
    assert.ok(
      existsSync(
        join(engine, `${name === 'snapshots' ? 'replication' : name}.ts`),
      ),
    );
  }
  const file = join(root, 'src/core/types.ts');
  assert.deepEqual(imports(file), []);
  const source = ts.createSourceFile(
    file,
    readFileSync(file, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
  );
  assert.deepEqual(
    source.statements
      .map((statement) => {
        if (ts.isTypeAliasDeclaration(statement)) return statement.name.text;
        if (ts.isVariableStatement(statement))
          return statement.declarationList.declarations[0].name.getText(source);
        return ts.SyntaxKind[statement.kind];
      })
      .sort(),
    ['Point', 'clamp'],
  );
  const messages = ts.createSourceFile(
    'messages.ts',
    readFileSync(join(engine, 'messages.ts'), 'utf8'),
    ts.ScriptTarget.Latest,
    true,
  );
  assert.ok(messages.statements.every(ts.isTypeAliasDeclaration));
});

void test('shared and backend boundaries reject erased, indirect and dynamic dependency leaks', () => {
  const room = join(shared, 'room.ts');
  const protocol = join(shared, 'app-protocol.ts');
  const server = join(backend, 'index.ts');
  const rooms = join(backend, 'rooms.ts');
  const leaks = [
    "import { Runtime } from '@/src/client/runtime/runtime.ts';",
    "import type { Capabilities } from '@/src/client/controls/api.ts';",
    "type Capabilities = import('@/src/client/controls/api.ts').Capabilities;",
    "export type { Player } from '@/src/client/api/index.ts';",
    "export * from '@/src/core/types.ts';",
    "export * from '@/src/client/engine/session.ts';",
    "import type { Message } from '@/src/client/engine/messages.ts';",
    "const load = () => import('@/src/client/transport/network.ts');",
    "const load = () => require('@/src/client/transport/network.ts');",
    'const load = (path: string) => import(path);',
    "import type { Missing } from './missing-contract.ts';",
  ];
  for (const source of leaks) {
    assert.throws(() => assertSharedBoundary(room, new Map([[room, source]])));
    assert.throws(() =>
      assertSharedBoundary(
        protocol,
        new Map([
          [protocol, "export * from './room.ts';"],
          [room, source],
        ]),
      ),
    );
    assert.throws(() =>
      assertBackendBoundary(rooms, new Map([[rooms, source]])),
    );
    assert.throws(() =>
      assertBackendBoundary(server, new Map([[rooms, source]])),
    );
    assert.throws(() =>
      assertBackendBoundary(server, new Map([[room, source]])),
    );
  }
  for (const source of [
    "import { createHmac } from 'node:crypto';",
    "import type { ReactNode } from 'react';",
    "export { RoomRegistry } from '@/server/rooms.ts';",
  ])
    assert.throws(() => assertSharedBoundary(room, new Map([[room, source]])));
});

void test('shared contracts compile with ECMAScript alone, without DOM or Node ambient types', () => {
  const compileOptions: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    lib: ['lib.es2022.d.ts'],
    types: [],
    strict: true,
    noEmit: true,
    allowImportingTsExtensions: true,
  };
  const entries = productionFiles(shared);
  const diagnostics = (extra = '') => {
    const host = ts.createCompilerHost(compileOptions);
    const read = host.readFile.bind(host);
    host.readFile = (file) => {
      const content = read(file);
      return file === join(shared, 'room.ts') && content !== undefined
        ? content + extra
        : content;
    };
    return ts.getPreEmitDiagnostics(
      ts.createProgram(entries, compileOptions, host),
    );
  };
  assert.deepEqual(
    diagnostics().map((item) =>
      ts.flattenDiagnosticMessageText(item.messageText, '\n'),
    ),
    [],
  );
  for (const source of [
    '\nwindow.location;',
    '\nprocess.pid;',
    '\nlet node: HTMLElement;',
  ])
    assert.ok(
      diagnostics(source).length > 0,
      'platform ambient dependencies must fail',
    );
});

/** three and its example modules, the only package a game's lazy stage may load. */
const threeSpecifier = /^three(?:\/(?:examples\/jsm|addons)\/.+)?$/;

/** A game module's import is inside its boundary, returning a reason when it is not. */
function gameEdgeProblem(
  directory: string,
  file: string,
  edge: ImportEdge,
): string | null {
  const stage = join(directory, 'stage');
  if (within(file, stage) && threeSpecifier.test(edge.specifier)) return null;
  if (!edge.resolved) return `${edge.specifier} is unresolved`;
  if (edge.resolved === api) return null;
  if (!within(edge.resolved, directory))
    return `${edge.specifier} is outside the author boundary`;
  if (
    within(edge.resolved, stage) &&
    !within(file, stage) &&
    !lazyStage(file, edge)
  )
    return `${edge.specifier} loads the 3D stage eagerly; use a literal import()`;
  return null;
}

void test('game production modules import only their own folder or the author API', () => {
  assert.ok(gameDirectories.length >= 2, 'every shipped game has a folder');
  for (const directory of gameDirectories) {
    const files = productionFiles(directory);
    assert.ok(files.length >= 3, 'descriptor, game and renderer are present');
    for (const file of files)
      for (const edge of imports(file)) {
        const problem = gameEdgeProblem(directory, file, edge);
        assert.equal(problem, null, `${relative(root, file)}: ${problem}`);
      }
    const runtime = dependencies(join(directory, 'index.ts'));
    assert.ok(
      [...runtime].every((file) => within(file, directory) || file === api),
    );
    assert.ok(
      ![...dependencies(join(directory, 'index.ts'), true)].some((file) =>
        within(file, join(directory, 'stage')),
      ),
      'the eager game graph never reaches its 3D stage',
    );
  }
  assert.equal(
    imports(api).filter((edge) => !edge.typeOnly).length,
    0,
    'the author API has no runtime imports',
  );
});

void test('a lazy 3D stage keeps three out of the engine and the eager game', () => {
  const game = join(minigames, 'whack-a-mole'),
    renderer = join(game, 'renderer.ts'),
    stage = join(game, 'stage', 'stage.ts');
  assert.ok(existsSync(stage), 'Whack-a-Mole ships a lazy stage');
  assert.ok(
    imports(renderer).some((edge) => lazyStage(renderer, edge)),
    'the renderer loads its stage with a literal import()',
  );
  assert.ok(
    imports(stage).some((edge) => edge.specifier === 'three'),
    'the stage owns the three dependency',
  );
  const session = join(engine, 'session.ts');
  assert.doesNotThrow(() => assertEngineBoundary(session));
  for (const source of [
    "import * as THREE from 'three';",
    "import type { Mesh } from 'three';",
    "const load = () => import('three');",
    "export * from './stage/models.ts';",
    "import type { Kit } from './stage/models.ts';",
  ]) {
    const overrides = new Map([[renderer, source]]);
    assert.throws(
      () => assertEngineBoundary(session, overrides),
      /engine/,
      `renderer override stays rejected: ${source}`,
    );
  }
  // Only stage modules may name three, and only three among packages.
  const stray = join(game, 'model.ts');
  assert.match(
    gameEdgeProblem(game, stray, {
      specifier: 'three',
      typeOnly: false,
    }) ?? '',
    /unresolved|outside/,
  );
  assert.match(
    gameEdgeProblem(game, stage, {
      specifier: 'react',
      typeOnly: false,
      resolved: join(root, 'node_modules/react/index.js'),
    }) ?? '',
    /outside/,
  );
});

void test('the catalog is the only production module that imports a game', () => {
  const sources = [
    ...productionFiles(join(root, 'src')),
    ...productionFiles(join(root, 'app')),
  ];
  for (const directory of gameDirectories) {
    const incoming = sources
      .filter((file) => !within(file, directory) && !within(file, harness))
      .flatMap((file) =>
        imports(file)
          .filter((edge) => edge.resolved && within(edge.resolved, directory))
          .map(() => file),
      );
    assert.deepEqual(incoming, [catalog], relative(root, directory));
  }
  assert.equal(new Set(games.map((game) => game.id)).size, games.length);
  assert.equal(games.filter((game) => game.id === neonHarvest.id).length, 1);
  assert.ok(
    games.includes(neonHarvest),
    'registration retains descriptor identity',
  );
});

void test('game and harness dependency graphs stay outside shell, network ownership and tooling', () => {
  const forbidden = [
    'src/client/shell',
    'src/client/runtime/playback',
    'src/client/runtime/runtime.ts',
    'server',
    'src/client/devtools/motion-lab',
    'src/client/devtools/designer',
    'src/client/devtools/gallery',
    'src/client/devtools/preview',
  ].map((path) => join(root, path));
  const entries = [
    join(harness, 'harness.ts'),
    ...gameDirectories.map((directory) => join(directory, 'index.ts')),
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
          'localPressing',
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

function assertScreenBoundary(overrides = new Map<string, string>()) {
  const screenDirectory = join(root, 'src/client/game-screen');
  const canvas = join(root, 'src/client/GameCanvas.tsx');
  const forbidden = [
    'src/client/runtime/playback',
    'src/client/runtime/runtime.ts',
    'src/client/transport/network.ts',
    'src/client/engine/session.ts',
    'src/client/engine/round.ts',
    'src/client/engine/progress.ts',
    'src/client/engine/history.ts',
    'src/client/shell',
    'src/client/devtools',
    'src/experiments',
    'server',
  ].map((path) => join(root, path));
  assert.ok(existsSync(join(engine, 'session.ts')));
  for (const entry of [canvas, ...productionFiles(screenDirectory)]) {
    for (const file of dependencies(entry, true, overrides)) {
      assert.ok(
        !forbidden.some((path) => within(file, path)),
        `${relative(root, entry)} reaches authority or a broad runtime: ${relative(root, file)}`,
      );
    }
  }
  for (const file of productionFiles(screenDirectory)) {
    for (const edge of imports(file, overrides.get(file))) {
      assert.ok(
        edge.resolved &&
          (within(edge.resolved, screenDirectory) ||
            (edge.resolved === api && edge.typeOnly)),
        `${relative(root, file)} imports outside the screen contract: ${edge.specifier}`,
      );
    }
  }
}

void test('the production canvas and game screen can read presentation but cannot reach session authority or progress mutation', () => {
  assertScreenBoundary();
  const screenDirectory = join(root, 'src/client/game-screen');
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
    'src/shared/room.ts',
    'src/client/controls/api.ts',
    'src/core/types.ts',
    'src/client/controls/motion/trace.ts',
    'src/client/controls/motion/contracts.ts',
    'src/client/game-screen/port.ts',
  ].map((path) => join(root, path));
  for (const edge of imports(ports))
    assert.ok(
      edge.typeOnly && allowed.includes(edge.resolved!),
      `shell contract imports implementation: ${edge.specifier}`,
    );
  for (const entry of shellLeaves()) assertShellLeaf(entry);
});

void test('screen boundary rejects relocated authority through direct and indirect erased imports', () => {
  const canvas = join(root, 'src/client/GameCanvas.tsx');
  const helper = join(root, 'src/client/game-screen/presenter.ts');
  for (const source of [
    "import { SessionAuthority } from '@/src/client/engine/session.ts';",
    "import type { SessionPorts } from '@/src/client/engine/session.ts';",
    "type S = import('@/src/client/engine/session.ts').SessionAuthority;",
    "export * from '@/src/client/engine/session.ts';",
    "const load = () => import('@/src/client/engine/session.ts');",
  ]) {
    assert.throws(
      () => assertScreenBoundary(new Map([[canvas, source]])),
      /reaches authority/,
    );
    assert.throws(
      () =>
        assertScreenBoundary(
          new Map([
            [canvas, "export * from './game-screen/presenter.ts';"],
            [helper, source],
          ]),
        ),
      /reaches authority/,
    );
  }
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
      'src/client/runtime',
      'src/client/transport',
      'src/client/controls/motion/processor.ts',
      'src/client/controls/motion/provider.ts',
      'src/client/GameCanvas.tsx',
      'src/client/engine',
      'src/client/minigames',
      'src/client/controls/motion/pointer.ts',
      'src/client/controls/motion/chop.ts',
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
    "import '@/src/client/runtime/playback/display-playback.ts';",
    "import { Runtime } from '@/src/client/runtime/runtime.ts';",
    "import type { Runtime } from '@/src/client/runtime/runtime.ts';",
    "type R = import('@/src/client/runtime/runtime.ts').Runtime;",
    "export { Runtime } from '@/src/client/runtime/runtime.ts';",
    "export * from '@/src/client/transport/network.ts';",
    "const lazy = () => import('@/src/client/controls/motion/provider.ts');",
    "import './runtime-adapter.ts';",
    "export { default } from './App.tsx';",
    "import { games } from '@/src/client/minigames/catalog.ts';",
    "import '@/src/client/devtools/motion-lab/MotionLab.tsx';",
    "import type { SessionAuthority } from '@/src/client/engine/session.ts';",
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
      'src/client/runtime/playback',
      'src/client/game-screen',
      'src/client/controls',
      'server',
    ].flatMap((path) => productionFiles(join(root, path))),
    ...[
      'src/client/runtime/runtime.ts',
      'src/client/transport/network.ts',
      'src/client/controls/motion/processor.ts',
      'src/client/controls/motion/provider.ts',
      'src/client/GameCanvas.tsx',
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
    "import '@/src/client/runtime/playback/display-playback.ts';",
    "import { Runtime } from '@/src/client/runtime/runtime.ts';",
    "import type { Runtime } from '@/src/client/runtime/runtime.ts';",
    "export * from '@/src/client/engine/session.ts';",
    "const load = () => import('@/src/client/transport/network.ts');",
    "import '@/src/client/controls/motion/provider.ts';",
    "export * from '@/src/client/devtools/DevelopmentApp.tsx';",
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
  const entry = join(root, 'src/client/transport/network.ts');
  const helper = join(root, 'src/client/engine/timing.ts');
  for (const injected of [
    "import '@/src/client/devtools/routing.ts';",
    "import type { HarnessOptions } from '@/src/client/devtools/game-harness/harness.ts';",
    "type T = import('@/src/client/devtools/game-harness/harness.ts').HarnessOptions;",
    "export * from '@/src/client/devtools/routing.ts';",
    "const lazy = () => import('@/src/client/devtools/routing.ts');",
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
            [entry, "export * from '@/src/client/engine/timing.ts';"],
            [helper, injected],
          ]),
        ),
      /reaches developer tools/,
    );
  }
});

const motionDirectory = join(root, 'src/client/controls/motion');
function assertMotionBoundary(
  entry: string,
  overrides = new Map<string, string>(),
) {
  for (const file of dependencies(entry, true, overrides)) {
    assert.ok(
      within(file, motionDirectory) ||
        file === join(root, 'src/client/controls/api.ts') ||
        file === join(root, 'src/core/types.ts'),
      `motion reaches outside its boundary: ${relative(root, file)}`,
    );
    for (const edge of imports(file, overrides.get(file)))
      assert.ok(
        edge.resolved &&
          (within(edge.resolved, motionDirectory) ||
            edge.resolved === join(root, 'src/client/controls/api.ts') ||
            edge.resolved === join(root, 'src/core/types.ts')),
        `motion dependency escapes: ${edge.specifier}`,
      );
  }
}
void test('motion provider and processing stay independent of runtime, transport, engine and UI', () => {
  for (const entry of productionFiles(motionDirectory))
    assertMotionBoundary(entry);
  for (const path of [
    'src/client/motion.ts',
    'src/core/pointer.ts',
    'src/core/calibration.ts',
    'src/core/motion/trace.ts',
  ])
    assert.equal(existsSync(join(root, path)), false);
});
void test('motion boundary rejects direct, erased, indirect, dynamic and external leaks', () => {
  const entry = join(motionDirectory, 'provider.ts');
  const helper = join(motionDirectory, 'processor.ts');
  for (const leak of [
    "import type { Runtime } from '@/src/client/runtime/runtime.ts';",
    "type N = import('@/src/client/transport/network.ts').Network;",
    "export * from '@/src/client/engine/session.ts';",
    "const load = () => import('@/src/client/devtools/routing.ts');",
    "import 'react';",
    "import './missing.ts';",
    'const load = (path: string) => import(path);',
  ]) {
    assert.throws(() => assertMotionBoundary(entry, new Map([[entry, leak]])));
    assert.throws(() =>
      assertMotionBoundary(
        entry,
        new Map([
          [entry, "export * from './processor.ts';"],
          [helper, leak],
        ]),
      ),
    );
  }
});

const playbackDirectory = join(root, 'src/client/runtime/playback');
function assertPlaybackBoundary(overrides = new Map<string, string>()) {
  const allowed = [
    'src/client/engine/replication.ts',
    'src/client/engine/history.ts',
    'src/client/engine/progress.ts',
    'src/client/engine/messages.ts',
    'src/client/engine/protocol.ts',
    'src/client/engine/timing.ts',
    'src/client/game-screen/port.ts',
    'src/client/game-screen/screen.ts',
    'src/client/api/index.ts',
    'src/client/controls/api.ts',
    'src/core/types.ts',
    'src/shared/room.ts',
  ].map((path) => join(root, path));
  assert.ok(existsSync(join(playbackDirectory, 'display-playback.ts')));
  for (const entry of productionFiles(playbackDirectory)) {
    for (const file of dependencies(entry, true, overrides)) {
      assert.ok(
        within(file, playbackDirectory) || allowed.includes(file),
        `playback reaches outside its boundary: ${relative(root, file)}`,
      );
      for (const edge of imports(file, overrides.get(file)))
        assert.ok(
          edge.resolved &&
            (within(edge.resolved, playbackDirectory) ||
              allowed.includes(edge.resolved)),
          `playback dependency escapes: ${edge.specifier}`,
        );
    }
  }
}
void test('display playback only reaches its explicit replication and presentation dependencies', () => {
  assertPlaybackBoundary();
});
void test('playback rejects direct, erased, indirect, opaque and external dependency escapes', () => {
  const entry = join(playbackDirectory, 'display-playback.ts');
  const helper = join(root, 'src/client/engine/timing.ts');
  for (const source of [
    "import '@/src/client/runtime/runtime.ts';",
    "import type { Network } from '@/src/client/transport/network.ts';",
    "type Authority = import('@/src/client/engine/session.ts').SessionAuthority;",
    "export * from '@/src/client/shell/ports.ts';",
    "const control = () => import('@/src/client/controls/motion/provider.ts');",
    "require('@/src/client/devtools/routing.ts');",
    "import '@/server/rooms.ts';",
    "import 'react';",
    "import './missing.ts';",
    'import(variable);',
  ]) {
    assert.throws(
      () => assertPlaybackBoundary(new Map([[entry, source]])),
      /playback|opaque/,
    );
    assert.throws(
      () =>
        assertPlaybackBoundary(
          new Map([
            [entry, "export * from '@/src/client/engine/timing.ts';"],
            [helper, source],
          ]),
        ),
      /playback|opaque/,
    );
  }
});

const controllerInputDirectory = join(
  root,
  'src/client/runtime/controller-input',
);
function assertControllerInputBoundary(overrides = new Map<string, string>()) {
  const allowed = [
    'src/client/controls/api.ts',
    'src/client/controls/registry.ts',
    'src/client/controls/value.ts',
    'src/client/controls/layout/rotation.ts',
    'src/client/controls/motion/contracts.ts',
    'src/client/controls/motion/pointer.ts',
    'src/client/controls/motion/anchor.ts',
    'src/client/controls/motion/calibration.ts',
    'src/client/controls/motion/chop.ts',
    'src/client/controls/kit/icons.ts',
    'src/client/engine/protocol.ts',
    'src/client/engine/reliable-input.ts',
    'src/core/types.ts',
    ...['button', 'dpad', 'stick', 'aim-pad', 'swipe-pad', 'hold-meter'].map(
      (name) => `src/client/controls/${name}/definition.ts`,
    ),
  ].map((path) => join(root, path));
  const icons = join(root, 'src/client/controls/kit/icons.ts');
  assert.ok(existsSync(join(controllerInputDirectory, 'controller-input.ts')));
  for (const entry of productionFiles(controllerInputDirectory)) {
    for (const file of dependencies(entry, true, overrides)) {
      assert.ok(
        within(file, controllerInputDirectory) || allowed.includes(file),
        `controller input escapes: ${relative(root, file)}`,
      );
      for (const edge of imports(file, overrides.get(file)))
        assert.ok(
          edge.resolved &&
            (within(edge.resolved, controllerInputDirectory) ||
              allowed.includes(edge.resolved) ||
              (file === icons && edge.specifier === 'lucide-react')),
          `controller input dependency escapes: ${edge.specifier}`,
        );
    }
    for (const file of dependencies(entry, false, overrides)) {
      assert.notEqual(file, icons, 'controller input executes icon UI');
      for (const edge of imports(file, overrides.get(file)).filter(
        (edge) => !edge.typeOnly,
      ))
        assert.ok(
          edge.resolved &&
            (within(edge.resolved, controllerInputDirectory) ||
              allowed.includes(edge.resolved)),
          `controller input executes external code: ${edge.specifier}`,
        );
    }
  }
}
function assertControllerInputConsumers(overrides = new Map<string, string>()) {
  for (const entry of [
    ...productionFiles(join(root, 'src')),
    ...productionFiles(join(root, 'server')),
  ]) {
    if (
      within(entry, controllerInputDirectory) ||
      entry === join(root, 'src/client/runtime/runtime.ts')
    )
      continue;
    for (const edge of imports(entry, overrides.get(entry)))
      assert.ok(
        !edge.resolved || !within(edge.resolved, controllerInputDirectory),
        `controller input consumer is not composition: ${relative(root, entry)}`,
      );
  }
}
void test('controller input has explicit headless dependencies and composition-only consumers', () => {
  assertControllerInputBoundary();
  assertControllerInputConsumers();
});
void test('controller input rejects erased, indirect, dynamic, external and browser provider escapes', () => {
  const entry = join(controllerInputDirectory, 'controller-input.ts');
  const helper = join(root, 'src/client/controls/value.ts');
  for (const source of [
    "import '@/src/client/runtime/runtime.ts';",
    "import type { Network } from '@/src/client/transport/network.ts';",
    "type Authority = import('@/src/client/engine/session.ts').SessionAuthority;",
    "export * from '@/src/client/shell/ports.ts';",
    "const provider = () => import('@/src/client/controls/motion/provider.ts');",
    "import '@/src/client/runtime/playback/display-playback.ts';",
    "import '@/src/client/minigames/catalog.ts';",
    "require('@/src/client/devtools/routing.ts');",
    "import '@/server/rooms.ts';",
    "import 'react';",
    "import './missing.ts';",
    'import(variable);',
    "import '@/src/client/controls/kit/icons.ts';",
  ]) {
    assert.throws(
      () => assertControllerInputBoundary(new Map([[entry, source]])),
      /controller input|opaque/,
    );
    assert.throws(
      () =>
        assertControllerInputBoundary(
          new Map([
            [entry, "export * from '@/src/client/controls/value.ts';"],
            [helper, source],
          ]),
        ),
      /controller input|opaque/,
    );
  }
  for (const path of [
    'src/client/engine/input.ts',
    'src/client/shell/ports.ts',
    'src/client/game-screen/port.ts',
    'src/client/controls/api.ts',
    'src/client/transport/network.ts',
    'server/rooms.ts',
  ]) {
    const entry = join(root, path);
    assert.throws(
      () =>
        assertControllerInputConsumers(
          new Map([
            [
              entry,
              "export type { ControllerInput } from '@/src/client/runtime/controller-input/controller-input.ts';",
            ],
          ]),
        ),
      /composition/,
    );
  }
});

const sessionRoutingDirectory = join(
  root,
  'src/client/runtime/session-routing',
);
function assertSessionRoutingBoundary(overrides = new Map<string, string>()) {
  const allowed = [
    'src/client/runtime/cursor-contracts.ts',
    'src/shared/room.ts',
    'src/core/types.ts',
    'src/client/engine/messages.ts',
    'src/client/engine/protocol.ts',
  ].map((path) => join(root, path));
  assert.ok(existsSync(join(sessionRoutingDirectory, 'session-router.ts')));
  for (const entry of productionFiles(sessionRoutingDirectory)) {
    for (const file of dependencies(entry, true, overrides)) {
      assert.ok(
        within(file, sessionRoutingDirectory) || allowed.includes(file),
        `session routing escapes: ${relative(root, file)}`,
      );
      for (const edge of imports(file, overrides.get(file)))
        assert.ok(
          edge.resolved &&
            (within(edge.resolved, sessionRoutingDirectory) ||
              allowed.includes(edge.resolved)),
          `session routing dependency escapes: ${edge.specifier}`,
        );
    }
  }
}
function assertSessionRoutingConsumers(overrides = new Map<string, string>()) {
  for (const entry of [
    ...productionFiles(join(root, 'src')),
    ...productionFiles(join(root, 'server')),
  ]) {
    if (
      within(entry, sessionRoutingDirectory) ||
      entry === join(root, 'src/client/runtime/runtime.ts')
    )
      continue;
    for (const edge of imports(entry, overrides.get(entry)))
      assert.ok(
        !edge.resolved || !within(edge.resolved, sessionRoutingDirectory),
        `session routing consumer is not composition: ${relative(root, entry)}`,
      );
  }
}
void test('session routing has headless dependencies and composition-only consumers', () => {
  assertSessionRoutingBoundary();
  assertSessionRoutingConsumers();
});
void test('session routing rejects erased, transitive, alias, dynamic, external and opaque dependencies', () => {
  const entry = join(sessionRoutingDirectory, 'session-router.ts');
  const helper = join(root, 'src/client/engine/protocol.ts');
  for (const source of [
    "import '@/src/client/runtime/runtime.ts';",
    "import type { Network } from '@/src/client/transport/network.ts';",
    "type Authority = import('@/src/client/engine/session.ts').SessionAuthority;",
    "export * from '@/src/client/shell/ports.ts';",
    "const provider = () => import('@/src/client/controls/motion/provider.ts');",
    "import '@/src/client/runtime/playback/display-playback.ts';",
    "import '@/src/client/runtime/controller-input/controller-input.ts';",
    "import '@/src/client/minigames/catalog.ts';",
    "require('@/src/client/devtools/routing.ts');",
    "import '@/server/rooms.ts';",
    "import 'react';",
    "import 'node:fs';",
    "import './missing.ts';",
    'import(variable);',
  ]) {
    assert.throws(
      () => assertSessionRoutingBoundary(new Map([[entry, source]])),
      /session routing|opaque/,
    );
    assert.throws(
      () =>
        assertSessionRoutingBoundary(
          new Map([
            [entry, "export * from '@/src/client/engine/protocol.ts';"],
            [helper, source],
          ]),
        ),
      /session routing|opaque/,
    );
  }
  for (const path of [
    'src/client/engine/input.ts',
    'src/client/shell/ports.ts',
    'src/client/game-screen/port.ts',
    'src/client/controls/api.ts',
    'src/client/transport/network.ts',
    'server/rooms.ts',
    'src/client/runtime/playback/display-playback.ts',
    'src/client/runtime/controller-input/controller-input.ts',
  ]) {
    assert.throws(
      () =>
        assertSessionRoutingConsumers(
          new Map([
            [
              join(root, path),
              "export type { SessionRouter } from '@/src/client/runtime/session-routing/session-router.ts';",
            ],
          ]),
        ),
      /composition/,
    );
  }
});

function assertRuntimeServices(overrides = new Map<string, string>()) {
  const contracts = [
    'src/client/api/index.ts',
    'src/client/controls/api.ts',
    'src/shared/room.ts',
    'src/core/types.ts',
    'src/client/engine/messages.ts',
    'src/client/transport/contracts.ts',
  ].map((path) => join(root, path));
  for (const domain of ['browser', 'diagnostics']) {
    const owner = join(root, 'src/client/runtime', domain);
    for (const entry of productionFiles(owner)) {
      for (const file of dependencies(entry, true, overrides)) {
        assert.ok(
          within(file, owner) || contracts.includes(file),
          `runtime service escapes: ${relative(root, file)}`,
        );
        for (const edge of imports(file, overrides.get(file))) {
          assert.ok(
            edge.resolved &&
              (within(edge.resolved, owner) ||
                contracts.includes(edge.resolved)),
            `runtime service dependency escapes: ${edge.specifier}`,
          );
        }
      }
    }
  }
  const transport = join(root, 'src/client/transport');
  const allowed = [
    ...contracts,
    ...[
      'src/shared/app-protocol.ts',
      'src/client/engine/history.ts',
      'src/client/engine/progress.ts',
    ].map((path) => join(root, path)),
  ];
  for (const entry of productionFiles(transport)) {
    for (const file of dependencies(entry, true, overrides)) {
      assert.ok(
        within(file, transport) || allowed.includes(file),
        `transport escapes: ${relative(root, file)}`,
      );
      for (const edge of imports(file, overrides.get(file)))
        assert.ok(
          edge.resolved &&
            (within(edge.resolved, transport) ||
              allowed.includes(edge.resolved)),
          `transport dependency escapes: ${edge.specifier}`,
        );
    }
  }
}
void test('browser, diagnostics and transport enforce narrow independent dependency graphs', () => {
  assertRuntimeServices();
  for (const owner of [
    'browser/browser-resources.ts',
    'diagnostics/diagnostics.ts',
  ]) {
    const entry = join(root, 'src/client/runtime', owner);
    for (const leak of [
      "import '@/src/client/runtime/runtime.ts';",
      "import type { Network } from '@/src/client/transport/network.ts';",
      "export * from '@/src/client/runtime/controller-input/controller-input.ts';",
      "type T = import('@/src/client/runtime/playback/display-playback.ts').DisplayPlayback;",
      "const load = () => import('@/src/client/runtime/session-routing/session-router.ts');",
      "import 'react';",
      'import(variable);',
    ])
      assert.throws(
        () => assertRuntimeServices(new Map([[entry, leak]])),
        /escapes|opaque/,
      );
    assert.throws(
      () =>
        assertRuntimeServices(
          new Map([
            [entry, "export * from '@/src/client/transport/contracts.ts';"],
            [
              join(root, 'src/client/transport/contracts.ts'),
              "export * from '@/src/client/runtime/runtime.ts';",
            ],
          ]),
        ),
      /escapes/,
    );
  }
  assert.throws(
    () =>
      assertRuntimeServices(
        new Map([
          [
            join(root, 'src/client/transport/network.ts'),
            "import '@/src/client/runtime/runtime.ts';",
          ],
        ]),
      ),
    /escapes/,
  );
});
void test('runtime collaboration contracts are declarations only and obsolete owners have no forwards', () => {
  const entries = [
    'src/client/runtime/cursor-contracts.ts',
    ...[
      'browser',
      'diagnostics',
      'controller-input',
      'playback',
      'session-routing',
    ].map((owner) => `src/client/runtime/${owner}/contracts.ts`),
    'src/client/transport/contracts.ts',
  ];
  for (const path of entries) {
    const source = ts.createSourceFile(
      path,
      readFileSync(join(root, path), 'utf8'),
      ts.ScriptTarget.Latest,
      true,
    );
    for (const statement of source.statements)
      assert.ok(
        ts.isInterfaceDeclaration(statement) ||
          ts.isTypeAliasDeclaration(statement) ||
          (ts.isImportDeclaration(statement) &&
            statement.importClause?.phaseModifier ===
              ts.SyntaxKind.TypeKeyword),
        `${path} must only declare contracts`,
      );
  }
  for (const old of [
    'runtime.ts',
    'network.ts',
    'playback',
    'controller-input',
    'session-routing',
  ])
    assert.equal(existsSync(join(root, 'src/client', old)), false);
});

void test('runtime collaborators are reachable only through composition and internal contracts', () => {
  const owner = join(root, 'src/client/runtime');
  const runtime = join(owner, 'runtime.ts');
  const transportImplementation = join(root, 'src/client/transport/network.ts');
  for (const entry of [
    ...productionFiles(join(root, 'src')),
    ...productionFiles(join(root, 'server')),
  ]) {
    for (const edge of imports(entry)) {
      if (!edge.resolved) continue;
      if (within(edge.resolved, owner) && !within(entry, owner)) {
        assert.ok(
          entry === adapter && edge.resolved === runtime,
          `runtime consumer bypasses composition: ${relative(root, entry)}`,
        );
      }
      if (
        edge.resolved === transportImplementation &&
        entry !== transportImplementation
      ) {
        assert.equal(entry, runtime, 'concrete transport is composition-only');
      }
    }
  }
});
