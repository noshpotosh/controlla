// Scaffold a controls-library component and register it everywhere.
//
//   npm run control:new -- <type>                 new control from the template
//   npm run control:new -- <type> --from <type>   copy an existing control
//
// Copies never touch the original. See src/controls/README.md.
import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import ts from 'typescript';

const root = resolve(import.meta.dirname, '..'),
  controls = join(root, 'src/controls'),
  templates = join(root, 'scripts/templates/control');

const [type, flag, from] = process.argv.slice(2);
const fail = (message: string): never => {
  console.error(`control:new: ${message}`);
  process.exit(1);
};
if (!type || !/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/.test(type))
  fail('usage: npm run control:new -- <kebab-type> [--from <existing-type>]');
if (flag && (flag !== '--from' || !from))
  fail('expected --from <existing-type>');
if (existsSync(join(controls, type)))
  fail(`src/controls/${type} already exists`);
if (from && !existsSync(join(controls, from, 'definition.ts')))
  fail(`no control "${from}" in src/controls`);

const pascal = (t: string) =>
    t.replace(/(^|-)([a-z0-9])/g, (_, _d, c: string) => c.toUpperCase()),
  camel = (t: string) => pascal(t).replace(/^./, (c) => c.toLowerCase()),
  title = (t: string) =>
    t.replace(/-/g, ' ').replace(/^./, (c) => c.toUpperCase());

