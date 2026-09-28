# Project organization and game extensibility: meta plan

Status: original planning draft, prepared against the repository on 2026-09-27. Current implementation now includes the [shell boundary](architecture/NEXT-SHELL-BOUNDARY.md), [controller/tool ownership](architecture/CONTROLLER-TOOLS-OWNERSHIP.md), the [shared contract boundary](architecture/SHARED-CONTRACTS.md), [browser-engine ownership](architecture/ENGINE-OWNERSHIP.md), [controller motion lifecycle](architecture/MOTION-PROVIDER.md), [display playback](architecture/DISPLAY-PLAYBACK.md), [controller input](architecture/CONTROLLER-INPUT.md), and [session routing](architecture/SESSION-ROUTING.md); use the linked ownership and evidence records for current paths and acceptance.

The first planning slice is now recorded in the [baseline and ownership map](architecture/BASELINE.md), [runnable author walkthrough](architecture/AUTHORING.md), and [decisions and experiment evidence](architecture/DECISIONS-EXPERIMENTS.md). The original experimental harness did not replace the production shell. The next live slice promotes its contracts/round runner into the default production catalog, with a narrow screen boundary and authoritative session progress; unrelated directory moves remain deferred. The follow-up closes reliable-input validation, adds framework-owned 200 ms round settling, and isolates developer tools from production builds; its evidence gates and ordered migration backlog live in the same records.

This document defines the planning work needed to reorganize Controlla around independently developed minigames, reusable controllers, a game screen, and isolated authoring tools. It is not an implementation specification. Directory names, API shapes, packaging, and migration order below are proposals to test before committing to a refactor.

The desired developer experience is simple: create a game in its own directory, select and configure existing controllers, implement game rules and presentation, and report results through supported APIs. Develop and test that game outside the full shell, then register it without editing framework internals.

## 1. Direction already established

Treat these as requirements for the next planning pass:

- Separate the shell from minigames. The shell assembles the application and handles joining, navigation, game selection, and session transitions.
- Give controllers their own directory and extension contract. Controller authors implement reusable controller types; game authors select and configure them.
- Give the game screen its own directory and public integration API for game presentation and shared player UI.
- Provide an API for game results, point awards, and progress across minigames, with room for later session features.
- Isolate the input workshop, builder, and related development tools so frequent changes there have a small integration surface.
- Group browser-facing domains under a clear `client/` boundary and keep backend code separate.
- Make navigation and parallel development easier through explicit ownership and dependency rules, not only file moves.

First-slice decision: independent development means a game folder in this repository plus a standalone harness, with games bundled together. Separately buildable packages, separate repositories and independently deployed bundles remain deferred. Final production loader and package boundaries still depend on the experiment evidence.

## 2. Original discovery baseline

The original prototype contained boundaries worth preserving, but adding a new game crossed several of them. This inventory records that starting point; the linked baseline and evidence records track the implemented live-catalog changes:

- The former `src/client/App.tsx` combined joining, controller UI, game selection, display UI and diagnostics. That historical file is now split into [`src/client/shell/`](../src/client/shell/), with explicit ports and composition-owned catalog metadata.
- [`src/client/runtime/runtime.ts`](../src/client/runtime/runtime.ts) coordinates transport, host authority, controller input, motion, presentation, audio, and reports. Legacy widgets and display components receive this broad runtime; reusable library controls already use a narrow `ControlPort`.
- [`src/core/config.ts`](../src/core/config.ts) combines built-in game manifests with reusable capability checks and controller resolution. The declarative input requirements are a useful starting point for the controller library.
- [`src/games/engine.ts`](../src/games/engine.ts) declares `GameContract`, but both games live inside one `PartyGame` implementation. [`src/core/session.ts`](../src/core/session.ts) constructs that concrete class and reads its state directly.
- [`src/core/types.ts`](../src/core/types.ts) combines identity, wire messages, controller schemas, and game state. `GameState` includes fields specific to the current games. The spike extracts a generic snapshot timeline in [`src/core/snapshots.ts`](../src/core/snapshots.ts), while the live application retains the current games' interpolation in a compatibility policy.
- [`src/client/GameCanvas.tsx`](../src/client/GameCanvas.tsx) and [`src/games/renderer.ts`](../src/games/renderer.ts) separate rendering from simulation, but still contain knowledge of specific games. Shared countdown, results, and player cursors are useful seeds for a game-screen module.
- The session records completed round results, with a bounded history. That is a foundation for progress tracking, not yet a general API for cumulative session points.
- [`src/client/devtools/motion-lab/MotionLab.tsx`](../src/client/devtools/motion-lab/MotionLab.tsx), [`src/core/motion/trace.ts`](../src/core/motion/trace.ts), replay scripts, and a development upload handler inside [`vite.config.ts`](../vite.config.ts) form the existing recording/replay tools. The original control library already included a gallery, layout designer and room-free phone preview. The [current control library](../src/client/controls/README.md) and [browser tools](../src/client/devtools/) now have separate owners; their production/development import and style boundaries are enforced.
- [`server/`](../server/) already owns room identity, signaling, and relay. It imports some types and constants from `src/core`. Gameplay authority currently lives in the host browser, not this service.

Use [`spec.md`](../spec.md), especially sections 6–8, as prior intent; use [ADR 001](ADR-001.md) for the prototype's decisions and caveats. Record differences between those documents and actual behavior during discovery. The existing [validation ledger](VALIDATION.md) remains the source for unverified device and latency claims.

## 3. Candidate ownership map

Use this tree to discuss responsibility. Final paths and package boundaries are outcomes of the planning process; a directory need not become a workspace package.

```text
client/
  shell/             # Application composition, join flow, navigation, game selection
  controllers/       # Controller library, phone UI, sensors, capability resolution
  game-screen/       # Display host, player overlays, countdowns, results presentation
  minigames/
    <game-id>/       # One game's manifest, rules, state, renderer, assets, tests
  engine/            # Runtime session, lifecycle, input routing, clocks, replication
  devtools/          # Input workshop, controller builder, previews, recording/replay UI
  api/               # Public game, controller, display, and session-service contracts
  ui/                # Deliberately shared presentation primitives
backend/             # Existing room/signaling/relay service and its adapters
shared/              # Only contracts/utilities genuinely shared across client and backend
app/                 # Thin framework entry points, if required by the current scaffold
docs/                # Navigation guide, API guides, decisions, planning documents
tests/               # Cross-domain integration tests and shared fixtures
```

Proposed distinctions to validate:

- **Shell versus engine:** the shell decides what experience to show; the engine runs the session and coordinates game lifecycles. Games do not reach into either implementation.
- **Controller library versus game:** the library owns input behavior and device details. Games declare semantic actions and choose supported controls or presets. The planning pass must decide what “controller type” means: a primitive input, a composed layout, or both.
- **Game screen versus game renderer:** the screen owns common presentation and hosts a game's renderer. The game owns its scene and game-specific HUD. Decide which overlays games may configure or replace.
- **Engine versus development tools:** runtime functionality required to play belongs in `engine/` or `controllers/`. Editors, experiments, recorders, and harness UI belong in `devtools/`. Reusable production input algorithms must not depend on the workshop that tests them.
- **Client/backend versus execution authority:** renaming `server/` does not move game simulation to a server. Preserve host-browser authority unless a separate decision changes it.
- **Public API versus shared code:** `client/api/` describes the author-facing contract; `shared/` holds the small client/backend overlap. Neither should become a replacement catch-all for `core/` or `utils/`.

Framework-mandated files, deployment adapters, and Node-based devtool scripts may need to stay outside `client/`. Place any extracted development middleware or replay CLI with a deliberate tooling owner; keep its browser and Node entry points separate. Inventory styles, generated UI components, assets, tests, build aliases, and configuration alongside source files so root-level clutter is actually addressed.

