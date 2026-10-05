import { copyFileSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const build = resolve(here, '../../work/double-dash-build');
function git(args) { return spawnSync('git', ['-C', build, ...args], { encoding: 'utf8' }); }
const revision = git(['rev-parse', 'HEAD']).stdout.trim();
if (revision !== '7e38409ace3dda709c178312ff63fd92a3653cc7') throw new Error('Unexpected staged runtime revision.');
for (const name of ['0001-four-controller-state.patch', '0002-controller-worker-transport.patch', '0003-four-controller-devices.patch', '0004-confirm-state-restore.patch', '0005-preserve-renderer-selection.patch']) {
  const patch = resolve(here, 'patches', name);
  if (git(['apply', '--reverse', '--check', patch]).status === 0) continue;
  const check = git(['apply', '--check', patch]);
  if (check.status !== 0) throw new Error(`Cannot apply ${name}: ${check.stderr}`);
  const apply = git(['apply', patch]);
  if (apply.status !== 0) throw new Error(apply.stderr);
}
copyFileSync(resolve(here, 'controller-input.mjs'), resolve(build, 'src/controlla-controllers.js'));
for (const subdir of ['Core']) {
  const path = resolve(build, 'vendor/dolphin/Source/Core', subdir, 'CMakeLists.txt');
  const source = readFileSync(path, 'utf8');
  if (source.includes("'_SetControllerInputState'")) continue;
  if (!source.includes("'_SetInputState'")) throw new Error(`Missing input export list: ${path}`);
  writeFileSync(path, source.replaceAll("'_SetInputState'", "'_SetInputState','_SetControllerInputState'"));
}
console.log('Prepared four-controller source, worker transport, SI devices, and native exports in the isolated build checkout.');