/** Rename declarations from this control, preserving shared imports and aliases. */
function copyRenamer(
  sourceDirectory: string,
  files: string[],
  from: string,
  type: string,
) {
  const program = ts.createProgram(
    files
      .filter((file) => /\.[cm]?[jt]sx?$/.test(file))
      .map((file) => join(sourceDirectory, file)),
    {
      target: ts.ScriptTarget.ESNext,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      jsx: ts.JsxEmit.ReactJSX,
      allowImportingTsExtensions: true,
      skipLibCheck: true,
      noEmit: true,
    },
  );
  const checker = program.getTypeChecker();
  const rename = (name: string) =>
    name === camel(from)
      ? camel(type)
      : name.replaceAll(pascal(from), pascal(type));
  return (file: string, text: string): string => {
    const source = program.getSourceFile(join(sourceDirectory, file));
    if (!source) return text.replaceAll(pascal(from), pascal(type));
    const edits: { start: number; end: number; text: string }[] = [];
    const visit = (node: ts.Node): void => {
      if (ts.isIdentifier(node) && rename(node.text) !== node.text) {
        let symbol = checker.getSymbolAtLocation(node);
        if (symbol && symbol.flags & ts.SymbolFlags.Alias)
          symbol = checker.getAliasedSymbol(symbol);
        if (
          symbol?.declarations?.some((declaration) =>
            declaration
              .getSourceFile()
              .fileName.startsWith(sourceDirectory + sep),
          )
        )
          edits.push({
            start: node.getStart(source),
            end: node.end,
            text: rename(node.text),
          });
      } else if (ts.isStringLiteralLike(node) && node.text.startsWith('./')) {
        const parent = node.parent;
        const modulePath =
          ts.isImportDeclaration(parent) ||
          ts.isExportDeclaration(parent) ||
          (ts.isCallExpression(parent) &&
            (parent.expression.kind === ts.SyntaxKind.ImportKeyword ||
              (ts.isIdentifier(parent.expression) &&
                parent.expression.text === 'require'))) ||
          (ts.isLiteralTypeNode(parent) && ts.isImportTypeNode(parent.parent));
        const path = node.text.replaceAll(pascal(from), pascal(type));
        if (modulePath && path !== node.text)
          edits.push({
            start: node.getStart(source) + 1,
            end: node.end - 1,
            text: path,
          });
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
    for (const edit of edits.sort((a, b) => b.start - a.start))
      text = text.slice(0, edit.start) + edit.text + text.slice(edit.end);
    return text;
  };
}

/** Register the literal union without depending on its last member or formatting. */
function registerWidgetType(source: string, type: string): string {
  const declaration = /\bexport\s+type\s+WidgetType\s*=\s*([^;]+);/.exec(
    source,
  );
  if (!declaration) return fail('no WidgetType union in src/controls/api.ts');
  const members = declaration[1]
    .split('|')
    .map((member) => member.trim())
    .filter(Boolean);
  if (
    !members.length ||
    members.some((member) => !/^(['"])[a-z][a-z0-9-]*\1$/.test(member))
  )
    fail('WidgetType in src/controls/api.ts must be a literal union');
  if (members.some((member) => member.slice(1, -1) === type))
    fail(`control type "${type}" is already registered in src/controls/api.ts`);
  return source.replace(
    declaration[0],
    `export type WidgetType =\n${[...members, `'${type}'`].map((member) => `  | ${member}`).join('\n')};`,
  );
}

// Check the registration before creating files so a duplicate is a no-op even
// when its control directory has not been created yet (for example, motion types).
const apiFile = join(controls, 'api.ts');
const updatedApi = registerWidgetType(await readFile(apiFile, 'utf8'), type);

const dir = join(controls, type);
await mkdir(dir);
if (from) {
  const files = await readdir(join(controls, from));
  const rename = copyRenamer(join(controls, from), files, from, type);
  for (const file of files) {
    const original = await readFile(join(controls, from, file), 'utf8');
    let text = rename(file, original).replaceAll(`ctl-${from}`, `ctl-${type}`);
    if (file === 'definition.ts')
      text = text
        .replace(`type: '${from}'`, `type: '${type}'`)
        .replace(/displayName: '[^']*'/, `displayName: '${title(type)}'`);
    await writeFile(join(dir, file.replace(pascal(from), pascal(type))), text);
  }
} else {
  for (const file of await readdir(templates)) {
    const text = (await readFile(join(templates, file), 'utf8'))
      .replaceAll('__TYPE__', type)
      .replaceAll('__PASCAL__', pascal(type))
      .replaceAll('__CAMEL__', camel(type))
      .replaceAll('__TITLE__', title(type));
    await writeFile(
      join(dir, file.replace('.tpl', '').replace('View', pascal(type))),
      text,
    );
  }
}
const view = (await readdir(dir)).find((f) => f.endsWith('.tsx'));
if (!view) fail('no view file was created');

/** Insert `line` before `marker` in a file (or report that it must be done by hand). */
async function insert(path: string, marker: string | RegExp, line: string) {
  const file = join(root, path),
    text = await readFile(file, 'utf8'),
    match =
      typeof marker === 'string' ? text.indexOf(marker) : text.search(marker);
  if (match < 0) {
    console.warn(`  ! add by hand to ${path}: ${line.trim()}`);
    return;
  }
  const lineStart = text.lastIndexOf('\n', match) + 1;
  await writeFile(
    file,
    text.slice(0, lineStart) + line + text.slice(lineStart),
  );
  console.log(`  ✓ ${path}`);
}

const inserts: [string, string | RegExp, string][] = [
  [
    'src/controls/registry.ts',
    '\n\n/** Library controls',
    `import { ${camel(type)} } from './${type}/definition.ts';\n`,
  ],
  ['src/controls/registry.ts', '// control:new inserts', `  ${camel(type)},\n`],
  [
    'src/controls/views.ts',
    '\n\n// Each view narrows',
    `import { ${pascal(type)} } from './${type}/${view!.replace('.tsx', '')}.tsx';\n`,
  ],
  [
    'src/controls/views.ts',
    '// control:new inserts',
    `  '${type}': ${pascal(type)},\n`,
  ],
  [
    'src/controls/controls.css',
    '/* control-generator:imports */',
    `@import './${type}/styles.css';\n`,
  ],
  ['docs/INPUTS.md', /\n\n## Motion/, `| \`${type}\` | TODO | TODO |  |\n`],
];
console.log(
  `Created src/controls/${type}/${from ? ` (copied from ${from})` : ''}`,
);
for (const [path, marker, line] of inserts) await insert(path, marker, line);
await writeFile(apiFile, updatedApi);
console.log('  ✓ src/controls/api.ts');
console.log(`
Next:
  1. Fill in src/controls/${type}/definition.ts (description, channel, output).
  2. Build the view and styles (tokens only), then open /?role=gallery.
  3. npm run format && npm test`);
