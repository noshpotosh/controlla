import { selectRuntime } from './runtime-selection.mjs';
import { createPhoneRelay } from './phone-relay.mjs';
import { inspectDoubleDash } from './disc.mjs';
import { spawnSync } from 'node:child_process';
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { dirname, extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const runtimeSelection = selectRuntime(repo, process.env.DOUBLE_DASH_RUNTIME);
const runtime = runtimeSelection.path;
const revision = '7e38409ace3dda709c178312ff63fd92a3653cc7';
const disc = resolve(process.env.DOUBLE_DASH_DISC || resolve(repo, 'Mario Kart - Double Dash!! (USA).ciso'));
if (!existsSync(disc)) throw new Error(`Game image missing: ${disc}. Set DOUBLE_DASH_DISC to your image.`);
const discInfo = await inspectDoubleDash(disc);
console.log(`Validated ${discInfo.gameId}: ${discInfo.files.length} files, ${discInfo.imageBytes} bytes.`);
if (!existsSync(resolve(runtime, 'index.html'))) {
  for (const args of [
    ['clone', 'https://github.com/dougchansan/wasm-dolphin.git', runtime],
    ['-C', runtime, 'checkout', '--detach', revision],
  ]) {
    const result = spawnSync('git', args, { stdio: 'inherit' });
    if (result.status !== 0) throw new Error('Could not install the pinned browser emulator. Check network access and Git.');
  }
}
const actualRevision = spawnSync('git', ['-C', runtime, 'rev-parse', 'HEAD'], { encoding: 'utf8' });
if (actualRevision.stdout?.trim() !== revision) throw new Error('Browser emulator revision differs from the pinned version.');

const phoneRelay = createPhoneRelay();
const phoneRelays = [phoneRelay, ...Array.from({ length: runtimeSelection.rebuilt ? 3 : 0 }, () => createPhoneRelay())];
const relayTimer = setInterval(() => phoneRelays.forEach(relay => relay.expire()), 50);
relayTimer.unref();
const phoneAssets = { '/controller': 'phone.html', '/phone.js': 'phone.js', '/motion-steering.mjs': 'motion-steering.mjs' };
const phoneOrigin = process.env.DOUBLE_DASH_PHONE_ORIGIN || '';
if (phoneOrigin && (new URL(phoneOrigin).protocol !== 'https:' || new URL(phoneOrigin).origin !== phoneOrigin)) throw new Error('DOUBLE_DASH_PHONE_ORIGIN must be an HTTPS origin without a trailing slash.');
const extensionTypes = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.json': 'application/json', '.png': 'image/png' };
const extraPhoneBoot = phoneRelays.slice(1).map((relay, index) => `
const extraLink${index} = document.createElement('a');
extraLink${index}.href = ${JSON.stringify(phoneOrigin)} + '/controller?port=${index + 1}&token=${relay.token}';
extraLink${index}.textContent = 'Player ${index + 2} motion';
extraLink${index}.target = '_blank';
extraLink${index}.rel = 'noopener';
document.querySelector('.topbar-actions').append(extraLink${index});
const extraEvents${index} = new EventSource('/phone-events?port=${index + 1}&token=${relay.token}');
let extraSeen${index} = 0, extraActive${index} = false;
extraEvents${index}.onmessage = event => {
  extraSeen${index} = performance.now();
  const state = JSON.parse(event.data);
  extraActive${index} = state.connected;
  if (!host.adapter?.loaded) return;
  host.adapter.setControllerInputState(${index + 1}, state)
    .catch(error => setStatus(error.message, 'error'));
};
setInterval(() => {
  if (extraActive${index} && performance.now() - extraSeen${index} > 250) {
    extraActive${index} = false;
    if (host.adapter?.loaded) host.adapter.setControllerInputState(${index + 1}, { ...inputStateFromPressed(new Set(), null), connected: false })
      .catch(error => setStatus(error.message, 'error'));
  }
}, 50);
`).join('\n');
const boot = `
installGameShell();
const partyStatus = (message, type) => {
  document.getElementById('party-feedback').textContent = message;
  setStatus(message, type);
};
installProgressControls({ getAdapter: () => host.adapter, setStatus: partyStatus,
  key: ${JSON.stringify(`${discInfo.gameId}:${runtimeSelection.coreHash || 'd7395b3a94080f5b7d08a0522f59096007419d117b7b0eb868246429adee6f5c'}`)} });
${extraPhoneBoot}
const phoneLink = document.createElement('a');
phoneLink.href = ${JSON.stringify(phoneOrigin)} + '/controller?token=${phoneRelay.token}';
phoneLink.textContent = 'Player 1 motion';
phoneLink.target = '_blank';
phoneLink.rel = 'noopener';
document.querySelector('.topbar-actions').prepend(phoneLink);
const phoneEvents = new EventSource('/phone-events?token=${phoneRelay.token}');
phoneEvents.onmessage = event => {
  controllaPhone.state = JSON.parse(event.data);
  controllaPhone.at = performance.now();
  syncInput(controllaPhone.state.connected ? 'Phone motion' : 'Keyboard');
};
setInterval(() => {
  if (controllaPhone.state?.connected && performance.now() - controllaPhone.at > 250) {
    controllaPhone.state = { connected: false };
    host.setInputState(inputStateFromPressed(new Set(), null));
  }
}, 50);

const localButton = document.createElement('button');
localButton.type = 'button';
localButton.textContent = 'Play Double Dash';
localButton.className = 'party-play';
document.querySelector('.topbar-actions').prepend(localButton);
localButton.addEventListener('click', async () => {
  localButton.disabled = true;
  try {
    if (!globalThis.crossOriginIsolated || !navigator.gpu) throw new Error('Use desktop Chrome with WebGPU enabled.');
    partyStatus('Getting the race ready…');
    const response = await fetch('/local-disc');
    if (!response.ok) throw new Error('Could not read your local game image.');
    const file = new File([await response.blob()], ${JSON.stringify(disc.split(sep).at(-1))});
    await mountFile(file);
    partyStatus(host.adapter?.loaded ? 'Game loaded. Press Enter or Start on your phone.' : 'Could not start the game. Please try again.', host.adapter?.loaded ? undefined : 'error');
  } catch (error) { partyStatus(error.message, 'error'); }
  finally { localButton.disabled = false; }
});
finishGameShell();
`;

const handleRequest = async (request, response) => {
  response.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  response.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
  response.setHeader('Cache-Control', 'no-store');
  try {
    const url = new URL(request.url, 'http://localhost');
    const pathname = decodeURIComponent(url.pathname);
    if (pathname === '/phone-input' || pathname === '/phone-events') {
      const port = Number(url.searchParams.get('port') || 0);
      const relay = Number.isInteger(port) ? phoneRelays[port] : null;
      if (!relay) { response.writeHead(404).end(); return; }
      if (url.searchParams.get('token') !== relay.token) { response.writeHead(403).end('Invalid controller link.'); return; }
      if (pathname === '/phone-events' && request.method === 'GET') {
        response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Connection': 'keep-alive' });
        response.flushHeaders();
        const unsubscribe = relay.subscribe(response);
        response.on('close', unsubscribe);
        return;
      }
      if (pathname === '/phone-input' && request.method === 'POST') {
        if (request.headers.origin && new URL(request.headers.origin).host !== request.headers.host) { response.writeHead(403).end(); return; }
        if (!request.headers['content-type']?.startsWith('application/json')) { response.writeHead(415).end(); return; }
        let body = '';
        for await (const chunk of request) {
          body += chunk.toString();
          if (body.length > 4096) { response.writeHead(413).end(); return; }
        }
        try { relay.accept(JSON.parse(body)); response.writeHead(204).end(); }
        catch (error) { response.writeHead(400).end(error.message); }
        return;
      }
      response.writeHead(405).end(); return;
    }
    if (!['GET', 'HEAD'].includes(request.method)) { response.writeHead(405).end(); return; }
    if (['/progress.mjs', '/game-shell.mjs', '/game-shell.css'].includes(pathname)) {
      response.setHeader('Content-Type', extensionTypes[extname(pathname)]);
      response.end(request.method === 'HEAD' ? undefined : readFileSync(resolve(repo, 'scripts/mario-kart', pathname.slice(1))));
      return;
    }
    if (phoneAssets[pathname]) {
      const asset = resolve(repo, 'scripts/mario-kart', phoneAssets[pathname]);
      response.setHeader('Content-Type', extensionTypes[extname(asset)] || 'text/javascript');
      response.end(request.method === 'HEAD' ? undefined : readFileSync(asset));
      return;
    }
    if (pathname === '/disc-info') {
      response.setHeader('Content-Type', 'application/json');
      response.end(request.method === 'HEAD' ? undefined : JSON.stringify(discInfo));
      return;
    }
    const isDisc = pathname === '/local-disc';
    const relative = pathname === '/' ? 'index.html' : pathname.slice(1);
    const path = isDisc ? disc : resolve(runtime, relative);
    if (!isDisc && (!path.startsWith(runtime + sep) || relative.split('/').some(part => part.startsWith('.')))) {
      response.writeHead(404).end(); return;
    }
    if (!isDisc && !['index.html', 'icon.png'].includes(relative) && !['src/', 'cores/'].some(prefix => relative.startsWith(prefix))) {
      response.writeHead(404).end(); return;
    }
    const stats = statSync(path);
    if (!stats.isFile()) { response.writeHead(404).end(); return; }
    response.setHeader('Content-Type', extensionTypes[extname(path)] || 'application/octet-stream');
    if (request.method === 'HEAD') { response.end(); return; }
    if (relative === 'src/upstream-worker-protocol.js' && runtimeSelection.rebuilt) {
      response.end(readFileSync(path, 'utf8').replace(
        /export const DEFAULT_UPSTREAM_CORE_SHA256 = "[a-f0-9]{64}";/,
        `export const DEFAULT_UPSTREAM_CORE_SHA256 = "${runtimeSelection.coreHash}";`));
      return;
    }
    if (relative === 'src/app.js') {
      const app = readFileSync(path, 'utf8').replace(
        'host.setInputState(inputStateFromPressed(combinedPressed, gamepadInputState));',
        'host.setInputState(controllaPhone.state?.connected && performance.now() - controllaPhone.at <= 250 ? controllaPhone.state : inputStateFromPressed(combinedPressed, gamepadInputState));');
      response.end('import { installGameShell, finishGameShell } from "/game-shell.mjs";\nimport { installProgressControls } from "/progress.mjs";\nconst controllaPhone = { state: null, at: 0 };\n' + app + boot); return;
    }
    if (relative === 'index.html') {
      response.end(readFileSync(path, 'utf8').replaceAll('<title>wasm-dolphin</title>', '<title>Controlla · Double Dash</title>').replace('<h1>wasm-dolphin</h1>', '<h1>controlla</h1>').replace('</head>', '<link rel="stylesheet" href="/game-shell.css"></head>'));
      return;
    }
    response.setHeader('Content-Length', stats.size);
    const stream = createReadStream(path);
    stream.on('error', () => response.destroy());
    stream.pipe(response);
  } catch { response.writeHead(404).end('Not found'); }
};
const server = createServer(handleRequest);
const phoneCert = process.env.DOUBLE_DASH_PHONE_CERT;
const phoneKey = process.env.DOUBLE_DASH_PHONE_KEY;
if (Boolean(phoneCert) !== Boolean(phoneKey)) throw new Error('Set both DOUBLE_DASH_PHONE_CERT and DOUBLE_DASH_PHONE_KEY.');
if (phoneCert) {
  if (!phoneOrigin) throw new Error('Set DOUBLE_DASH_PHONE_ORIGIN to the address trusted by the phone certificate.');
  const phoneServer = createHttpsServer({ cert: readFileSync(phoneCert), key: readFileSync(phoneKey) }, (request, response) => {
    let pathname;
    try { pathname = new URL(request.url, 'https://localhost').pathname; }
    catch { response.writeHead(400).end(); return; }
    if (!Object.hasOwn(phoneAssets, pathname) && pathname !== '/phone-input') { response.writeHead(404).end(); return; }
    void handleRequest(request, response);
  });
  phoneServer.listen(Number(new URL(phoneOrigin).port || 443), process.env.DOUBLE_DASH_PHONE_BIND || '0.0.0.0', () => {
    console.log(`Phone controllers: ${phoneOrigin} (controller routes only)`);
    phoneRelays.forEach((relay, port) => console.log(`Player ${port + 1}: ${phoneOrigin}/controller?port=${port}&token=${relay.token}`));
  });
  phoneServer.on('error', error => { console.error(error.message); process.exitCode = 1; });
}
server.listen(Number(process.env.DOUBLE_DASH_PORT || 8080), '127.0.0.1', () => {
  console.log(`Controlla Double Dash: http://127.0.0.1:${server.address().port}/?core=upstream&video=wgpu&cpu=dual&wasmjit=1`);
  console.log('Open in desktop Chrome, then click “Play Double Dash”. Game data stays on this computer.');
});
server.on('error', error => { console.error(error.message); process.exitCode = 1; });
