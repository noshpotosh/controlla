# Controller and developer-tool ownership

Implemented on `codex/controller-tools-ownership-0928`, based on accepted shell checkpoint `052ca73`. Developer-tool consolidation is checkpoint `69d82da`; controller/layout consolidation follows as a separate checkpoint. This is an ownership migration with no gameplay, wire-format, dependency, hosting or deployment change.

## Ownership and interfaces

- `src/client/devtools/` owns the development entry/routing/styles and the designer, gallery, preview, motion lab and game harness subdirectories. Existing tool URLs and development endpoints remain unchanged.
- `src/client/controls/` owns the dependency-free controller API, React-free resolver/registry, reusable views/kit and layout algorithms. Saved JSON layouts and their generated index live in `layouts/`. Control/layout/action terminology and all exported contract names are preserved.
- The former harness API, screen, session and catalog forwards are removed. Harness fixtures and tests import the actual production owners; colocated controller tests remain discovered by the architecture test wrapper.
- Motion Lab still uses the shell's observation-only extension. Runtime motion sampling, shared trace types, Node scripts and Vite middleware retain their existing owners.
- `control:new` retains its CLI syntax and writes/registers controls only at the new owner. The designer creates/saves/deletes JSON at the new catalog; emitted imports are relative to that catalog.

## Enforcement

Existing TypeScript-resolved graph checks cover imports, type edges, aliases, re-exports, literal dynamic imports and indirect helpers. Every production source graph excludes the complete developer-tool directory; injected negative cases exercise both direct and indirect leaks. The headless harness may use production runner APIs while excluding tool UI and shell/network ownership. Controller contracts and resolver remain portable to Node/headless consumers.

Production Tailwind scanning excludes the complete tool directory. Client, SSR, RSC and emitted-asset audits reject developer code/styles and require the relocated gameplay modules and production calibration/diagnostics/report UI. Retired locations have no forwarding aliases.

## Validation and recovery

- 241 tests pass, including existing actual stick/dpad scaffold-copy/typecheck tests and a new generated-catalog import regression covering creation/deletion at the new location.
- Typecheck, project lint and production build/bundle audit pass. The development harness returns 200; production root returns 200 and the harness returns 404. Production gallery query parameters retain the ordinary application.
- Designer endpoint acceptance used disposable `ownership-probe`: create returned 201 at the new path, save returned 200, the open preview changed from `MIGRATION PULSE` to `LIVE SAVE VERIFIED` without navigation, and deletion returned 200 and removed both JSON and index entry. The retired layout directory was never recreated.
- Gallery Fire and designer PULSE readouts incremented; preview rendered aim/PULSE and its orientation guard; Motion Lab opened through the injected extension; the harness completed with awards and game state. Exact room/report observations and remaining device gaps are recorded in [VALIDATION](../VALIDATION.md).

Each stage is committed and pushed to the explicit topic branch. Reverting the migration commits restores the accepted shell baseline without protocol or data conversion. Retain this worktree and the shell branch until integration; no merge to `main` or deployment is included. Other worktrees and rebrand/menu changes are outside this series.

The subsequent [shared contract slice](SHARED-CONTRACTS.md) inventories remaining core modules by actual browser/backend consumers and extracts the narrow shared boundary. Sensor-provider lifecycle, physical phone/TV/network acceptance, runtime decomposition, new games and visual redesign remain separate work.
