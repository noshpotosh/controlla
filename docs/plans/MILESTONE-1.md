# Milestone 1 implementation handoff

Status: prerequisite review prepared and checkpoint 1 discovery repair validated; shared-contract proposal approved by the requesting user; checkpoint 2a pure contracts/impulse core validated; checkpoint 2 integration in progress.

- Baseline: fetched `origin/develop` equals `4a885029d30bab8009ed6854d3aeba13a18166e0` on 2026-10-07.
- Topic: `codex/milestone-1-foundation-1007`; review target: `develop` (task-specific override of AGENTS.md main default).
- Worktree: `/private/tmp/controlla-milestone-1`.
- Initial prerequisite checkpoint `d10b9b6` is pushed to origin. Latest checkpoint: use `git log -1`; verify backup with `git rev-parse HEAD @{upstream}`.
- Original checkout and other worktrees remain untouched.
- Dependencies reuse the original checkout's ignored node_modules symlink; no dependency changes.
- Accountable Foundation, Inputs and Game kit owner/reviewer: requesting user, repository owner `@noshpotosh`, verified by GitHub repository API.
- User clarification: no older-client support; proposal uses a coordinated protocol 5 migration.
- Contract proposal: [MILESTONE-1-CONTRACTS.md](MILESTONE-1-CONTRACTS.md).
- Commands, evidence, limitations and approval: [acceptance record](../acceptance/MILESTONE-1.md).

## Resume instructions

1. Read this handoff, the contract proposal and acceptance record. Inspect branch, worktree, staged/unstaged changes and upstream before writing.
2. Contract review is recorded as approved in the acceptance record (2026-10-07, “I love it! Let’s continue”).
3. Checkpoint 1 is complete: npm test directly discovers every eligible test, game:test selects the documented game suites, and the old import wrapper is removed. Validation: 377 full tests, 139 game tests, typecheck, lint and build pass. Proceed with checkpoint 2 under the recorded approval.
4. Checkpoint 2a saves pure registration contracts and the isolated directional impulse core (385 full / 139 game tests, typecheck, lint and build pass). Provider projection is now validated (387 full / 139 game tests, 17 focused motion tests, typecheck, lint and build pass). Next migrate existing motion inputs, then wire jolt via registration; it is not live yet. Continue checkpoints sequentially; update acceptance, inspect explicit staged files, commit, review outgoing commits and push the topic branch after coherent improvements.
5. Review against develop; do not merge or deploy. Do not mark milestone complete without required evidence. Recover this prerequisite from the topic branch's first commit; use git log for its exact ID.

## Supplied implementation plan (preserved)

# Milestone 1: foundation implementation and agent handoff

## Objective and starting context

Complete milestone 1 in `docs/ROADMAP.md`: registered inputs, expanded game contracts, deterministic harness support, scaffolding, and shared conformance. Preserve Neon Harvest and Whack-a-Mole gameplay while proving that new games and motion inputs require no game-specific or input-specific framework branches.

**Planning baseline:** `develop` at `4a885029d30bab8009ed6854d3aeba13a18166e0`. The checkout was clean. Remote freshness was not verified, and validation commands were not run during planning.

**Agreed decisions:**

- Implement sequentially, with validated, recoverable checkpoints.
- Build on `develop` and target `develop` for review.
- The requesting user owns Foundation, Inputs, and Game kit decisions and reviews shared contracts.
- Retire unused `slider`, `dial`, `text`, and `draw-canvas` widgets.
- Implement directional `jolt`, including acceleration directions and gyro turns.
- Include milestone 0’s prerequisite gate before shared-contract implementation.

**Read first:** repository `AGENTS.md`, roadmap milestones 0–1, current authoring documentation, and the controller-input, motion-provider, and engine ownership records. Never read `docs/retired/`.

Code is authoritative where documentation disagrees: the catalog currently contains **two** production games, despite older README claims.

## Contract proposal for the prerequisite review

These are proposed additions, not existing APIs. Record their exact TypeScript signatures, wire compatibility, and migration examples for user review before implementing them.

### Registered inputs

