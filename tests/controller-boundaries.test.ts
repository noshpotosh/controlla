import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import test from 'node:test';
import ts from 'typescript';

const root = resolve(process.cwd());
const controls = join(root, 'src/client/controls');
const api = join(controls, 'api.ts');
const resolver = join(controls, 'resolve.ts');
const layouts = join(root, 'src/client/controls/layouts');
const legacyConfig = join(root, 'src/core/config.ts');
const tools = ['designer', 'gallery', 'preview'].map((name) =>
  join(root, 'src/client/devtools', name),
);
const within = (file: string, directory: string) =>
  file === directory || file.startsWith(directory + sep);
const isSource = (file: string) => /\.[cm]?[jt]sx?$/.test(file);
function files(directory: string): string[] {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = join(directory, entry.name);
    return entry.isDirectory()
      ? files(file)
      : isSource(file) &&
          !/\.(test|spec)\.[cm]?[jt]sx?$/.test(file) &&
          !file.endsWith('.d.ts')
        ? [file]
        : [];
  });
}
const config = ts.readConfigFile(join(root, 'tsconfig.json'), (file) =>
  ts.sys.readFile(file),
);
assert.equal(config.error, undefined);
const options = ts.parseJsonConfigFileContent(
  config.config,
  ts.sys,
  root,
).options;
const sourceFiles = ['src', 'app', 'server', 'scripts'].flatMap((directory) =>
  files(join(root, directory)),
);
const program = ts.createProgram(sourceFiles, options);
const checker = program.getTypeChecker();
function source(file: string): ts.SourceFile {
  assert.ok(existsSync(file), `${relative(root, file)} is required`);
  return (
    program.getSourceFile(file) ??
    ts.createSourceFile(
      file,
      readFileSync(file, 'utf8'),
      ts.ScriptTarget.Latest,
      true,
    )
  );
}
interface Edge {
  specifier: string;
  typeOnly: boolean;
  target?: string;
}
const edgeCache = new Map<string, Edge[]>();
/** Resolve all TS import forms, including aliases, type queries and re-exports. */
function edges(file: string): Edge[] {
  if (!isSource(file)) return [];
  const cached = edgeCache.get(file);
  if (cached) return cached;
  const result: Edge[] = [];
  const add = (specifier: string, typeOnly: boolean) => {
    let target = ts.resolveModuleName(specifier, file, options, ts.sys)
      .resolvedModule?.resolvedFileName;
    if (!target && specifier.startsWith('.')) {
      const asset = resolve(dirname(file), specifier);
      if (existsSync(asset)) target = asset;
    }
    result.push({ specifier, typeOnly, target });
  };
  const visit = (node: ts.Node): void => {
    if (
      ts.isImportDeclaration(node) &&
      ts.isStringLiteralLike(node.moduleSpecifier)
    ) {
      const clause = node.importClause,
        bindings = clause?.namedBindings;
      const typeOnly =
        clause?.phaseModifier === ts.SyntaxKind.TypeKeyword ||
        !!(
          clause &&
          !clause.name &&
          bindings &&
          ts.isNamedImports(bindings) &&
          bindings.elements.length &&
          bindings.elements.every((item) => item.isTypeOnly)
        );
      add(node.moduleSpecifier.text, typeOnly);
    } else if (
      ts.isExportDeclaration(node) &&
      node.moduleSpecifier &&
      ts.isStringLiteralLike(node.moduleSpecifier)
    ) {
      const clause = node.exportClause;
      add(
        node.moduleSpecifier.text,
        node.isTypeOnly ||
          !!(
            clause &&
            ts.isNamedExports(clause) &&
            clause.elements.length &&
            clause.elements.every((item) => item.isTypeOnly)
          ),
      );
    } else if (ts.isImportTypeNode(node)) {
      assert.ok(
        ts.isLiteralTypeNode(node.argument) &&
          ts.isStringLiteralLike(node.argument.literal),
        `${relative(root, file)} has an opaque import type`,
      );
      add(node.argument.literal.text, true);
    } else if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference)
    ) {
      const expression = node.moduleReference.expression;
      assert.ok(
        expression && ts.isStringLiteralLike(expression),
        `${relative(root, file)} has an opaque import assignment`,
      );
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
        `${relative(root, file)} has an opaque dynamic import`,
      );
      add(specifier.text, false);
    }
    ts.forEachChild(node, visit);
  };
  visit(source(file));
  edgeCache.set(file, result);
  return result;
}
function internal(edge: Edge): boolean {
  return (
    !!edge.target &&
    within(edge.target, root) &&
    !edge.target.includes(`${sep}node_modules${sep}`)
  );
}
/** Ownership includes type edges; runtime purity omits erased imports. */
function graph(entry: string, includeTypes = true): Set<string> {
  const seen = new Set<string>(),
    pending = [entry];
  while (pending.length) {
    const file = pending.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    for (const edge of edges(file)) {
      if (edge.typeOnly && !includeTypes) continue;
      assert.ok(
        edge.target,
        `${relative(root, file)} cannot resolve ${edge.specifier}`,
      );
      if (internal(edge)) pending.push(edge.target!);
    }
  }
  return seen;
}
function exportsOf(file: string): Set<string> {
  const symbol = checker.getSymbolAtLocation(source(file));
  assert.ok(symbol, `${relative(root, file)} must remain a module`);
  return new Set(
    checker.getExportsOfModule(symbol).map((item) => item.getName()),
  );
}