### Dependency rules to prove

The shell is the composition point: it can register games and connect implementations. Minigames consume public APIs and their own code/assets. They must not import shell, concrete controller widgets, live transport, session internals, or development-tool implementations.

The engine, controllers, and game screen should communicate through narrow contracts. Public contracts must not import their implementations. Development tools consume production APIs; production game execution must not require development tools. The backend must not import client implementation modules. Shared contracts must remain usable without React, the DOM, or Node-only APIs.

Choose an enforceable import policy during detailed planning. Decide where type-only interfaces are sufficient and where runtime validation is required. A large shared barrel that exposes everything would defeat these boundaries.

## 4. Plan the developer journeys first

Write these walkthroughs before designing detailed interfaces:

1. **Game author:** scaffold a game, select a controller preset or composition, bind actions, implement rules and rendering, run locally with simulated players, report results, and register it in the shell.
2. **Controller author:** implement an input type, describe its configuration and output, handle permissions and cancellation, demonstrate fallbacks in the workshop, and add it to the library without changing games that do not use it.
3. **Game-screen contributor:** change common player/status/results presentation without editing each game's rules or phone UI.
4. **Tooling contributor:** change the workshop or builder, preview an existing controller, and export a valid configuration without editing the shell or introducing another production input implementation.

For each journey, name the files the developer is expected to touch, the APIs they use, the local command/harness they run, and the evidence that integration works. Include error paths, not only a successful demo.

**Output:** a short authoring guide draft and a list of friction points. Do not treat a folder diagram as proof that independent authoring works.

## 5. Contract planning workstreams

These workstreams should produce small design documents and examples. Controller, display, and tooling exploration can proceed in parallel once shared vocabulary and authority are agreed. API review and migration sequencing happen together.

### A. Game contract and registration

Decide what a game exports: metadata, controller requirements, lifecycle hooks, rules, serializable state, rendering, and results. Separate framework session metadata from game-owned state rather than expanding a common state object with every game's fields.

Resolve loading/readiness, start/stop/disposal, disconnect policies, failure reporting, and asset ownership. Define input semantics without exposing packet layouts or requiring authors to understand config generations. Determine who describes snapshot interpolation, how discrete values remain discrete, and how events reach presentation without granting it authority.

Choose the initial registration mechanism and version compatibility rules. Distinguish independent development from sandboxing: bundled modules, separate packages, and isolated execution solve different problems. Do not select remote bundle loading or iframe isolation solely to achieve a cleaner directory tree; the existing browser-measurement question remains open.

Evaluate per-game and per-controller descriptors with a small composition step so adding extensions does not create another large central switch or frequent merge conflict.

**Output:** a draft game contract, one sample game using only that contract, and the exact proposed integration change needed to add it to the catalog.

### B. Controller APIs and library

Design two related surfaces:

- **For game authors:** choose library inputs/presets, bind named actions, configure supported options, declare capabilities/fallbacks, and consume typed semantic values. Ordinary game work should require no phone UI or sensor implementation.
- **For controller authors:** implement a reusable provider/widget with configuration validation, value/event definitions, permission handling, start/stop/reset behavior, fallback behavior, and a preview fixture.

Decide whether games configure primitive widgets, complete controller layouts, or layered presets; how per-player/role layouts work; and which settings belong to players rather than games. Specify units, ranges, coordinates, continuous values versus discrete actions, timestamps, cancellation, and reconfiguration behavior.

Audit current limits before promising generality: the primary frame has one coordinate pair and four discrete action slots, generic widget values take a separate path, and high-rate drawing has unresolved transport needs. Use examples with two independent axes/actions and more than two controls to test whether the existing resolver/layout and input model generalize. New controller needs should become explicit library work, not hidden per-game phone code.

**Output:** controller selection/configuration examples, a provider contract, a capability/fallback matrix, and a list of wire-protocol changes that would require separate migration work.

