import assert from 'node:assert/strict';
import {
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join, relative, resolve } from 'node:path';
import type { Plugin } from 'vite';

export interface BundleReport {
  environment: string;
  moduleIds: string[];
}
export interface Artifact {
  path: string;
  content: string;
}
export const auditDirectory = '.vinext/production-bundle';
const environments = ['client', 'ssr', 'rsc'];
const forbiddenModule =
  /(?:^|\/)(?:src\/games\/|src\/client\/minigames\/(?:legacy|latency-lab|tilt-rally|target-practice)\/|src\/client\/devtools\/|src\/devtools\/|src\/experiments\/architecture\/|src\/controls\/(?:designer|gallery|preview)\/|src\/client\/MotionLab\.tsx(?:\?|$)|app\/dev\/)/;
const forbiddenCss =
  /\.(?:architecture-harness|ctl-gallery|ctl-preview-pick|ctl-rotate|motion-lab|tool-links|dz)(?=[_-]|[^\w-]|$)/;
const forbiddenArtifact =
  /\/dev\/game-harness|HarnessPreview|Controller playground|Motion lab|__controlla\/(?:layouts|motion-trace)/;
const gameplayModules = [
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
  'src/client/controls/ControllerSurface.tsx',
  'src/client/engine/session.ts',
  'src/client/engine/round.ts',
  'src/client/engine/progress.ts',
  'src/client/minigames/catalog.ts',
  'src/client/minigames/neon-harvest/index.ts',
  'src/client/minigames/neon-harvest/game.ts',
  'src/client/minigames/neon-harvest/renderer.ts',
  'src/client/controls/aim-pad/AimPad.tsx',
];

export function assertProductionModules(report: BundleReport): void {
  for (const id of report.moduleIds) {
    assert.ok(
      !forbiddenModule.test(id.replaceAll('\\', '/')),
      `${report.environment} imports development implementation: ${id}`,
    );
  }
}

/** Inspect all three environments and every emitted asset, including lazy chunks. */
export function assertProductionEvidence(
  reports: BundleReport[],
  artifacts: Artifact[],
): void {
  for (const environment of environments) {
    assert.ok(
      reports.some(
        (report) =>
          report.environment === environment && report.moduleIds.length > 0,
      ),
      `Missing production module evidence for ${environment}`,
    );
  }
  for (const report of reports) assertProductionModules(report);
  const ids = new Set(
    reports.flatMap((report) => report.moduleIds.map((id) => id.split('?')[0])),
  );
  for (const path of gameplayModules) {
    assert.ok(ids.has(path), `Gameplay positive control missing: ${path}`);
  }
  for (const artifact of artifacts) {
    assert.ok(
      !forbiddenArtifact.test(artifact.path + '\n' + artifact.content),
      `Development UI or route emitted in ${artifact.path}`,
    );
    if (artifact.path.endsWith('.css')) {
      assert.ok(
        !forbiddenCss.test(artifact.content),
        `Development CSS emitted in ${artifact.path}`,
      );
    }
  }
  const clientCss = artifacts
    .filter(
      (file) => file.path.startsWith('client/') && file.path.endsWith('.css'),
    )
    .map((file) => file.content)
    .join('\n');
  for (const selector of [
    '.ctl-button',
    '.ctl-aim-pad',
    '.ctl-menu-button',
    '.calibrate',
    '.stage',
  ]) {
    assert.ok(
      clientCss.includes(selector),
      `Gameplay CSS positive control missing: ${selector}`,
    );
  }
  const clientCode = artifacts
    .filter(
      (file) => file.path.startsWith('client/') && file.path.endsWith('.js'),
    )
    .map((file) => file.content)
    .join('\n');
  for (const label of [
    'AIM SETTINGS',
    'Save session report',
    'Snapshot starvation events:',
    'Start round',
  ]) {
    assert.ok(
      clientCode.includes(label),
      `Gameplay UI positive control missing: ${label}`,
    );
  }
  for (const path of ['.openai/hosting.json', 'server/wrangler.json']) {
    assert.ok(
      artifacts.some((file) => file.path === path),
      `Deployment artifact missing: ${path}`,
    );
  }
}

/** Build-time guard: observe loaded module IDs before any name minification. */
export function productionBundleBoundary(): Plugin {
  let root = '';
  return {
    name: 'controlla-production-boundary',
    apply: 'build',
    configResolved(config) {
      root = config.root;
      // Old reports cannot make a partial build look complete.
      rmSync(join(root, auditDirectory), { recursive: true, force: true });
    },
    generateBundle() {
      const report: BundleReport = {
        environment: this.environment.name,
        moduleIds: [...this.getModuleIds()]
          .map((id) => relative(root, id).replaceAll('\\', '/'))
          .sort(),
      };
      assertProductionModules(report);
      mkdirSync(join(root, auditDirectory), { recursive: true });
      writeFileSync(
        join(root, auditDirectory, `${report.environment}.json`),
        JSON.stringify(report),
      );
    },
  };
}

function files(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? files(path) : [path];
  });
}
export function verifyProductionBuild(root: string): void {
  const directory = resolve(root, 'dist');
  const reports = files(join(root, auditDirectory))
    .filter((path) => path.endsWith('.json'))
    .map((path) => JSON.parse(readFileSync(path, 'utf8')) as BundleReport);
  const artifacts = files(directory)
    .filter((path) => /\.(?:css|js|json|html|map)$/.test(path))
    .map((path) => ({
      path: relative(directory, path).replaceAll('\\', '/'),
      content: readFileSync(path, 'utf8'),
    }));
  assertProductionEvidence(reports, artifacts);
}
