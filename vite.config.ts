import basicSsl from '@vitejs/plugin-basic-ssl';
import tailwindcss from '@tailwindcss/postcss';
import vinext from 'vinext';
import { mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { networkInterfaces } from 'node:os';
import { resolve, sep } from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import nextConfig from './next.config.ts';
import { isMotionTrace } from './src/client/controls/motion/trace.ts';
import { developmentEntry } from './scripts/development-entry.ts';
import { productionBundleBoundary } from './scripts/production-boundary.ts';
import { doubleDashRuntime } from './scripts/mario-kart/vite-plugin.ts';
import { renderLayoutIndex } from './src/client/controls/layout/index-file.ts';
import {
  isControllerLayout,
  layoutFileName,
} from './src/client/controls/layout/schema.ts';
import { validateLayout } from './src/client/controls/layout/validate.ts';

// macOS Seatbelt blocks FSEvents, so Codex previews need polling for HMR.
const isCodexSeatbeltSandbox = process.env.CODEX_SANDBOX === 'seatbelt';

// Phones need a secure context for motion and wake lock. HTTPS=1 serves the dev
// server on the LAN with a self-signed certificate. For trusted iPhone HTTPS,
// follow docs/acceptance/LOCAL-IPHONE.md.
const useHttps = process.env.HTTPS === '1';

const SIGNAL_PORT = Number(process.env.SIGNAL_PORT ?? 8787);

// Dev-only: the phone's Motion Lab uploads recordings here so they land in the
// repo as replay fixtures. Accepts JSON only, from this machine's own
// addresses, capped in size, written only inside MOTION_TRACE_DIR.
const MOTION_TRACE_DIR = 'tests/fixtures/motion';
const MAX_TRACE_BYTES = 5 * 1024 * 1024;
const ownHostnames = () =>
  new Set([
    'localhost',
    '127.0.0.1',
    '[::1]',
    ...Object.values(networkInterfaces())
      .flat()
      .flatMap((net) => (net ? [net.address] : [])),
  ]);
const motionTraceUpload = (): Plugin => ({
  name: 'controlla-motion-trace-upload',
  apply: 'serve',
  configureServer(server) {
    server.middlewares.use('/__controlla/motion-trace', (req, res) => {
      const reply = (status: number, body: object) => {
        if (res.writableEnded) return;
        res.statusCode = status;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(body));
      };
      let origin = '';
      try {
        origin = new URL(req.headers.origin ?? '').hostname;
      } catch {
        /* Missing or malformed origin is rejected below. */
      }
      if (req.method !== 'POST') return reply(405, { error: 'POST only' });
      if (!ownHostnames().has(origin))
        return reply(403, { error: 'Uploads must come from this dev server' });
      if (!req.headers['content-type']?.includes('application/json'))
        return reply(415, { error: 'Expected application/json' });
      const chunks: Buffer[] = [];
      let size = 0;
      req.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > MAX_TRACE_BYTES) {
          reply(413, { error: 'Recording is larger than 5 MB' });
          req.destroy();
        } else chunks.push(chunk);
      });
      req.on('end', async () => {
        if (res.writableEnded) return;
        try {
          const trace: unknown = JSON.parse(Buffer.concat(chunks).toString());
          if (!isMotionTrace(trace))
            return reply(400, { error: 'Not a motion trace' });
          const slug =
            trace.name
              .toLowerCase()
              .replace(/[^a-z0-9]+/g, '-')
              .replace(/^-|-$/g, '')
              .slice(0, 40) || 'trace';
          const stamp = new Date().toISOString().replace(/[:.]/g, '-');
          const dir = resolve(server.config.root, MOTION_TRACE_DIR),
            file = resolve(dir, `${slug}-${stamp}.json`);
          if (!file.startsWith(dir + sep))
            return reply(400, { error: 'Invalid name' });
          await mkdir(dir, { recursive: true });
          await writeFile(file, JSON.stringify(trace));
          reply(201, { path: `${MOTION_TRACE_DIR}/${slug}-${stamp}.json` });
        } catch (error) {
          reply(400, {
            error: error instanceof Error ? error.message : 'Upload failed',
          });
        }
      });
    });
  },
});