### C. Game-screen API

Define what the framework supplies to a game renderer: a render surface, viewport/coordinate rules, player identity, presentation time, read-only state, and presentation events. Decide what the game supplies back and how rendering is mounted, resized, reset, and disposed.

Assign ownership for player names/colors, local cursors, shared scoreboards, countdowns, results, fullscreen behavior, audio, and game-specific HUD. Replace checks for particular game IDs with a documented capability or presentation policy where justified. Preserve the distinction between immediate local cursors and synchronized shared state.

Evaluate the existing Canvas 2D renderer as the first supported adapter. Broader rendering frameworks are an open extension question, not an automatic requirement for the first API.

**Output:** screen/renderer contract and a composition sketch showing both a pointer game and a game without cursors. Include evidence that host and remote displays render through the same snapshot boundary.

### D. Session services, points, and progress

Plan this as a separate API responsibility even if developers access all APIs through one SDK. The screen presents progress; an authoritative session service validates and records it. A remote display or phone must not independently award points.

Distinguish game-local measurements/scores, a round's outcome/ranking, and cumulative session points. Reaction time and racing scores are not automatically comparable. Decide whether games submit outcomes for a shared policy to convert, submit explicit award requests, or use a constrained combination. Define who owns that policy.

Resolve ties, team/cooperative outcomes if in scope, disconnected players, aborted rounds, rematches, and invalid/late submissions. Identify rounds independently from game IDs and define how duplicate completion or award messages are recognized so retries cannot credit points twice. Decide whether intermediate awards are needed or final results are sufficient for the first version.

Set the intended lifetime of progress: live session only, retained on host loss, exportable history, or durable storage. Persistence and host migration are separate feature decisions; neither follows automatically from “track progress.” Leave room for future services without exposing the entire runtime through an unrestricted context object.

**Output:** a points/progress decision record, example outcomes and awards across two different games, and acceptance scenarios for duplicate results, repeated games, ties, and aborted rounds.

### E. Workshop, builder, and development engine tools

Inventory existing Motion Lab, recording, replay, input tuning, and diagnostics separately from the proposed builder. Decide which tools players need during normal play and which are developer entry points.

Define the builder's artifact: preferably a configuration validated by the same schema as handwritten game configuration. Decide how presets are saved/versioned, how previews simulate capabilities, and how input replay and simulated players share production behavior. Keep generated exports separate from human-authored controller implementations.

Use this workstream to plan churn isolation: domain-local components/styles/tests, a small tool entry point, and narrow adapters for host integration. Determine where recording fixtures and Node upload/replay tooling live. Avoid a workshop implementation that forces every experiment through `App.tsx`, `runtime.ts`, global CSS, or root build configuration.

**Output:** existing-to-proposed tooling map, an initial workshop scope, a configuration import/export example, and a list of stable integration points owned jointly with the controller API.

## 6. Planning sequence and decision gates

### Pass 1 — Establish the baseline

Map current modules, imports, runtime roles, data flow, styles, scripts, and tests. Note active work likely to collide with moves. Document the intended owner of each area and identify temporary adapters that could preserve behavior.

Record the baseline automated-check results before implementation begins, including pre-existing failures, so migration regressions can be distinguished from current limitations.

**Done when:** every current area has a proposed owner; known limitations are carried forward; the team agrees what must remain behaviorally unchanged during extraction.

### Pass 2 — Agree vocabulary and author experience

Walk through the four developer journeys. Settle what independence means, what a controller type is, and where shell, display, session, and game responsibilities meet. Keep unresolved issues in a decision log with an owner and the evidence needed to decide.

**Done when:** a game author's expected work can be described without asking them to implement a controller or import application internals.

### Pass 3 — Sketch contracts and challenge them

Develop workstreams A–E with small usage examples. Review the complete flow: configured control → semantic input → game rules → snapshots/events → display → authoritative outcome/award → session progress.

