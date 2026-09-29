import { spawn, type ChildProcess } from 'node:child_process';
import { readdir, readFile, readlink, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const frontendPort = port('PHONE_DEV_PORT', 3012);
const signalPort = port('PHONE_SIGNAL_PORT', 8912);
const children: { label: string; process: ChildProcess }[] = [];
const generatedDirectories = ['.vinext', '.next', 'dist'] as const;
const stackMarker = 'CONTROLLA_PHONE_DEV_ROOT';
let stopping = false;

export interface ProcessDetails {
  pid: number;
  cwd: string;
  command: string;
  environment: Readonly<Record<string, string>>;
}

function port(name: string, fallback: number): number {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isInteger(value) || value < 1 || value > 65535)
    throw new Error(`${name} must be an integer from 1 to 65535.`);
  return value;
}

export function tunnelUrlFrom(output: string): string | null {
  return (
    output.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com\b/i)?.[0] ?? null
  );
}

export function isStalePhoneProcess(
  details: ProcessDetails,
  repositoryRoot: string,
  currentPid: number,
  ports = { frontend: 3012, signal: 8912 },
): boolean {
  if (details.pid === currentPid || details.cwd !== repositoryRoot)
    return false;
  if (details.environment[stackMarker] === repositoryRoot) return true;

  const command = details.command.replaceAll('\\', '/');
  if (command.includes('scripts/phone-development.ts')) return true;
  if (/\bvinext(?:\.cmd)?\s+dev\b/.test(command)) return true;
  if (
    /\bwrangler(?:\.cmd)?\s+tunnel\s+quick-start\b/.test(command) &&
    command.includes(`127.0.0.1:${ports.frontend}`)
  )
    return true;
  return (
    command.includes('server/index.ts') &&
    details.environment.SIGNAL_PORT === String(ports.signal) &&
    (details.environment.ALLOWED_ORIGINS ?? '').includes('trycloudflare.com')
  );
}

function environmentFrom(contents: string): Record<string, string> {
  return Object.fromEntries(
    contents
      .split('\0')
      .filter(Boolean)
      .map((entry) => {
        const separator = entry.indexOf('=');
        return separator < 0
          ? [entry, '']
          : [entry.slice(0, separator), entry.slice(separator + 1)];
      }),
  );
}

async function linuxProcesses(): Promise<ProcessDetails[]> {
  if (process.platform !== 'linux') return [];
  const entries = await readdir('/proc', { withFileTypes: true });
  const processes = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory() && /^\d+$/.test(entry.name))
      .map(async (entry): Promise<ProcessDetails | null> => {
        const pid = Number(entry.name);
        try {
          const base = `/proc/${pid}`;
          const [cwd, command, environment] = await Promise.all([
            readlink(`${base}/cwd`),
            readFile(`${base}/cmdline`, 'utf8'),
            readFile(`${base}/environ`, 'utf8'),
          ]);
          return {
            pid,
            cwd,
            command: command.replaceAll('\0', ' ').trim(),
            environment: environmentFrom(environment),
          };
        } catch {
          return null;
        }
      }),
  );
  return processes.filter(
    (details): details is ProcessDetails => details !== null,
  );
}

async function linuxAncestorPids(pid: number): Promise<Set<number>> {
  const ancestors = new Set<number>([pid]);
  if (process.platform !== 'linux') return ancestors;
  let current = pid;
  while (current > 1) {
    try {
      const status = await readFile(`/proc/${current}/status`, 'utf8');
      const parent = Number(status.match(/^PPid:\s+(\d+)$/m)?.[1]);
      if (!parent || ancestors.has(parent)) break;
      ancestors.add(parent);
      current = parent;
    } catch {
      break;
    }
  }
  return ancestors;
}

function processExists(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function signalProcess(pid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(pid, signal);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
  }
}

async function cleanPreviousRun(): Promise<void> {
  console.log('\nCleaning previous phone development state…');
  const currentProcessTree = await linuxAncestorPids(process.pid);
  const stale = (await linuxProcesses()).filter(
    (details) =>
      !currentProcessTree.has(details.pid) &&
      isStalePhoneProcess(details, root, process.pid, {
        frontend: frontendPort,
        signal: signalPort,
      }),
  );
  for (const details of stale) signalProcess(details.pid, 'SIGTERM');

  const deadline = Date.now() + 5_000;
  while (stale.some(({ pid }) => processExists(pid)) && Date.now() < deadline)
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  for (const { pid } of stale)
    if (processExists(pid)) signalProcess(pid, 'SIGKILL');

  await Promise.all(
    generatedDirectories.map((directory) =>
      rm(resolve(root, directory), { recursive: true, force: true }),
    ),
  );
  console.log(
    `Removed ${generatedDirectories.join(', ')}${stale.length ? ` and stopped ${stale.length} stale process${stale.length === 1 ? '' : 'es'}` : ''}.`,
  );
}

function executable(name: string): string {
  return resolve(
    root,
    'node_modules',
    '.bin',
    process.platform === 'win32' ? `${name}.cmd` : name,
  );
}