// Dev-only: the controller designer's layout library lives in src/client/controls/layouts,
// one JSON file per layout, plus a generated index.ts listing them. The index
// is regenerated only when a layout is created or deleted, so ordinary saves
// just hot-reload that one file (which is how phone previews update live).
// Nothing here imports the layouts themselves: Vite restarts the dev server
// when a config dependency changes.
const LAYOUT_DIR = 'src/client/controls/layouts';
const MAX_LAYOUT_BYTES = 64 * 1024;
const controllerLayouts = (): Plugin => ({
  name: 'controlla-controller-layouts',
  apply: 'serve',
  configureServer(server) {
    const dir = resolve(server.config.root, LAYOUT_DIR);
    const writeIndex = async () => {
      const ids = (await readdir(dir))
        .filter((f) => f.endsWith('.json'))
        .map((f) => f.slice(0, -5));
      await writeFile(resolve(dir, 'index.ts'), renderLayoutIndex(ids));
    };
    // The designer's "Test on phone" link needs this machine's LAN address.
    server.middlewares.use('/__controlla/lan', (_req, res) => {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ origins: server.resolvedUrls?.network ?? [] }));
    });
    server.middlewares.use('/__controlla/layouts', (req, res) => {
      const reply = (status: number, body: object) => {
        if (res.writableEnded) return;
        res.statusCode = status;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(body));
      };
      let origin = '';
      try {
        origin = new URL(req.headers.origin ?? '').hostname;
      } catch {
        /* Missing or malformed origin is rejected below. */
      }
      if (!ownHostnames().has(origin))
        return reply(403, { error: 'Changes must come from this dev server' });
      const fileFor = (id: string) => {
        const name = layoutFileName(id),
          file = name && resolve(dir, name);
        return file && file.startsWith(dir + sep) ? file : null;
      };
      if (req.method === 'DELETE') {
        const id = new URL(req.url ?? '', 'http://x').searchParams.get('id'),
          file = id && fileFor(id);
        if (!file) return reply(400, { error: 'Bad layout id' });
        void rm(file)
          .then(writeIndex)
          .then(() => reply(200, { deleted: id }))
          .catch((e: Error) => reply(400, { error: e.message }));
        return;
      }
      if (req.method !== 'POST')
        return reply(405, { error: 'POST or DELETE only' });
      if (!req.headers['content-type']?.includes('application/json'))
        return reply(415, { error: 'Expected application/json' });
      const create = new URL(req.url ?? '', 'http://x').searchParams.has(
        'create',
      );
      const chunks: Buffer[] = [];
      let size = 0;
      req.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > MAX_LAYOUT_BYTES) {
          reply(413, { error: 'Layout is larger than 64 KB' });
          req.destroy();
        } else chunks.push(chunk);
      });
      req.on('end', async () => {
        if (res.writableEnded) return;
        try {
          const layout: unknown = JSON.parse(Buffer.concat(chunks).toString());
          if (!isControllerLayout(layout))
            return reply(400, { error: 'Not a controller layout' });
          const file = fileFor(layout.id);
          if (!file)
            return reply(400, { error: `Bad layout id "${layout.id}"` });
          const issues = validateLayout(layout);
          if (issues.length)
            return reply(422, {
              error: issues.map((i) => i.message).join(' '),
            });
          const exists = await stat(file).then(
            () => true,
            () => false,
          );
          if (create && exists)
            return reply(409, {
              error: `A layout named "${layout.id}" exists`,
            });
          if (!create && !exists)
            return reply(404, { error: `No layout "${layout.id}" to update` });
          await mkdir(dir, { recursive: true });
          await writeFile(file, JSON.stringify(layout, null, 2) + '\n');
          if (create) await writeIndex();
          reply(create ? 201 : 200, {
            path: `${LAYOUT_DIR}/${layout.id}.json`,
          });
        } catch (error) {
          reply(400, {
            error: error instanceof Error ? error.message : 'Save failed',
          });
        }
      });
    });
  },
});

export default defineConfig(({ command }) => {
  const entry = developmentEntry(
    import.meta.dirname,
    command,
    nextConfig.pageExtensions,
  );
  return {
    resolve: { alias: entry.alias },
    css: { postcss: { plugins: [tailwindcss()] } },
    // Whack-a-Mole loads three lazily. Prebundle it up front so the first round
    // doesn't trigger a dependency re-optimisation that reloads the display.
    optimizeDeps: { include: ['three'] },
    server: {
      // vinext dev ignores --host, so bind every interface here for phones.
      host: true,
      strictPort: true,
      // `npm run dev:phone` uses a temporary Cloudflare Quick Tunnel so mobile
      // browsers receive a trusted HTTPS origin without installing a local CA.
      allowedHosts: ['.trycloudflare.com'],
      proxy: {
        '/signal': {
          target: `http://127.0.0.1:${SIGNAL_PORT}`,
          ws: true,
        },
      },
      ...(isCodexSeatbeltSandbox
        ? { watch: { useFsEvents: false, usePolling: true } }
        : {}),
    },
    plugins: [
      doubleDashRuntime(),
      motionTraceUpload(),
      controllerLayouts(),
      ...(useHttps ? [basicSsl()] : []),
      productionBundleBoundary(),
      vinext({
        nextConfig: { ...nextConfig, pageExtensions: entry.pageExtensions },
      }),
    ],
  };
});
