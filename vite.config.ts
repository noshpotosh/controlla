import { sites } from '@openai/sites-vite-plugin';
import basicSsl from '@vitejs/plugin-basic-ssl';
import tailwindcss from '@tailwindcss/postcss';
import vinext from 'vinext';
import type { IncomingMessage } from 'node:http';
import { connect } from 'node:net';
import type { Duplex } from 'node:stream';
import { defineConfig, type Plugin } from 'vite';
import hostingConfig from './.openai/hosting.json' with { type: 'json' };

const SITE_CREATOR_PLACEHOLDER_DATABASE_ID =
  '00000000-0000-4000-8000-000000000000';

const { d1, r2 } = hostingConfig;

// macOS Seatbelt blocks FSEvents, so Codex previews need polling for HMR.
const isCodexSeatbeltSandbox = process.env.CODEX_SANDBOX === 'seatbelt';

// Phones need a secure context for motion and wake lock. HTTPS=1 serves the dev
// server on the LAN with a self-signed certificate (accept the browser warning).
const useHttps = process.env.HTTPS === '1';

// The Cloudflare plugin claims every non-Vite WebSocket upgrade and destroys the
// socket when the Worker has no handler, killing `/signal` right after it
// connects. Intercept those upgrades before any listener sees them and pipe
// them straight to the signaling service.
const signalProxy = (): Plugin => ({
  name: 'controlla-signal-proxy',
  configureServer({ httpServer }) {
    if (!httpServer) return;
    const emit = httpServer.emit;
    httpServer.emit = function (
      this: typeof httpServer,
      event: string,
      ...args: unknown[]
    ) {
      const [req, socket, head] = args as [IncomingMessage, Duplex, Buffer];
      if (event !== 'upgrade' || !req.url?.startsWith('/signal'))
        return emit.call(this, event, ...args);
      const upstream = connect(SIGNAL_PORT, '127.0.0.1', () => {
        let raw = `${req.method} ${req.url} HTTP/1.1\r\n`;
        for (let i = 0; i < req.rawHeaders.length; i += 2)
          raw += `${req.rawHeaders[i]}: ${req.rawHeaders[i + 1]}\r\n`;
        upstream.write(raw + '\r\n');
        upstream.write(head);
        socket.pipe(upstream).pipe(socket);
      });
      upstream.on('error', () => socket.destroy());
      socket.on('error', () => upstream.destroy());
      return true;
    } as typeof httpServer.emit;
  },
});
const SIGNAL_PORT = Number(process.env.SIGNAL_PORT ?? 8787);

const localBindingConfig = {
  main: 'vinext/server/fetch-handler',
  compatibility_flags: ['nodejs_compat'],
  d1_databases: d1
    ? [
        {
          binding: d1,
          database_name: 'site-creator-d1',
          database_id: SITE_CREATOR_PLACEHOLDER_DATABASE_ID,
        },
      ]
    : [],
  r2_buckets: r2
    ? [
        {
          binding: r2,
          bucket_name: 'site-creator-r2',
        },
      ]
    : [],
};

export default defineConfig(async () => {
  // Keep Wrangler and Miniflare state project-local. These are non-secret tool
  // settings; application environment belongs in ignored `.env*` files.
  process.env.WRANGLER_WRITE_LOGS ??= 'false';
  process.env.WRANGLER_LOG_PATH ??= '.wrangler/logs';
  process.env.MINIFLARE_REGISTRY_PATH ??= '.wrangler/registry';

  // Wrangler snapshots its log path while the Cloudflare plugin is imported.
  const { cloudflare } = await import('@cloudflare/vite-plugin');

  return {
    css: { postcss: { plugins: [tailwindcss()] } },
    server: {
      // vinext dev ignores --host, so bind every interface here for phones.
      host: true,
      ...(isCodexSeatbeltSandbox
        ? { watch: { useFsEvents: false, usePolling: true } }
        : {}),
    },
    plugins: [
      signalProxy(),
      ...(useHttps ? [basicSsl()] : []),
      vinext(),
      sites(),
      cloudflare({
        viteEnvironment: { name: 'rsc', childEnvironments: ['ssr'] },
        config: localBindingConfig,
      }),
    ],
  };
});
