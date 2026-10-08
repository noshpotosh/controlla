import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { discoverTests, isGameTest } from './test-discovery.ts';

const root = resolve(import.meta.dirname, '..');
const args = process.argv.slice(2);
const game = args[0] === '--game';
if (game) args.shift();
const all = await discoverTests(root);
const files = game ? all.filter(isGameTest) : all;
if (!files.length) throw new Error('No test files discovered.');

if (args[0] === '--list' && args.length === 1) {
  process.stdout.write(files.join('\n') + '\n');
} else {
  const result = spawnSync(
    process.execPath,
    ['--import', import.meta.resolve('tsx'), '--test', ...args, ...files],
    { cwd: root, stdio: 'inherit' },
  );
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
}
