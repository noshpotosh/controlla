import { spawn, type ChildProcess } from 'node:child_process';
import { request } from 'node:http';
import type { Plugin } from 'vite';

/** Local game files never travel through the phone LAN/tunnel origin. */
export const isLocalGameRequest = (host = '', address = '') =>
  /^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(host) &&
  ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(address);

export function doubleDashRuntime(): Plugin {
  let child: ChildProcess | null = null;
  let starting: Promise<void> | null = null;
  const port = Number(process.env.DOUBLE_DASH_PORT || 8080);
  const ensureRuntime = () =>
    (starting ??= (async () => {
      if (process.env.CONTROLLA_DOUBLE_DASH !== '1')
        throw new Error(
          'To play Double Dash, restart the host with npm run dev:mario-kart.',
        );
      child = spawn(process.execPath, ['scripts/mario-kart/serve.mjs'], {
        env: {
          ...process.env,
          DOUBLE_DASH_RUNTIME: process.env.DOUBLE_DASH_RUNTIME || 'rebuilt',
        },
        stdio: 'inherit',
      });
      let failure: Error | null = null;
      child.once('error', (error) => {
        failure = error;
      });
      for (let attempt = 0; attempt < 100; attempt++) {
        if (failure) throw failure;
        if (child.exitCode !== null || child.signalCode !== null)
          throw new Error(
            'The local Double Dash runtime could not start. Check the host terminal and local game image.',
          );
        try {
          const response = await fetch(`http://127.0.0.1:${port}/disc-info`, {
            signal: AbortSignal.timeout(500),
          });
          if (response.ok) return;
        } catch {
          /* Wait for the local listener. */
        }
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
      throw new Error('The local Double Dash runtime did not become ready.');
    })());
  return {
    name: 'controlla-double-dash-runtime',
    apply: 'serve',
    configureServer(server) {
      // SharedArrayBuffer is required by the game worker. The main room and
      // embedded surface must both opt in; WebRTC signaling stays unchanged.
      server.middlewares.use((_req, res, next) => {
        res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
        res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
        next();
      });
      server.middlewares.use('/__double-dash', (req, res) => {
        const message = (text: string, status = 503) => {
          res.statusCode = status;
          res.setHeader('Content-Type', 'text/html; charset=utf-8');
          const escaped = text.replace(
            /[&<>"']/g,
            (character) => `&#${character.charCodeAt(0)};`,
          );
          res.end(
            `<body style="margin:0;display:grid;place-items:center;height:100vh;background:#111416;color:#c8ff61;font:18px system-ui;text-align:center"><p role="status">${escaped}</p></body>`,
          );
        };
        if (!isLocalGameRequest(req.headers.host, req.socket.remoteAddress)) {
          message(
            'Double Dash runs on the host computer. Open this room on localhost to play.',
            403,
          );
          return;
        }
        if (req.method !== 'GET' && req.method !== 'HEAD') {
          res.writeHead(405).end();
          return;
        }
        void ensureRuntime()
          .then(() => {
            const upstream = request(
              {
                host: '127.0.0.1',
                port,
                path: req.url || '/',
                method: req.method,
              },
              (reply) => {
                res.writeHead(reply.statusCode || 502, reply.headers);
                reply.pipe(res);
              },
            );
            upstream.on('error', () => {
              if (!res.headersSent)
                message(
                  'The local game runtime stopped. End round and restart the host.',
                );
              else res.destroy();
            });
            res.on('close', () => upstream.destroy());
            upstream.end();
          })
          .catch((error: unknown) =>
            message(
              error instanceof Error
                ? error.message
                : 'Could not prepare Double Dash.',
            ),
          );
      });
      server.httpServer?.once('close', () => child?.kill('SIGTERM'));
    },
  };
}
