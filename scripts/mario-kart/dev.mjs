import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

// The room UI and its ordinary phone connections are the game launcher.
// Vite starts the local game runtime lazily when Double Dash is selected.
const env = { ...process.env, CONTROLLA_DOUBLE_DASH: '1', DOUBLE_DASH_RUNTIME: process.env.DOUBLE_DASH_RUNTIME || 'rebuilt' };
const children = process.argv.includes('--phone') ? [
  spawn(process.execPath, ['--import', 'tsx', 'scripts/phone-development.ts'], { env, stdio: 'inherit' }),
] : [
  spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], { env, stdio: 'inherit' }),
  spawn(resolve('node_modules/.bin/vinext'), ['dev'], { env, stdio: 'inherit' }),
];
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  children.forEach(child => child.kill('SIGTERM'));
  process.exitCode = code;
}
for (const child of children) {
  child.on('error', error => { console.error(error.message); stop(1); });
  child.on('exit', code => { if (!stopping) stop(code || 0); });
}
process.on('SIGINT', () => stop());
process.on('SIGTERM', () => stop());
