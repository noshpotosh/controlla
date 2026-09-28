// Scaffold a controls-library component and register it everywhere.
//
//   npm run control:new -- <type>                 new control from the template
//   npm run control:new -- <type> --from <type>   copy an existing control
//
// Copies never touch the original. See src/controls/README.md.
import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

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

const dir = join(controls, type);
await mkdir(dir);
if (from) {
  for (const file of await readdir(join(controls, from))) {
    let text = await readFile(join(controls, from, file), 'utf8');
    text = text
      .replaceAll(`ctl-${from}`, `ctl-${type}`)
      .replaceAll(pascal(from), pascal(type));
    if (file === 'definition.ts')
      text = text
        .replace(`export const ${camel(from)}:`, `export const ${camel(type)}:`)
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
    "@import './gallery/",
    `@import './${type}/styles.css';\n`,
  ],
  ['src/core/types.ts', "  | 'text';", `  | '${type}'\n`],
  ['docs/INPUTS.md', /\n\n## Motion/, `| \`${type}\` | TODO | TODO |  |\n`],
];
console.log(
  `Created src/controls/${type}/${from ? ` (copied from ${from})` : ''}`,
);
for (const [path, marker, line] of inserts) await insert(path, marker, line);
console.log(`
Next:
  1. Fill in src/controls/${type}/definition.ts (description, channel, output).
  2. Build the view and styles (tokens only), then open /?role=gallery.
  3. npm run format && npm test`);
