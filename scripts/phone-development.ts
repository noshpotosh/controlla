import { spawn, type ChildProcess } from 'node:child_process';
import { request } from 'node:https';
import { createServer } from 'node:net';
import { networkInterfaces, type NetworkInterfaceInfo } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const frontendPort = port('PHONE_DEV_PORT', 3012);
const signalPort = port('PHONE_SIGNAL_PORT', 8912);
/** `--lan` serves phones on the same Wi-Fi directly, with no public tunnel. */
const lan = process.argv.includes('--lan');
const children: { label: string; process: ChildProcess }[] = [];
let stopping = false;

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

/**
 * The computer's LAN IPv4 addresses, Wi-Fi/Ethernet first. Loopback and
 * link-local addresses are left out: a phone cannot reach them.
 */
export function lanAddresses(
  interfaces: NodeJS.Dict<NetworkInterfaceInfo[]> = networkInterfaces(),
): string[] {
  const rank = (name: string) => (/^(en|eth|wlan|wl)/.test(name) ? 0 : 1);
  return Object.entries(interfaces)
    .sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b))
    .flatMap(([, entries]) =>
      (entries ?? [])
        .filter(
          (entry) =>
            entry.family === 'IPv4' &&
            !entry.internal &&
            !entry.address.startsWith('169.254.'),
        )
        .map((entry) => entry.address),
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
    env,
    stdio: capture ? ['inherit', 'pipe', 'pipe'] : 'inherit',
  });
  children.push({ label, process: child });
  child.once('error', (error) => {
    if (!stopping)
      fail(new Error(`${label} failed to start: ${error.message}`));
  });
  return child;
}

async function waitForHttp(
  url: string,
  label: string,
  child?: ChildProcess,
  hint = '',
): Promise<void> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    // A process that quits during startup will never answer; say so at once.
    if (child && (child.exitCode !== null || child.signalCode !== null))
      throw new Error(
        `${label} exited before it was ready (${child.signalCode ?? child.exitCode}).${hint}`,
      );
    if ((await status(url)) === 200) return;
    await new Promise((resolveWait) => setTimeout(resolveWait, 200));
  }
  throw new Error(`${label} did not become ready at ${url}.`);
}

/** HTTP status for a URL, or 0 while unreachable. Local HTTPS is self-signed. */
function status(url: string): Promise<number> {
  if (!url.startsWith('https:'))
    return fetch(url).then(
      (response) => response.status,
      () => 0,
    );
  return new Promise((resolveStatus) => {
    const probe = request(url, { rejectUnauthorized: false }, (response) => {
      response.resume();
      resolveStatus(response.statusCode ?? 0);
    });
    probe.setTimeout(20_000, () => probe.destroy());
    probe.once('error', () => resolveStatus(0));
    probe.end();
  });
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
  await requireFreePort(frontendPort, 'Frontend');
  await requireFreePort(signalPort, 'Signal');

  const addresses = lan ? lanAddresses() : [];
  if (lan && !addresses.length)
    throw new Error(
      'No Wi-Fi or Ethernet address found. Join the same network as the phones and try again.',
    );

  console.log('\nStarting the local frontend…');
  const frontend = start(
    'Frontend',
    executable('vinext'),
    ['dev', '--port', String(frontendPort), '--force'],
    {
      ...process.env,
      SIGNAL_PORT: String(signalPort),
      // Phones need a secure context for motion; LAN mode uses a self-signed certificate.
      ...(lan ? { HTTPS: '1' } : {}),
    },
  );
  // vinext allows one dev server per folder, so a running `npm run dev` blocks this one.
  await waitForHttp(
    `${lan ? 'https' : 'http'}://127.0.0.1:${frontendPort}/`,
    'Frontend',
    frontend,
    ' If another dev server is running in this folder (such as `npm run dev`), stop it and try again.',
  );

  let tunnel: ChildProcess | null = null,
    urls: string[];
  if (lan) urls = addresses.map((ip) => `https://${ip}:${frontendPort}`);
  else {
    console.log('\nCreating a temporary trusted HTTPS phone URL…');
    tunnel = start(
      'HTTPS tunnel',
      executable('wrangler'),
      ['tunnel', 'quick-start', `http://127.0.0.1:${frontendPort}`],
      { ...process.env, NO_COLOR: '1' },
      true,
    );
    urls = [new URL(await waitForTunnelUrl(tunnel)).origin];
  }
  const scheme = lan ? 'https' : 'http';

  console.log('\nStarting the room service…');
  const signal = start(
    'Room service',
    process.execPath,
    ['--import', 'tsx', 'server/index.ts'],
    {
      ...process.env,
      SIGNAL_PORT: String(signalPort),
      ALLOWED_ORIGINS: [
        ...urls,
        `${scheme}://localhost:${frontendPort}`,
        `${scheme}://127.0.0.1:${frontendPort}`,
      ].join(','),
    },
  );
  await waitForHttp(
    `http://127.0.0.1:${signalPort}/health`,
    'Room service',
    signal,
  );

  if (lan) {
    console.log(`\nLocal Wi-Fi play is ready.\n\n  ${urls[0]}\n`);
    if (urls.length > 1)
      console.log(
        `Other addresses on this computer: ${urls.slice(1).join(', ')}\n`,
      );
    console.log(
      'Open that URL on the laptop, create the room there, then join from phones on the same Wi-Fi.',
    );
    console.log(
      'The certificate is self-signed: each browser warns once. On iPhone tap Show Details → visit this website.',
    );
    console.log(
      'Nothing leaves your network. Press Ctrl+C to stop everything.\n',
    );
  } else {
    console.log(`\nPhone development is ready.\n\n  ${urls[0]}\n`);
    console.log('Open that same HTTPS URL on the laptop and phone.');
    console.log(
      'No certificate profile is needed. Press Ctrl+C to stop everything.',
    );
    console.log('The URL is temporary and public to anyone who knows it.\n');
  }

  const exitCode = await new Promise<number>((resolveExit) => {
    process.once('SIGINT', () => resolveExit(0));
    process.once('SIGTERM', () => resolveExit(0));
    for (const child of [frontend, tunnel, signal].filter(
      (entry): entry is ChildProcess => entry !== null,
    ))
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
