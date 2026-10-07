import ts from 'typescript';

/** Read the one supported eager registration surface without executing game code. */
export function catalogEntries(
  source: string,
): { name: string; path: string }[] {
  const file = ts.createSourceFile(
    'catalog.ts',
    source,
    ts.ScriptTarget.Latest,
    true,
  );
  const imports = new Map<string, string>();
  let entries: ts.ArrayLiteralExpression | undefined;
  for (const statement of file.statements) {
    if (
      ts.isImportDeclaration(statement) &&
      ts.isStringLiteral(statement.moduleSpecifier)
    )
      for (const binding of statement.importClause?.namedBindings &&
      ts.isNamedImports(statement.importClause.namedBindings)
        ? statement.importClause.namedBindings.elements
        : [])
        imports.set(binding.name.text, statement.moduleSpecifier.text);
    if (ts.isVariableStatement(statement))
      for (const declaration of statement.declarationList.declarations)
        if (
          ts.isIdentifier(declaration.name) &&
          declaration.name.text === 'games' &&
          declaration.initializer &&
          ts.isArrayLiteralExpression(declaration.initializer)
        )
          entries = declaration.initializer;
  }
  if (!entries || entries.elements.length === 0)
    throw new Error('Catalog games must be a nonempty literal array.');
  const result = entries.elements.map((entry) => {
    if (!ts.isIdentifier(entry))
      throw new Error('Catalog entries must be imported descriptor names.');
    const path = imports.get(entry.text);
    if (!path || !/^\.\/[a-z][a-z0-9]*(?:-[a-z0-9]+)*\/index\.ts$/.test(path))
      throw new Error(`Invalid catalog registration: ${entry.text}.`);
    return { name: entry.text, path };
  });
  if (
    new Set(result.map((entry) => entry.path)).size !== result.length ||
    new Set(result.map((entry) => entry.name)).size !== result.length
  )
    throw new Error('Duplicate catalog registration.');
  return result;
}
