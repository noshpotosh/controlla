# Roadmap: stable foundations to a party-game collection

Audit reference: `develop` at `ef42cdf`, reviewed on 2026-10-07 by reading
code and configuration. Tests were not run for this documentation revision;
historical validation is not a current pass. That pre-implementation audit is
preserved below; the current foundation status supersedes its gaps.

Current foundation status (2026-10-07): milestones 0–1 are implemented and verified
on codex/milestone-1-foundation-1007 from develop 4a885029. Final gates pass:
470 full tests, 192 game tests, typecheck, lint and production build; scaffold and
registered-jolt extension proofs pass. See [acceptance](acceptance/MILESTONE-1.md)
and the [requirement audit](acceptance/MILESTONE-1-AUDIT.md). Browser evidence is
recorded with physical sensor/haptic and hosted-route limits; those later checks
remain milestone 2. No deployment, merge or later roadmap milestone is included.

The direction is **finish the foundation, validate hosted play with the existing
games, establish one unified visual style, experiment with games, and build a
party-session metagame**. Investigate standalone phone delivery against the
hosted baseline without committing to a native app prematurely.

## Decisions and boundaries

Confirmed direction:

- Finish the foundation before starting the new-game backlog. Small proof games
  and input fixtures are foundation validation, not backlog implementation.
- Make motion inputs registered modules with a shared lifecycle and conformance
  tests; prove the extension seam with `jolt`.
- Target private, multi-household hosted playtests first.
- Choose one unified art direction for the game collection, including its phone
  controls and display UI.
- Begin the metagame with a bounded party session, cumulative standings and a
  final winner. A board-game layer and persistent progression are later work.
- Compare browser, installable PWA, native wrapper and native app before choosing
  standalone phone delivery.

Implementation defaults for the foundation: game-owned turn order, per-player
roles fixed for a round, early completion, untimed presentation with a finite
safety deadline, and bounded phone feedback. Their exact API signatures and
migration details were reviewed in milestone 0 and implemented in milestone 1.
The approved coordinated migration uses protocol 5, ControllerConfig 2 and snapshot
schema 2. The application is unreleased; older-client support is unnecessary.

This roadmap does not authorize a deployment, paid service purchase or public
launch. Those actions belong to the later hosting implementation. The original
roadmap audit was limited to this document; the foundation implementation follows
the separately approved milestone-1 plan and contract review.

## Historical pre-implementation evidence and gaps

| Area | Existing foundation | Gap to close |
| --- | --- | --- |
| Game authoring | [Author API](../src/client/api/index.ts), game-owned folders and one [catalog](../src/client/minigames/catalog.ts); Neon Harvest and Whack-a-Mole are registered. [Boundary tests](../tests/architecture-boundaries.test.ts) enforce imports. | Fixed-duration rounds, one controller requirement set per game, no game-to-phone feedback; no `game:new`. Production checks and catalog tests still name individual games. |
| Touch and motion | Six library touch controls, a control scaffold, validated layouts and capability fallback. | Motion inputs still cross runtime, controls and shell boundaries. Legacy widgets and input-specific shell members prevent a consistent extension path. |
| Harness | [GameHarness](../src/client/devtools/game-harness/harness.ts) uses the production round runner, controller resolution and snapshot machinery with simulated players and displays. | Simulation does not certify browser permissions, real sensors, the complete input/transport path or physical latency. Replay configuration and shared scenario helpers need a supported interface. |
| Determinism | Neon Harvest's [game tests](../src/client/minigames/neon-harvest/game.test.ts) repeat a scripted simulation and compare state/outcomes. Recorded motion replay also exists. | Shared conformance across games and modes is missing. Seeds currently derive from round start time; session identity is nondeterministic and must be controlled in full replay tests. |
| Test discovery | [CI](../.github/workflows/ci.yml) runs typecheck, lint, `npm test` and the production build. | [`npm test`](../package.json) selects only `tests/*.test.ts`, excluding colocated game and harness-controller tests. `game:test` selects architecture tests, not all game tests. |
| Snapshot limits | [Snapshot validation](../src/client/engine/snapshots.ts) limits game state to **40 KiB** and a complete round snapshot to **47 KiB**. | Shared conformance must enforce both at supported player counts, including eight where supported. Structured-clone success alone is insufficient: live state must be valid bounded JSON. |
| Visual identity | [Controller design guide](design/CONTROLLER-DESIGN.md) and [tokens](../src/client/controls/tokens.css) already standardize phone controls. | No collection-wide game art direction, design bible or reproducible art pipeline. |
| Hosting and acceptance | Signaling, WebRTC, WebSocket relay, diagnostics and [device acceptance tooling](acceptance/LOCAL-IPHONE.md) exist. | No current hosted-service configuration or deployment command. Rooms are in memory; server restart or host loss ends play. Real multi-household and route-specific acceptance remains work. |
| Metagame | [Session progress](../src/client/engine/progress.ts), placement-based awards, round history and standings already exist. | No bounded party-session flow through a playlist to a final winner. |