void test('controller API is dependency-free declarations only, with no implementation exports', () => {
  const contract = source(api);
  assert.deepEqual(
    edges(api),
    [],
    'even type-only API imports would reintroduce ownership dependencies',
  );
  assert.ok(contract.statements.length > 0);
  for (const statement of contract.statements)
    assert.ok(
      ts.isInterfaceDeclaration(statement) ||
        ts.isTypeAliasDeclaration(statement),
      `controls/api.ts contains ${ts.SyntaxKind[statement.kind]}; only type/interface declarations belong here`,
    );
  const names = exportsOf(api);
  for (const name of [
    'ControllerSpec',
    'ControllerRequirements',
    'Capabilities',
    'ControllerConfig',
    'Widget',
    'InputRequirement',
    'ControlPort',
    'ControllerLayout',
    'ControlValue',
  ])
    assert.ok(names.has(name), `controls/api.ts owns ${name}`);
});

void test('production controller dependencies stay inside controls, with only the resolver importing the layout catalog', () => {
  const production = files(controls).filter(
    (file) => !tools.some((directory) => within(file, directory)),
  );
  for (const required of ['ControllerSurface.tsx', 'registry.ts', 'resolve.ts'])
    assert.ok(production.includes(join(controls, required)));
  for (const file of tools.flatMap(files))
    for (const edge of edges(file))
      assert.notEqual(
        edge.target,
        join(root, 'src/client/engine/input.ts'),
        `${relative(root, file)} must project catalog requirements without the engine adapter`,
      );
  for (const entry of production)
    for (const file of graph(entry)) {
      assert.ok(
        (within(file, controls) &&
          !tools.some((directory) => within(file, directory))) ||
          within(file, layouts),
        `${relative(root, entry)} reaches ${relative(root, file)} outside the controller boundary`,
      );
      for (const edge of edges(file)) {
        if (
          internal(edge) &&
          within(edge.target!, layouts) &&
          !within(file, layouts)
        )
          assert.equal(
            file,
            resolver,
            `${relative(root, file)} bypasses the resolver to import the layout catalog`,
          );
        if (!internal(edge))
          assert.ok(
            /^(react|react-dom|lucide-react)(\/|$)/.test(edge.specifier),
            `${relative(root, file)} imports non-UI external dependency ${edge.specifier}`,
          );
      }
    }
});

