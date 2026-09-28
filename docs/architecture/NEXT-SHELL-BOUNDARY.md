# Next architecture slice: shell ownership and runtime ports

Status: proposed follow-on to **Controller API cleanup after Neon Harvest**. This document plans implementation; it does not claim that cleanup or its acceptance gates have finished. Prepared on 2026-09-28 against the shared `codex/architecture-spikes` working tree.

## Recommendation and evidence

Extract the application shell into `src/client/shell/` and replace UI access to the concrete `Runtime` with explicit, limited ports. Preserve the existing game, controller and screen contracts. This is the first bounded implementation of item 3 in the [ordered backlog](DECISIONS-EXPERIMENTS.md#ordered-next-backlog), following the controller-owned contracts/resolver work.

The remaining coupling is concrete:

- `src/client/App.tsx` combines join/resume and runtime lifetime, controller screens, host/display screens, standings, optional browser room inspection, and diagnostics in roughly 900 lines.
- `ControllerMenu.tsx` and `Widgets.tsx` receive the complete runtime. UI code reads `runtime.motion`, `runtime.options.endpoint`, `runtime.buffer.starvations` and the broad mutable `runtime.view`.
- `GameCanvas.tsx` already consumes the two-method `ScreenPort`. The presenter, immutable snapshots and authority exclusion have regression coverage. Reuse this boundary.
- `scripts/development-entry.ts`, `tsconfig.json`, production bundle assertions and architecture tests name current entry/component paths. Moving UI requires updating those integration points together.

Separating engine/core/shared/backend first would touch transport, timing and authority before removing the shell's access to them. Moving folders alone would preserve that access. The shell boundary gives later engine and controller moves a smaller consumer surface.

## Prerequisite and scope

Prepare this plan while controller cleanup runs. Begin implementation only from an identifiable checkpoint containing completed controller cleanup and its recorded acceptance. Record the actual baseline and outstanding device/network gaps; do not reuse a historical test count as a target. If its browser gate remains open, finish that prerequisite before starting this migration.

Consume the final `src/controls/api.ts`, `resolve.ts` and `controllerSpec` surfaces from that checkpoint. Do not recreate the deleted core resolver or compatibility exports. Keep Neon Harvest the sole production game; preserve protocol 4, layout schema 2, resolved configuration schema 1 and the binary input frame.

The slice changes application composition and UI dependencies. Runtime, network, authority, sensor sampling and transport implementations keep their current homes. Production diagnostics, calibration and report download remain available. Screen presentation timing, 200 ms settling, awards and reconnect policies stay unchanged.

## Ownership and contracts

Use `src/client/shell/ports.ts` for repository-local, type-only UI contracts. These are application interfaces, separate from the game-author API and reusable controller-author API. Do not export `Runtime`, `RuntimeView`, `Pick<Runtime, ...>`, `Message`, `Network`, `Motion`, the snapshot buffer or authority through them.

Define only the data and commands existing screens consume:

- **Session view and lifecycle:** subscribe/unsubscribe, a read-only UI snapshot, connection status/warnings, safe identity fields, roster, phase, selected round metadata, and end-of-session state. The composition owner controls start/close and resume tokens; view components do not receive stored credentials.
- **Room actions:** host start/abort, audio unlock, warning reporting, report export and phone-link connection information. Expose host actions only to the host screen; retain existing authority checks underneath. Catalog composition provides display metadata, not game factories, to the game picker.
- **Phone actions:** motion enablement, aim settings, sensitivity, recenter, local pointer preview, and existing generation-bound `ControlPort` creation. Pass fallback widgets a control port plus the specific preview/status values they need.
- **Diagnostics:** typed read-only rows and metrics, plus the existing measured panel-latency setter and report action. Project the current telemetry rather than passing raw wire envelopes. Read starvation counts through `snapshotMetrics()`, which already exposes them.
- **Presentation and tools:** pass the existing `ScreenPort` to `GameCanvas`. Preserve the current observation-only motion diagnostics extension; move its concrete `Motion` adaptation into the runtime bridge. Developer UI remains supplied by `DevelopmentApp`.

Put concrete adaptation in `src/client/shell/runtime-adapter.ts`. It creates/owns the runtime and delegates existing operations. It is the only production module within the shell allowed to import the concrete runtime. Keep it free of React and UI imports; it may import shell contract types. The shell entry composes this adapter and the catalog, then passes narrow props/ports to views. It also supplies the configured `GameCanvas` as a screen slot to `RoomScreen`, keeping catalog-dependent screen composition out of that view's import graph.

Reuse controller-owned contract types and the existing screen port. Enumerate any temporarily permitted type-only room/identity dependencies from `core/types.ts`; do not turn this into a shared-type migration. The ports themselves have no implementation dependencies.

Snapshots must be detached read-only UI projections, not aliases to mutable runtime collections. Preserve the current subscription cadence and keep component rendering free of transport work. Keep session adapters, command functions and the `ScreenPort` stable for the joined session; `GameCanvas` resets its renderer when its port identity changes. Do not sample `ScreenPort.advanceFrame()` to construct a shell view: sampling currently drives presentation/audio and belongs to the canvas. Derive standings from the already sampled presentation revision using the existing policy. Avoid cloning game state or full report history for shell refreshes.

## Three reviewable implementation slices

### 1. Introduce ports and migrate consumers in place

Create the contracts and adapter before relocating components. Replace runtime props and internal reads in `App`, `ControllerMenu`, `StatusToast`, `LegacyWidget`, pointer preview and diagnostics. Separate extension types from concrete motion adaptation. Keep the existing rendering and subscription behavior while changing the dependency surface.

Preserve controller remount identity exactly: configuration ID, generation and local input epoch. Bind ports to the generation/lifetime at creation; never forward an old callback by substituting the latest configuration. Keep motion/audio/fullscreen activation in the originating user gesture.

Add initial import enforcement against the existing file locations before moving them. Completion: existing production UI uses explicit ports, the adapter is the only shell-side concrete runtime consumer, and focused adapter/lifecycle/input tests pass. Avoid adding parallel state machines or a generic command bus.

### 2. Establish shell ownership and split views

Move/split the application into this bounded structure (component names may follow existing conventions):

```text
src/client/
  shell/
    App.tsx                 # composition, join/leave, session ownership
    ports.ts
    runtime-adapter.ts
    JoinScreen.tsx          # form, URL defaults, resume choice
    ConnectedShell.tsx      # subscription and role routing
    RoomScreen.tsx          # host/display chrome and game selection
    ControllerScreen.tsx    # waiting, settings, layout and ended states
    ControllerMenu.tsx      # session menu and status toast
    LegacyWidget.tsx        # existing fallback adapter using narrow props
    DiagnosticsPanel.tsx
    standings.ts
    extensions.ts          # injected UI extension contract
  GameCanvas.tsx            # existing screen adapter; relocation deferred
  runtime.ts                # existing implementation
  network.ts
  motion.ts
```

Phone session chrome belongs to the shell in this slice. Reusable primitives, layouts and resolution remain controller-owned. The existing fallback widget implementation is retained; completing the control library is separate work.

Update the app-entry alias, TypeScript path, development wrapper, imports, tests and production module positive controls together. `app/page.tsx` remains a thin framework entry. Remove superseded UI files after migration; finish without forwarding aliases at old paths. Preserve current CSS selectors, styles, routes, query parameters and accessible labels; a visual redesign is outside this slice.

Completion: join, room, phone and diagnostics contributors can find their views without editing runtime internals, and both development and production entries use the new shell.

### 3. Enforce boundaries and close acceptance

Extend the existing TypeScript-resolved import checks rather than introducing a second checker. Cover imports, re-exports, aliases, type imports and literal dynamic imports. Reject direct or indirect escapes from shell view modules into runtime, network, motion, authority, engine implementation, concrete game implementations or developer tools. Treat the entry and runtime adapter as explicit composition exceptions, not directory-wide exemptions. Ports may import only their enumerated contract dependencies.

Preserve existing game, controller and screen enforcement. Runtime/engine/controller/screen implementations must not import shell views; the adapter imports contract types only. Keep allowed composition paths explicit so legitimate entry-to-catalog and entry-to-adapter edges do not weaken leaf-view checks. Update path-based positive controls rather than deleting assertions to make moves pass.

Run the full suite, typecheck, lint and production build from the completed branch. Observe the focused browser flow below and record actual evidence. Update README navigation and the three architecture records at delivery, after the cleanup owner finishes its updates.

## Acceptance scenarios

1. **Session ownership:** one runtime per join; back/leave/unmount closes it and unsubscribes. Repeated join/leave, development remounts and failure/retry do not leave duplicate connections, timers, event listeners or pointer-preview animation loops. Preserve phone touchmove suppression and restore the previous body overscroll behavior on exit. Preserve optional room-inspection registration and cleanup.
2. **Boundary behavior:** adapter snapshots cannot mutate runtime state; views have no broad runtime escape. Commands delegate correctly, errors reach current warnings, and non-host views have no start/abort controls. Tests use small fake ports where possible.
3. **Phone lifetime:** held aim and simultaneous PULSE work; permission denial selects the accepted fallback; settings/recenter work. Configuration replacement, suspension and reconnect invalidate old ports and preserve generation/epoch remounting. Retain stale callback, captured activation and deduplication coverage.
4. **Presentation and progress:** a host, remote screen and two simulated controllers complete a round and rematch; abort adds no points. Delayed display standings reveal totals only at the accepted presentation revision. No duplicate marker acknowledgments, historical audio replay or extra frame sampling comes from the new shell adapter. Preserve immediate local cursors and report download after host loss.
5. **User flows and bundle:** join/resume links, connecting/error/ended states, fullscreen, calibration, diagnostics and reports retain behavior. Gallery/designer/phone preview and the motion extension work in development; production retains Neon and required control/screen assets, excludes developer code/CSS, and serves `/dev/game-harness` as 404.

Preserve the cleanup suite and add meaningful adapter/subscription/import regressions. Record unobserved browser or physical-device checks as pending. Architecture checks do not establish phone, TV or cross-household latency claims.

## Decision record and handoff

**Question →** Which ownership boundary follows controller cleanup? **Options →** mass directory relocation; engine/core/shared split first; or shell extraction with narrow runtime ports. **Proposed decision →** shell extraction first, preserving live behavior and existing APIs. **Evidence needed →** dependency checks, adapter/lifecycle regressions, complete baseline checks and the focused browser flow. **Owner →** one shell/integration engineer, with controller and engine owners reviewing their ports. **Dependencies →** accepted controller-cleanup checkpoint and its recorded Neon acceptance. **Acceptance check →** views consume only UI contracts/props, the game screen stays read-only, and all required flows and production exclusion checks pass. **Deferred scope →** runtime decomposition, sensor-provider lifecycle, controller/tool directory relocation, shared/backend extraction, new games, rebranding, packages, remote bundles, persistence, host migration and deployment.

Keep contract migration, mechanical moves and enforcement/evidence distinguishable for review. A reviewer can revert the shell series to the controller-cleanup checkpoint without a protocol migration. Do not mix unrelated working-tree changes into that rollback.

After this slice, assess moving the stable controller/layout and developer-tool domains, then dividing remaining `core` modules by actual browser/backend consumers. Use the reduced runtime consumer surface to plan engine relocation separately. Physical-device acceptance can be prepared independently against a fixed accepted build.
