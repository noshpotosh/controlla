// Discover colocated game tests so adding a game needs no second registration.
import { readdir } from 'node:fs/promises';
import '../src/experiments/architecture/controller.test.ts';

async function loadExamples(directory: URL): Promise<void> {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const url = new URL(
      entry.name + (entry.isDirectory() ? '/' : ''),
      directory,
    );
    if (entry.isDirectory()) await loadExamples(url);
    else if (entry.name.endsWith('.test.ts')) await import(url.href);
  }
}

await loadExamples(new URL('../src/client/minigames/', import.meta.url));
