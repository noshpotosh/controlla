import { readdir } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';

const excludedDirectories = new Set([
  'node_modules',
  '.git',
  '.worktrees',
  'worktrees',
  '.next',
  '.vinext',
  'dist',
  'out',
  'build',
  'coverage',
  'outputs',
  'generated',
]);

/** Stable direct discovery: no imported test wrappers or traversal of symlinks. */
export async function discoverTests(root: string): Promise<string[]> {
  const files: string[] = [];
  async function visit(directory: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const path = join(directory, entry.name);
      if (entry.isDirectory() && !excludedDirectories.has(entry.name))
        await visit(path);
      else if (entry.isFile() && /\.test\.tsx?$/.test(entry.name))
        files.push(relative(root, path).split(sep).join('/'));
    }
  }
  // Only these source roots are eligible; missing roots are an error.
  await visit(join(root, 'tests'));
  await visit(join(root, 'src'));
  return files.sort();
}

/** Game-owned tests and the shared game/harness/lifecycle/catalog boundaries. */
export function isGameTest(path: string): boolean {
  return (
    path.startsWith('src/client/minigames/') ||
    path.startsWith('src/client/devtools/game-harness/') ||
    /^tests\/(architecture-|game-)/.test(path) ||
    /^tests\/(engine-round|live-catalog|neon-runner|replay|test-discovery)\.test\.tsx?$/.test(
      path,
    )
  );
}