Conformance must respect each control's behavior. Sticks return to neutral;
[aim-pad retains its position](../tests/aim-pad.test.ts) after release or cancel.
Cancellation must not synthesize activation. A universal “neutralize every
control” rule would break the existing contract.

## Delivery and ownership

Use accountable roles until named people are assigned in milestone 0:
**Foundation lead**, **Inputs owner**, **Game kit owner**, **Hosting owner**,
**Art owner**, **Game owner**, **Phone investigation owner**, and **Session owner**.
One person may fill several roles. Do not start a milestone without a named
accountable owner and reviewers for any shared contracts it changes.

The intended order is 0 → 1 → 2 → 3 → 4 → 6. Milestone 5 can start once the
hosted baseline in 2 exists and does not block the metagame. Within the foundation,
inputs and game-kit work can proceed separately after contract ownership and
interfaces are agreed; integrate and validate both before closing its gate.

Every milestone remains open until its deliverables and named evidence exist.
Record build/commit, commands, devices/routes where relevant, results and unresolved
blockers in its acceptance record. A blocked or unmeasured check is not a pass.

### 0. Establish the baseline and contract decisions

**Owner:** Foundation lead, with Inputs and Game kit owners.
**Dependencies:** none.
**Deliverable:** baseline ledger, contract inventory and ownership/review policy.

- [x] Run and record test, typecheck, lint, build and architecture checks; record
  discovery gaps, actual failures and outstanding physical-device evidence.
- [x] Assign owners across controller contracts, author API, harness, runtime,
  transport and presentation. Include controls and harness compatibility in the
  stability policy. Use CODEOWNERS to express ownership; separately verify the
  repository's review enforcement rather than assuming the file requires both reviewers.
- [x] Inventory semantic values/actions, coordinate spaces, clocks, freshness,
  ordering, capability fallback, configuration acknowledgement, reconnect and
  disposal. Document ownership and the production and test entry points.
- [x] Review lifecycle, role and feedback API changes together, including migration
  of both existing games and harness parity. Keep turn order game-owned.
- [x] Define “freeze” as a stable, versioned contract with reviewed extensions.
  Retain the current protocol unless a concrete requirement forces a coordinated
  bump; preserve incompatible-client reload guidance and stopped retries.

**Acceptance evidence — Foundation baseline:** agreed contracts, named owners,
validation requirements, recorded failures and explicit unverified claims.
**Foundation baseline gate:** complete; verified ownership and actual review-enforcement limits are recorded in the acceptance ledger.

### 1. Finish the foundation

**Owners:** Inputs owner and Game kit owner; Foundation lead owns integration.
**Dependencies:** milestone 0.
**Deliverable:** standardized input/game contracts, harness, scaffold and conformance suites.

Controller inputs:

- [x] Register motion definitions with availability, configuration, processing
  lifecycle, semantic output and phone presentation. Replace per-input runtime
  branching with the agreed registration seam.
- [x] Remove input-specific shell ports. Move controller implementations and
  calibration presentation into their owning layer behind generic shell interfaces.
- [x] Implement `jolt` as proof that the seam works without new input-specific
  shell members or branches.
- [x] Migrate legacy widgets only for committed use cases. Explicitly retire
  unsupported widgets before deleting their legacy container and CSS.
- [x] Add control conformance for output shape, coordinate/rotation behavior,
  per-control release semantics, cancellation and lifecycle cleanup.

Game and harness contracts:

- [x] Add early completion and untimed presentation with a finite safety deadline.
  Preserve final input draining, settling, abort behavior and exactly-once finalization.
- [x] Add per-player role/controller requirements fixed for each round, including
  capability resolution and configuration acknowledgement.
- [x] Add bounded, round-scoped per-player haptics, short status text and enabled
  state through shared feedback delivery, with capability fallback and stale-event
  protection. Games never implement their own phone control UI.
- [x] Expose replay fixtures for clock, seed, identity, roster, capabilities and
  timestamped inputs. Keep authoritative assertions separate from delayed-display
  assertions. Test fixtures must not leak into production bundles.
- [x] Add shared game conformance and supported scenario helpers, replacing private
  state manipulation where a public fixture can express the behavior.
- [x] Add `game:new` with descriptor, implementation, renderer, colocated tests and
  catalog registration. Fix test discovery so generated tests actually run in CI;
  make the game-test command's name and selection agree.
- [x] Derive generic catalog and production checks from registration. Keep
  independent assertions that catch missing production games and leaked developer
  tools; avoid deriving both the expected and actual evidence from the same fixture.
- [x] Keep exact game-stat expectations in game-owned tests unless production
  reporting needs descriptor metadata. Add game-owned sound declarations through
  the shared playback interface.
- [x] Update authoring/input documentation as part of the later foundation work,
  including extension steps, contracts and validation commands.

**Acceptance evidence — Foundation conformance:** both existing games pass common
suites; a scaffolded proof game needs only its folder, catalog registration and
optionally a layout. A new motion input needs no input-specific shell changes.
Typecheck, lint, build and boundary checks pass with both lanes integrated.
**Foundation conformance gate:** complete; integrated gates, browser evidence, both extension proofs and the item-by-item audit are recorded in the acceptance ledger. Physical sensor/haptic and hosted-network checks remain explicitly unverified for milestone 2.

### 2. Host and validate the existing games

**Owner:** Hosting owner, supported by Foundation lead and game owners.
**Dependencies:** milestone 1.
**Deliverable:** hosting decision, deployment/rollback runbook and device/route acceptance matrix.

- [ ] Evaluate hosting for the built frontend, persistent WebSocket signaling/relay
  and TURN. Record configuration, health checks, origin handling, credential
  handling, operating costs and rollback. Select the provider from this evidence.
- [ ] Start with private multi-household testing and one signaling instance.
  Document in-memory rooms and session loss after server restart or host loss;
  do not imply horizontal scaling, persistence or host migration exists.
- [ ] Test Neon Harvest and Whack-a-Mole with real iOS/Android controllers, local
  and remote displays, and confirmed P2P, TURN and WebSocket routes.
- [ ] Cover joining, denied motion permission, touch fallback, calibration,
  background/resume, reconnect, rematches and termination.
- [ ] Record load time, frame pacing, authority/input age, snapshot starvation,
  physical input-to-display latency and subjective responsiveness separately.
  Software timestamps do not substitute for physical timing measurements.
- [ ] Set measurable acceptance budgets before accepting results. Attach device,
  OS/browser, route and build information to each result; fix blockers or explicitly
  narrow supported configurations without marking untested routes passed.

**Acceptance evidence — Hosted current-game matrix:** reproducible deployment and
repeatable cross-household sessions for the supported matrix. A reachable URL or
successful automated suite alone does not pass this milestone.
**Open blockers:** provider choice, budgets, deployment and physical-device/network trials.

### 3. Establish one visual style and art pipeline

**Owner:** Art owner, with Game kit and Inputs owners.
**Dependencies:** milestone 2.
**Deliverable:** approved design bible, asset pipeline and reference scenes.

- [ ] Produce candidate style boards and choose one direction for all games before
  substantial art production.
- [ ] Cover shape language, palette, player identity, typography, HUD, camera,
  materials, lighting, animation, effects, sound and accessibility in the bible.
  Define how phone controls and display UI belong to the same identity.
- [ ] Define source-asset ownership, provenance, naming, export settings,
  optimization, runtime budgets and review procedure.
- [ ] Implement reusable presentation primitives through supported authoring
  interfaces, preserving game import boundaries.
- [ ] Apply the pipeline to representative scenes from both existing games.
  Extract shared 3D infrastructure only where demonstrated reuse warrants it.