void test('resolver and registry runtime dependency graphs remain headless', () => {
  const uiOnly = [
    'views.ts',
    'ControllerSurface.tsx',
    'SensorTile.tsx',
    'kit/icons.ts',
    'kit/rotation-context.ts',
    'kit/useTrackedPointer.ts',
  ].map((file) => join(controls, file));
  const portable = new Set([
    'structuredClone',
    'TextEncoder',
    'TextDecoder',
    'URL',
    'URLSearchParams',
    'AbortController',
    'AbortSignal',
  ]);
  for (const entry of [resolver, join(controls, 'registry.ts')])
    for (const file of graph(entry, false)) {
      assert.ok(
        !/\.[jt]sx$/.test(file) && !uiOnly.includes(file),
        `${relative(root, entry)} reaches browser UI ${relative(root, file)}`,
      );
      for (const edge of edges(file).filter((edge) => !edge.typeOnly))
        assert.ok(
          internal(edge),
          `${relative(root, entry)} reaches runtime package ${edge.specifier}`,
        );
      if (!isSource(file)) continue;
      const unit = source(file);
      for (const statement of unit.statements)
        assert.ok(
          !(
            ts.isExpressionStatement(statement) &&
            ts.isStringLiteral(statement.expression) &&
            statement.expression.text === 'use client'
          ),
          `${relative(root, file)} is a client-only module`,
        );
      const visit = (node: ts.Node): void => {
        // Type annotations and imports do not execute, including IconName's UI owner.
        if (
          ts.isTypeNode(node) ||
          ts.isInterfaceDeclaration(node) ||
          ts.isTypeAliasDeclaration(node) ||
          ts.isImportDeclaration(node) ||
          ts.isExportDeclaration(node)
        )
          return;
        if (ts.isIdentifier(node)) {
          const symbol = checker.getSymbolAtLocation(node);
          const browserDeclaration = symbol?.declarations?.some((declaration) =>
            /[/\\]lib\.dom(?:\.iterable)?\.d\.ts$/.test(
              declaration.getSourceFile().fileName,
            ),
          );
          assert.ok(
            !browserDeclaration || portable.has(node.text),
            `${relative(root, file)} depends on browser API ${node.text}`,
          );
        }
        ts.forEachChild(node, visit);
      };
      visit(unit);
    }
});

void test('legacy resolver, Manifest bridge and moved contract exports are removed without compatibility aliases', () => {
  assert.equal(
    existsSync(legacyConfig),
    false,
    'core/config.ts must be removed, not replaced with a re-export',
  );
  const contractNames = exportsOf(api);
  for (const oldOwner of [
    'src/core/types.ts',
    'src/client/controls/types.ts',
    'src/client/controls/value.ts',
    'src/client/controls/layout/schema.ts',
    'src/client/controls/layouts.ts',
  ])
    for (const name of exportsOf(join(root, oldOwner)))
      assert.ok(
        !contractNames.has(name) && name !== 'Manifest',
        `${oldOwner} still exports moved contract ${name}`,
      );
  assert.ok(
    !exportsOf(join(root, 'src/client/engine/input.ts')).has(
      'controllerManifest',
    ),
  );
  const experimental = exportsOf(
    join(root, 'src/client/devtools/game-harness/input.ts'),
  );
  for (const name of [
    'controllerManifest',
    'controllerSpec',
    'resolveController',
  ])
    assert.ok(
      !experimental.has(name),
      `Remove experimental controller forward ${name}`,
    );
  for (const file of sourceFiles) {
    for (const edge of edges(file)) {
      const oldRelativeTarget = edge.specifier.startsWith('.')
        ? resolve(dirname(file), edge.specifier).replace(/\.[cm]?[jt]s$/, '')
        : null;
      assert.ok(
        edge.target !== legacyConfig &&
          oldRelativeTarget !== legacyConfig.slice(0, -3),
        `${relative(root, file)} still imports the legacy resolver`,
      );
    }
    const visit = (node: ts.Node): void => {
      if (
        ts.isInterfaceDeclaration(node) ||
        ts.isTypeAliasDeclaration(node) ||
        ts.isFunctionDeclaration(node)
      )
        assert.ok(
          node.name?.text !== 'Manifest' &&
            node.name?.text !== 'controllerManifest',
          `${relative(root, file)} retains the legacy Manifest bridge`,
        );
      if (ts.isImportSpecifier(node) || ts.isExportSpecifier(node))
        assert.notEqual(
          (node.propertyName ?? node.name).text,
          'Manifest',
          `${relative(root, file)} imports/re-exports Manifest`,
        );
      if (ts.isTypeReferenceNode(node))
        assert.notEqual(
          ts.isIdentifier(node.typeName)
            ? node.typeName.text
            : node.typeName.right.text,
          'Manifest',
          `${relative(root, file)} still references Manifest`,
        );
      ts.forEachChild(node, visit);
    };
    visit(source(file));
  }
});
