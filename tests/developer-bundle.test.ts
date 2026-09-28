import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import { createValidFileMatcher } from '../node_modules/vinext/dist/routing/file-matcher.js';
import { developmentEntry } from '../scripts/development-entry.ts';
import {
  assertProductionEvidence,
  assertProductionModules,
  type Artifact,
  type BundleReport,
} from '../scripts/production-boundary.ts';
import { toolRequest } from '../src/devtools/routing.ts';
import { motionDiagnostics } from '../src/client/shell/runtime-adapter.ts';
import { RingBuffer, type RawMotionSample } from '../src/core/motion/trace.ts';
import { defaultCapabilities } from '../src/controls/resolve.ts';

void test('build selection excludes dev routes before Vinext scans client imports', () => {
  const root = process.cwd(),
    production = developmentEntry(root, 'build'),
    development = developmentEntry(root, 'serve');
  assert.equal(
    production.alias['@controlla/app-entry'],
    resolve(root, 'src/client/shell/App.tsx'),
  );
  assert.equal(
    development.alias['@controlla/app-entry'],
    resolve(root, 'src/devtools/DevelopmentApp.tsx'),
  );
  const route = 'app/dev/game-harness/page.dev.tsx';
  assert.ok(readFileSync(route, 'utf8').includes('HarnessPreview'));
  assert.equal(
    createValidFileMatcher(production.pageExtensions).isAppRouterPage(route),
    false,
  );
  assert.equal(
    createValidFileMatcher(development.pageExtensions).isAppRouterPage(route),
    true,
  );
  assert.equal(
    createValidFileMatcher(production.pageExtensions).isAppRouterPage(
      'app/page.tsx',
    ),
    true,
  );
  assert.deepEqual(
    developmentEntry(root, 'build', ['mdx', 'tsx', 'dev.tsx']).pageExtensions,
    ['mdx', 'tsx'],
  );
});

void test('development wrapper preserves existing query URLs and leaves gameplay roles alone', () => {
  for (const page of ['designer', 'gallery', 'preview']) {
    assert.deepEqual(toolRequest(`?role=${page}&layout=aim-and-fire`), {
      page,
      layout: 'aim-and-fire',
    });
  }
  assert.equal(toolRequest('?role=controller&room=ABCD'), null);
  assert.equal(toolRequest('?role=display'), null);
  assert.equal(toolRequest(''), null);
});

void test('production guard rejects tool modules in every environment including query-suffixed lazy modules', () => {
  for (const environment of ['client', 'ssr', 'rsc']) {
    for (const id of [
      'src/devtools/DevelopmentApp.tsx',
      'src/games/engine.ts',
      'src/client/minigames/legacy/adapter.ts',
      'src/client/minigames/latency-lab/index.ts',
      'src/client/minigames/tilt-rally/index.ts',
      'src/client/minigames/target-practice/index.ts',
      'src/controls/designer/Designer.tsx',
      'src/controls/gallery/Gallery.tsx',
      'src/controls/preview/Preview.tsx',
      'src/client/MotionLab.tsx?client-reference',
      'src/experiments/architecture/harness.ts',
      'app/dev/game-harness/page.dev.tsx',
    ])
      assert.throws(
        () => assertProductionModules({ environment, moduleIds: [id] }),
        /development implementation/,
      );
  }
  assert.doesNotThrow(() =>
    assertProductionModules({
      environment: 'client',
      moduleIds: ['src/controls/button/View.tsx'],
    }),
  );
});

const modules = [
  'src/client/shell/App.tsx',
  'src/client/shell/runtime-adapter.ts',
  'src/client/shell/ConnectedShell.tsx',
  'src/client/shell/JoinScreen.tsx',
  'src/client/shell/RoomScreen.tsx',
  'src/client/shell/ControllerScreen.tsx',
  'src/client/shell/DiagnosticsPanel.tsx',
  'src/client/runtime.ts',
  'src/client/GameCanvas.tsx',
  'src/client/shell/ControllerMenu.tsx',
  'src/controls/ControllerSurface.tsx',
  'src/core/session.ts',
  'src/client/engine/round.ts',
  'src/client/engine/progress.ts',
  'src/client/minigames/catalog.ts',
  'src/client/minigames/neon-harvest/index.ts',
  'src/client/minigames/neon-harvest/game.ts',
  'src/client/minigames/neon-harvest/renderer.ts',
  'src/controls/aim-pad/AimPad.tsx',
];
function evidence(): { reports: BundleReport[]; artifacts: Artifact[] } {
  return {
    reports: ['client', 'ssr', 'rsc'].map((environment) => ({
      environment,
      moduleIds: [...modules],
    })),
    artifacts: [
      {
        path: 'client/chunk.js',
        content:
          'AIM SETTINGS | Save session report | Snapshot starvation events: | Start round',
      },
      {
        path: 'client/styles.css',
        content:
          '.ctl-button{}.ctl-aim-pad{}.ctl-menu-button{}.calibrate{}.stage{}',
      },
      { path: '.openai/hosting.json', content: '{}' },
      { path: 'server/wrangler.json', content: '{}' },
    ],
  };
}
void test('production audit rejects leaked lazy CSS/routes and cannot pass an empty build', () => {
  const { reports, artifacts } = evidence();
  assert.doesNotThrow(() => assertProductionEvidence(reports, artifacts));
  for (const content of [
    '.dz-stage{}',
    '.ctl-gallery{}',
    '.ctl-gallery,.shared{}',
    '.motion-lab{}',
    '.motion-lab>button{}',
    '.ctl-preview-pick{}',
    '.architecture-harness{}',
  ]) {
    assert.throws(
      () =>
        assertProductionEvidence(reports, [
          ...artifacts,
          { path: 'server/ssr/lazy.css', content },
        ]),
      /Development CSS/,
    );
  }
  assert.throws(
    () =>
      assertProductionEvidence(reports, [
        ...artifacts,
        { path: 'server/routes.json', content: '["/dev/game-harness"]' },
      ]),
    /Development UI or route/,
  );
  assert.throws(
    () => assertProductionEvidence(reports.slice(1), artifacts),
    /Missing production module evidence/,
  );
  assert.throws(
    () =>
      assertProductionEvidence(
        reports.map((r) => ({ ...r, moduleIds: ['only-a-stub.ts'] })),
        artifacts,
      ),
    /Gameplay positive control/,
  );
  assert.throws(
    () => assertProductionEvidence(reports, []),
    /Gameplay (?:UI|CSS) positive control/,
  );
});

void test('motion extension observes cloned samples without exposing runtime or transport', () => {
  const samples = new RingBuffer<RawMotionSample>(10),
    sample = { t: 1, rate: [1, 2, 3] } as RawMotionSample;
  samples.push(sample);
  let listener: ((sample: RawMotionSample) => void) | undefined,
    starts = 0,
    stops = 0;
  const port = motionDiagnostics({
    start() {
      starts++;
    },
    samples,
    capabilities: defaultCapabilities(),
    onSample(next) {
      listener = next;
      return () => {
        listener = undefined;
        stops++;
      };
    },
  });
  port.start();
  assert.equal(starts, 1);
  const read = port.recentSamples();
  read[0].t = 999;
  assert.equal(samples.toArray()[0].t, 1);
  const off = port.subscribe((next) => {
    next.t = 999;
  });
  listener!(sample);
  assert.equal(sample.t, 1);
  off();
  assert.equal(stops, 1);
  assert.deepEqual(Object.keys(port).sort(), [
    'permission',
    'recentSamples',
    'start',
    'subscribe',
  ]);
});