**Acceptance evidence — Visual reference review:** approved bible, reproducible
source-to-runtime pipeline and reference scenes that visibly belong to one collection.
**Open blockers:** art-direction selection, runtime budgets and pipeline/reference implementation.

### 4. Experiment with games

**Owner:** a named Game owner per experiment.
**Dependencies:** milestones 1–3.
**Deliverable:** small playable experiments and keep/rework/drop decisions.

- [ ] Choose experiments covering existing inputs, turn-based `jolt` play and
  asymmetric roles. Select exact games when defining each experiment's brief.
- [ ] Give each a hypothesis, bounded scope, playtest and keep/rework/drop decision.
- [ ] Require conformance from the start. Use the approved visual direction;
  require full art polish only for promoted games.
- [ ] Route necessary contract extensions through the established review process.
  Record extension costs so repeated foundation leaks are visible.

**Acceptance evidence — Game experiment reports:** a small set of demonstrably
enjoyable games and evidence that additions do not repeatedly reopen the foundation.
**Open blockers:** experiment selection, implementation and real-player feedback.

### 5. Investigate standalone phone delivery

**Owner:** Phone investigation owner, with Inputs and Hosting owners.
**Dependencies:** milestone 2; may run alongside later art/game work.
**Deliverable:** option comparison, recommendation and minimal proof of the strongest option.

- [ ] Compare browser, installable PWA, native wrapper and native app against the
  same hosted baseline and device matrix.
- [ ] Measure pairing friction, sensor behavior, haptics, orientation, background
  recovery, reconnect, updates and distribution effort.
- [ ] Reuse semantic controller and protocol contracts; isolate platform-specific
  sensor adapters instead of forking game/input semantics.
- [ ] Produce a recommendation supported by measured benefits and maintenance cost.

**Acceptance evidence — Phone delivery decision:** evidence-backed recommendation
and minimal proof. Shipping a native app is a subsequent commitment, not this gate.
**Open blockers:** comparative trials and proof; no delivery technology is preselected.

### 6. Build the party-session metagame

**Owner:** Session owner, with Game kit and Art owners.
**Dependencies:** milestones 2–4; milestone 5 is not a prerequisite.
**Deliverable:** bounded party-session flow on existing progress and round history.

- [ ] Add session setup, a bounded game playlist, between-round flow, standings
  and a final winner.
- [ ] Preserve placement-based awards rather than comparing incompatible raw scores.
- [ ] Specify ties, aborted rounds, disconnected participants, late joins, rematches
  and session reset before implementation, with acceptance cases for each.
- [ ] Keep game selection compatible with player counts and controller capabilities.

**Acceptance evidence — Hosted party-session playthrough:** complete a hosted,
multi-game session through final results without manual state repair, with automated
coverage for the agreed session policies. Persistent accounts, unlocks and a board-game
layer remain future work.
**Open blockers:** session-policy specification, playlist flow and end-to-end acceptance.

## Validation and completion rules

- Discover all intended tests in CI, including colocated game and harness suites.
- Run every catalog game and mode through lifecycle, snapshot isolation, validation,
  supported-player-count, disconnect/reconnect and replay checks. Validate both
  game-state and full-envelope budgets under representative peak conditions.
- Compare repeated authoritative snapshots, events and outcomes with identical
  seeds, clocks and input schedules; control nondeterministic session IDs.
- Test controls through semantic output and production input ingress, including
  stale, duplicate, reordered and post-disposal input. Keep transport acceptance
  distinct from direct harness injection.
- Retain typecheck, lint, production-build and architecture-boundary checks.
- Keep visual review, physical-device testing, hosted-network acceptance and
  subjective fun separate from deterministic correctness.
- Record failed, skipped and blocked checks explicitly. Close a milestone only
  when its named evidence meets the exit criteria; attach remaining limitations
  to supported configurations rather than silently dropping requirements.

Baseline commands to record in milestone 0 are `npm test`, `npm run game:test`,
`npm run typecheck`, `npm run lint` and `npm run build`, plus explicit execution
of the currently omitted colocated suites until discovery is fixed. Later work
must update this list when command selection changes. No runtime tests were run
or certified by this documentation-only revision.