- Retain the existing motion provider as the sensor/permission owner.
- Introduce pure motion definitions containing availability, configuration validation, semantic output metadata, and processor construction.
- Processors receive injected clocks, validated sensor samples, and generic control commands. They expose configure, process, reset, and dispose lifecycle operations.
- Keep React presentation registration separate from pure definitions. Controls own calibration and input-specific presentation; the shell renders generic controller surfaces and settings.
- Move pointer, tilt, shake, and chop behavior behind registration before adding jolt. Preserve chop’s held-aim capture, release grace, timestamps, and rebound suppression.
- Use registration metadata for resolution, semantic validation, and transport capacity checks. Preserve one binary motion vector and four press slots.
- Jolt emits a timestamped impulse with bounded strength and either a cardinal translation direction or a signed rotation axis. Define device-to-controller coordinate conversion, gravity compensation, trigger/rearm thresholds, and deterministic tie-breaking in the reviewed contract. Synthetic traces establish correctness; physical tuning remains unverified.
- Do not silently substitute a button for directional jolt. The proof fixture requires appropriate motion capability; unsupported devices receive an explicit unavailable result.

### Round lifecycle and roles

- Replace mandatory fixed duration with a timing policy: timed duration or untimed presentation with a mandatory finite safety duration. Both produce a finite authority deadline.
- Extend tick results to carry presentation events, optional phone feedback, and an optional completion request.
- Accept completion only from an authoritative running tick. Latch its effective cutoff, stop accepting later gameplay input, drain eligible pre-cutoff actions through the existing 200 ms settling window, then finalize exactly once.
- Completion requests during settling cannot restart or extend completion. Abort/error paths award no points.
- Hide countdown-to-end presentation for untimed rounds; reaching the safety deadline completes through the same settling path.
- Add a deterministic descriptor round-setup hook using mode, ordered roster, and seed. It assigns each participant a role and controller requirements before configuration delivery.
- Freeze roles and semantic requirements for the round. Capability changes may substitute implementations for those requirements but cannot change roles.
- Require current-generation configuration acknowledgment before participation. Reconnect retains the role; late arrivals wait for the next round. Turn order remains game-owned.
- Give both existing games one default role and their existing timed behavior.

### Feedback, replay, and sound

- Add round-scoped, per-player feedback: short status text, enabled state, and brief haptic pulses. Games supply data only; shared controls render it.
- Deliver feedback through authenticated authority routing with round ID, configuration generation, and monotonic revision. Reject stale, duplicate, malformed, or unauthorized messages.
- Default bounds: 120-character status, 100 ms maximum pulse, at most one haptic per player per 100 ms, and at most ten feedback updates per player per second. Coalesce status/enabled state; drop excess pulses.
- Enabled state applies to all of that player’s game controls and is enforced at authority ingress as well as on the phone. Disabling cancels active gestures without synthesizing activation.
- Restore current status/enabled state after reconnect and configuration acknowledgment; never replay old haptics. Clear feedback when the round ends or the controller is disposed.
- Add an explicit seed to game context and injectable session identity/clock dependencies. Production retains normal defaults; replay supplies all nondeterministic inputs.
- Move game-specific sound declarations into game folders. Shared browser playback owns AudioContext, scheduling, and disposal; games emit declarative cues.

Retain protocol 4 and the binary input frame unless compatibility analysis demonstrates an incompatible change. Any necessary bump requires a documented coordinated migration and preserved reload guidance/stopped retries.

## Ordered implementation checkpoints

### 0. Establish the prerequisite and save the handoff

1. Recheck status, diffs, tracking, worktrees, and remote configuration. Fetch `origin`.
2. Create an isolated topic worktree from the agreed `develop` checkpoint. Inspect newer `origin/develop` commits before incorporating them; do not silently change the baseline.
3. Save this handoff as `docs/plans/MILESTONE-1.md`, with checkpoint status and resume instructions.
4. Create `docs/acceptance/MILESTONE-1.md` for commands, commits, results, limitations, and contract approval.
5. Run baseline test, game-test, typecheck, lint, and build commands. Explicitly execute omitted colocated game and harness-controller tests.
6. Record ownership in CODEOWNERS using verified account identifiers. Inspect actual review enforcement; do not equate CODEOWNERS with enforced approval.
7. Present the concrete contract proposal, migration examples, and compatibility findings for the user’s review. Stop shared-contract implementation until that review is recorded.

### 1. Repair test discovery

- Implement a deterministic test-file enumerator restricted to `tests` and `src`, selecting `*.test.ts` and `*.test.tsx`.
- Make `npm test` execute every discovered test exactly once.
- Make `game:test` cover game-owned tests plus game, harness, lifecycle, catalog, and architecture conformance. Document the selection.
- Exclude worktrees, generated output, dependencies, benchmarks, and standalone replay scripts.
- Add a discovery regression proving colocated and newly generated tests are selected.

**Checkpoint exit:** discovery is demonstrably complete; previously hidden failures are recorded and fixed before dependent work proceeds.

### 2. Standardize inputs and remove legacy shell coupling