**Done when:** each step has an owner, data contract, failure behavior, and authority boundary. No essential step depends on an unexplained shared runtime object.

### Pass 4 — Run bounded architecture experiments

Plan short experiments that answer specific questions, not a preliminary rewrite:

1. Run an existing game through proposed interfaces in a local harness with fake players, clock, and input.
2. Create a tiny third game with its own state shape, select only library controls, render through the screen contract, and finish through the session API. Add it using only its directory and the agreed registration surface.
3. Add or adapt a controller library entry and preview it in the workshop without changing unrelated games or the shell.
4. Complete two rounds using different games and exercise duplicate completion, ties, and an aborted round against the proposed progress policy.

For each experiment, record the question, expected evidence, observed limitations, and whether it justifies keeping or changing the proposed boundary. Set a timebox when assigning it. Experimental code need not become production code.

**Done when:** the independence claim is demonstrated and contract weaknesses have been fed back into the designs.

### Pass 5 — Produce the implementation plan

Only after the previous gates, settle the directory/package structure and split the work into reviewable slices. A likely sequence is contract/adaptor extraction, one game migrated end to end, remaining game separation, controller and screen extraction, tooling isolation, then deletion of compatibility paths. Change that order based on the dependency map.

Keep mechanical moves distinguishable from behavior changes. Plan how imports, aliases, scripts, framework entry points, deployment paths, fixtures, and documentation change together. Assign ownership of shared registration/API files and coordinate moves around active branches. Each slice needs its own validation, compatibility/rollback approach, and completion condition.

**Done when:** implementation tickets can be executed with bounded scope and without redesigning the architecture inside each ticket.

## 7. Evidence required from the eventual refactor

The detailed plan should turn these into explicit acceptance checks:

- A new game can be developed in a harness using documented public APIs, then integrated without editing controller, shell UI, networking, or engine internals. Only the agreed registration step is allowed outside its game directory.
- Choosing and configuring existing controls requires no controller implementation. Adding a controller type is a separate library contribution.
- A game's custom state does not require adding game-specific fields or branches to shared engine/screen modules.
- Score presentation cannot mutate authoritative progress. Retried outcomes do not produce duplicate awards, and consecutive rounds of the same game remain distinct.
- Workshop changes stay within its module and intentional adapters; gameplay does not depend on the workshop being loaded. Decide and verify whether production bundles exclude developer UI entirely.
- Import rules catch forbidden dependencies, and each public extension contract has a useful conformance example or test.
- Existing protocol/lifecycle/room/runtime/pointer/replay coverage remains meaningful. Run `npm test`, `npm run typecheck`, `npm run lint`, and `npm run build` for code migration slices, with targeted new checks for contracts and awards.
- Preserve config acknowledgment and stale-input rejection, disconnect/reconnect behavior, host-loss handling, controller switching, snapshot-only remote rendering, and the local-cursor path. Repeat relevant device checks when input, rendering, or timing changes; a passing build does not certify latency or mobile behavior.
- A contributor can find the home of shell, controllers, screen, games, runtime, tools, and backend from the README, with colocated ownership guides where useful.

## 8. Deliverables from the next planning round

Keep these documents small and link them rather than growing this meta plan into a replacement specification:

1. A current dependency/ownership map and accepted target directory map.
2. A game-author walkthrough and independent development/harness proposal.
3. Draft contracts and examples for games, controller selection/providers, screen rendering, and session services.
4. A decision log covering unresolved scope, packaging, state/interpolation, points policy, progress lifetime, and tooling boundaries.
5. Results from the bounded experiments, including rejected assumptions.
6. A staged migration backlog with owners, dependencies, acceptance checks, and compatibility removal tasks.

Use a consistent planning-item format: **question → options → proposed decision → evidence needed → owner → dependencies → acceptance check → deferred scope**.

The first planning session should settle independent development scope and walk through one game authoring example. That gives the controller, screen, session, and tooling discussions a shared concrete case before anyone begins moving directories.