async function requireFreePort(value: number, label: string): Promise<void> {
  await new Promise<void>((resolveReady, reject) => {
    const server = createServer();
    server.once('error', () =>
      reject(
        new Error(
          `${label} port ${value} is already in use. Stop that process or set ${label === 'Frontend' ? 'PHONE_DEV_PORT' : 'PHONE_SIGNAL_PORT'}.`,
        ),
      ),
    );
    server.listen(value, '127.0.0.1', () => server.close(() => resolveReady()));
  });
}

function start(
  label: string,
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv,
  capture = false,
): ChildProcess {
  const child = spawn(command, args, {
    cwd: root,
    env: { ...env, [stackMarker]: root },
    stdio: capture ? ['inherit', 'pipe', 'pipe'] : 'inherit',
  });
  children.push({ label, process: child });
  child.once('error', (error) => {
    if (!stopping)
      fail(new Error(`${label} failed to start: ${error.message}`));
  });
  return child;
}

async function waitForHttp(url: string, label: string): Promise<void> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // The process is still starting.
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 200));
  }
  throw new Error(`${label} did not become ready at ${url}.`);
}

function waitForTunnelUrl(child: ChildProcess): Promise<string> {
  return new Promise((resolveUrl, reject) => {
    let output = '';
    const timeout = setTimeout(
      () => reject(new Error('The HTTPS tunnel did not provide a URL.')),
      60_000,
    );
    const consume = (stream: NodeJS.WriteStream, chunk: Buffer) => {
      stream.write(chunk);
      output = (output + chunk.toString()).slice(-16_384);
      const url = tunnelUrlFrom(output);
      if (!url) return;
      clearTimeout(timeout);
      resolveUrl(url);
    };
    child.stdout?.on('data', (chunk: Buffer) => consume(process.stdout, chunk));
    child.stderr?.on('data', (chunk: Buffer) => consume(process.stderr, chunk));
    child.once('exit', (code, signal) => {
      clearTimeout(timeout);
      reject(
        new Error(
          `HTTPS tunnel stopped before it was ready (${signal ?? code ?? 'unknown'}).`,
        ),
      );
    });
  });
}

async function stop(): Promise<void> {
  if (stopping) return;
  stopping = true;
  for (const child of children.toReversed())
    if (child.process.exitCode === null) child.process.kill('SIGTERM');
}

function fail(error: Error): void {
  console.error(`\nPhone development failed: ${error.message}`);
  void stop().finally(() => {
    process.exitCode = 1;
  });
}

async function main(): Promise<void> {
  await cleanPreviousRun();
  await requireFreePort(frontendPort, 'Frontend');
  await requireFreePort(signalPort, 'Signal');

  console.log('\nStarting the local frontend…');
  const frontend = start(
    'Frontend',
    executable('vinext'),
    ['dev', '--port', String(frontendPort), '--force'],
    { ...process.env, SIGNAL_PORT: String(signalPort) },
  );
  await waitForHttp(`http://127.0.0.1:${frontendPort}/`, 'Frontend');

  console.log('\nCreating a temporary trusted HTTPS phone URL…');
  const tunnel = start(
    'HTTPS tunnel',
    executable('wrangler'),
    ['tunnel', 'quick-start', `http://127.0.0.1:${frontendPort}`],
    { ...process.env, NO_COLOR: '1' },
    true,
  );
  const tunnelUrl = await waitForTunnelUrl(tunnel);
  const tunnelOrigin = new URL(tunnelUrl).origin;

  console.log('\nStarting the room service…');
  const signal = start(
    'Room service',
    process.execPath,
    ['--import', 'tsx', 'server/index.ts'],
    {
      ...process.env,
      SIGNAL_PORT: String(signalPort),
      ALLOWED_ORIGINS: [
        tunnelOrigin,
        `http://localhost:${frontendPort}`,
        `http://127.0.0.1:${frontendPort}`,
      ].join(','),
    },
  );
  await waitForHttp(`http://127.0.0.1:${signalPort}/health`, 'Room service');

  console.log(`\nPhone development is ready.\n\n  ${tunnelUrl}\n`);
  console.log('Open that same HTTPS URL on the laptop and phone.');
  console.log(
    'No certificate profile is needed. Press Ctrl+C to stop everything.',
  );
  console.log('The URL is temporary and public to anyone who knows it.\n');

  const exitCode = await new Promise<number>((resolveExit) => {
    process.once('SIGINT', () => resolveExit(0));
    process.once('SIGTERM', () => resolveExit(0));
    for (const child of [frontend, tunnel, signal])
      child.once('exit', (code, signalName) => {
        if (!stopping) {
          console.error(
            `\n${children.find((entry) => entry.process === child)?.label} stopped unexpectedly (${signalName ?? code ?? 'unknown'}).`,
          );
          resolveExit(1);
        }
      });
  });
  await stop();
  process.exitCode = exitCode;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
  void main().catch((error: unknown) =>
    fail(error instanceof Error ? error : new Error(String(error))),
  );