- Implement the reviewed registration and lifecycle contracts.
- Migrate existing motion processors and their presentation, preserving behavior.
- Replace input-specific shell members such as `chopCount` and `holdAim` with generic controls-owned interfaces.
- Retire the four unused widgets across types, resolver, designer, gallery, documentation, and validation. Reject obsolete layouts clearly.
- Remove the legacy container and its exclusive CSS only after every remaining supported use has migrated.
- Add jolt solely through its owning module, registration entries, and tests. No jolt-specific shell or runtime branches.

**Checkpoint exit:** existing control regressions pass, and jolt exercises the same extension seam as migrated motion inputs.

### 3. Implement lifecycle and fixed round roles

- Update author API, round runner, session authority, snapshot validation, shell timing presentation, and harness together.
- Resolve and validate all participant assignments before replacing the previous round.
- Use per-player requirements consistently for configurations, accepted actions, held values, and reconnect.
- Migrate both production games and test descriptors without changing scoring, timing, or motion fallback behavior.

**Checkpoint exit:** timed, early-completing, and untimed fixtures work through both harness and production authority.

### 4. Add feedback and game-owned sound

- Implement bounded feedback generation, routing, validation, phone presentation, and authority-side enabled enforcement.
- Exercise feedback with a test-only role/turn fixture; do not add new production gameplay merely to demonstrate the API.
- Move existing game cues into descriptor-owned declarations while preserving audible behavior and shared playback lifecycle.

**Checkpoint exit:** feedback cannot leak across players, configurations, or rounds; sound ownership no longer requires central game-specific additions.

### 5. Build replay and shared conformance

- Expose supported harness fixtures for clock, seed, session identity, roster, per-player capabilities, and timestamped input schedules.
- Expose detached authoritative snapshots separately from delayed host/remote display samples.
- Add public scenario helpers for start, input, advance, disconnect, reconnect, abort, and completion. Replace private-state manipulation where these express the scenario.
- Run common conformance for every catalog game/mode at every supported player count.
- Keep exact score/stat expectations and game-specific scenario logic in game-owned tests.
- Keep replay/scenario infrastructure outside production import graphs.

**Checkpoint exit:** repeated runs with identical fixtures yield identical authoritative snapshots, events, and outcomes.

### 6. Add scaffolding and close integration

- Add `npm run game:new -- <slug>` using the existing control scaffold’s conventions.
- Generate descriptor, implementation, renderer, and colocated tests; register the game once in the catalog. Reject invalid slugs and collisions before writing.
- Prove generation in a disposable fixture checkout. The generated game needs only its folder, catalog registration, and optionally a layout.
- Derive per-game production-module checks from catalog registration. Independently assert that Neon Harvest and Whack-a-Mole remain registered and bundled.
- Preserve independent developer-tool exclusion checks and add negative tests for omitted production games and leaked fixtures.
- Update authoring/input documentation, README game inventory, extension instructions, validation commands, and the acceptance record.

**Checkpoint exit:** both production games and the scaffold proof pass the integrated gates.

## Validation and completion

Required coverage:

- **Controls:** output shape, rotation/coordinates, sensor freshness and epochs, duplicate/reordered samples, reconfiguration, cancellation, and post-disposal callbacks. Sticks neutralize; aim-pad retains position.
- **Lifecycle:** early completion with late pre-cutoff input, rejected post-cutoff input, safety timeout, duplicate completion, abort during settling, load failure, and exactly-once finalization/awards.
- **Roles:** mixed capabilities, missing required capability, stale acknowledgment, reconnect, fixed assignment, and late-join exclusion.
- **Feedback:** bounds, ordering, spoofed source, stale round/generation, disabled-input rejection, unsupported vibration, and no haptic replay.
- **Replay/snapshots:** deterministic authority; separate delayed-display assertions; detached snapshots; valid bounded JSON; **40 KiB game state** and **47 KiB full envelope**, including representative peak eight-player states.
- **Integration:** production input ingress and routing tests in addition to direct harness injection; scaffold discovery; catalog completeness; production fixture exclusion.

Run `npm test`, `npm run game:test`, `npm run typecheck`, `npm run lint`, and `npm run build` for final acceptance. Record browser smoke checks for both games, touch fallback, controller settings/calibration, and harness flows. Record physical sensor, haptic, and hosted-network evidence separately; simulation cannot certify them.

After each coherent checkpoint, inspect the staged diff, commit explicit task-owned files, review outgoing commits, and push the topic branch. Update the handoff with commit, validation, remaining work, and remote-backup status.

Milestone 1 closes only when both lanes, extension proofs, documentation, and required evidence pass. Hosting, new backlog games, unified art, native delivery, and party-session implementation remain outside this plan.
