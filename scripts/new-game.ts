// npm run game:new -- <kebab-slug>
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import ts from 'typescript';
import { catalogEntries } from './catalog-registration.ts';

const root = resolve(import.meta.dirname, '..');
const [slug, ...extra] = process.argv.slice(2);
function fail(message: string): never {
  console.error(`game:new: ${message}`);
  process.exit(1);
}
if (
  !slug ||
  extra.length ||
  slug.length > 64 ||
  !/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(slug)
)
  fail('usage: npm run game:new -- <kebab-slug> (at most 64 characters)');
const directory = join(root, 'src/client/minigames', slug);
if (existsSync(directory)) fail(`src/client/minigames/${slug} already exists`);
const catalogPath = join(root, 'src/client/minigames/catalog.ts');
const catalog = await readFile(catalogPath, 'utf8');
const pascal = slug.replace(/(^|-)([a-z0-9])/g, (_, _dash, char: string) =>
  char.toUpperCase(),
);
const name = `${pascal[0].toLowerCase()}${pascal.slice(1)}Game`;
const entries = catalogEntries(catalog);
if (
  entries.some(
    (entry) => entry.path === `./${slug}/index.ts` || entry.name === name,
  )
)
  fail('descriptor is already registered');
const source = ts.createSourceFile(
  'catalog.ts',
  catalog,
  ts.ScriptTarget.Latest,
  true,
);
let array: ts.ArrayLiteralExpression | undefined;
for (const statement of source.statements) {
  if (
    (ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) &&
    statement.name?.text === name
  )
    fail('catalog identifier is already declared');
  if (ts.isImportDeclaration(statement)) {
    const clause = statement.importClause;
    if (
      clause?.name?.text === name ||
      (clause?.namedBindings &&
        ts.isNamedImports(clause.namedBindings) &&
        clause.namedBindings.elements.some(
          (binding) => binding.name.text === name,
        ))
    )
      fail('catalog identifier is already imported');
  }
  if (ts.isVariableStatement(statement))
    for (const declaration of statement.declarationList.declarations) {
      if (ts.isIdentifier(declaration.name) && declaration.name.text === name)
        fail('catalog identifier is already declared');
      if (
        ts.isIdentifier(declaration.name) &&
        declaration.name.text === 'games' &&
        declaration.initializer &&
        ts.isArrayLiteralExpression(declaration.initializer)
      )
        array = declaration.initializer;
    }
}
if (!array) fail('catalog registration surface is missing');
const updated =
  `import { ${name} } from './${slug}/index.ts';\n` +
  catalog.slice(0, array.end - 1) +
  (array.elements.hasTrailingComma ? ` ${name},` : `, ${name}`) +
  catalog.slice(array.end - 1);
// Validate transformed registration and load all templates before creating files.
catalogEntries(updated);
const replacements: Record<string, string> = {
  SLUG: slug,
  CLASS: pascal,
  EXPORT: name,
  TITLE: slug
    .split('-')
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join(' '),
};
const files = await Promise.all(
  ['index.ts', 'game.ts', 'renderer.ts', 'game.test.ts'].map(async (file) => ({
    file,
    text: (
      await readFile(
        join(root, 'scripts/templates/game', `${file}.tpl`),
        'utf8',
      )
    ).replace(/__([A-Z]+)__/g, (_token, key: string) => replacements[key]),
  })),
);
if ((await readFile(catalogPath, 'utf8')) !== catalog)
  fail('catalog changed during generation; retry');
await mkdir(directory);
for (const file of files)
  await writeFile(join(directory, file.file), file.text, { flag: 'wx' });
await writeFile(catalogPath, updated);
console.log(
  `Created src/client/minigames/${slug} and registered ${name}.\nRun npm run game:test, npm run typecheck, npm run lint and npm run build.`,
);
