# Milestone 1 acceptance and contract review

Date: 2026-10-07 (America/Chicago). Milestone remains open.

## Prerequisite baseline

- Fetched origin successfully. Baseline and origin/develop both equal
  `4a885029d30bab8009ed6854d3aeba13a18166e0`; no newer develop commits to incorporate.
- Topic branch: `codex/milestone-1-foundation-1007`.
- Worktree: `/private/tmp/controlla-milestone-1`; review target: develop.
- Original develop checkout was clean; no staged or unstaged changes were present.
  Other existing worktrees were preserved and were not read for implementation.
- Node v24.21.0; existing installed dependencies reused via ignored node_modules
  symlink. No dependency installation/upgrade performed.
- Read AGENTS.md, roadmap milestones 0–1 and current authoring/controller-input/
  motion-provider/engine ownership records. Never read docs/retired.

| Command | Result at baseline | Evidence / limits |
| --- | --- | --- |
| `npm test` | PASS, 375 tests, 0 failures | 12.58 s, architecture graph and production ingress tests included |
| `npm run game:test` | PASS, 104 tests, 0 failures | 7.25 s, current selection is architecture wrappers |
| `npm run typecheck` | PASS | tsc --noEmit --incremental false |
| `npm run lint` | PASS | oxlint, no diagnostics |
| `npm run build` | PASS | vinext plus production client/SSR/RSC boundary assertion |
| `node --import tsx --test src/client/minigames/neon-harvest/game.test.ts src/client/minigames/whack-a-mole/game.test.ts src/client/devtools/game-harness/controller.test.ts` | PASS, 37 tests, 0 failures | 1.17 s, explicitly selected colocated suites |

Initial sandbox attempts of npm test/game:test could not create tsx's IPC socket
(EPERM). Authorized reruns with local IPC/loopback access passed. This was an
execution-environment blocker, not a failing test. Build reports informational
unknown route classification but completes successfully. Logs are local temporary
files `/private/tmp/milestone-1-baseline-{0,1,2,3,4,5}.log`; summarized evidence is
preserved here because temporary logs are not durable repository artifacts.

Discovery finding: the plan's claim that all colocated suites are currently
omitted is incomplete. `tests/architecture-examples.test.ts` imports the harness
controller tests and recursively imports game `.test.ts` files, so these 37 tests
already contribute to both baseline test commands. Top-level globs and the wrapper
do not directly enumerate every `.test.ts`/`.test.tsx` under tests/src. Checkpoint
1 must replace wrapper import discovery when introducing direct discovery, avoid
double execution, and prove new generated/colocated .test.tsx selection. No
baseline failures were hidden by the explicit colocated execution.

## Ownership and review enforcement

Accountable Foundation lead, Inputs owner, Game kit owner and shared-contract
reviewer: requesting user, verified authenticated GitHub login `noshpotosh` and
repository owner `noshpotosh/controlla`. `.github/CODEOWNERS` records relevant source,
test, script, workflow, docs and ownership paths. Future milestone owners are not
assigned by this foundation task.

Inspected GitHub APIs using existing credentials without displaying or changing
them:

- `/user`: login noshpotosh.
- `/repos/noshpotosh/controlla`: owner noshpotosh, default branch main.
- `/repos/noshpotosh/controlla/branches/develop/protection`: authenticated HTTP 404,
  message 'Branch not protected'.
- `/repos/noshpotosh/controlla/rulesets`: HTTP 200, empty list.

Thus no protected-branch review enforcement is configured for develop in these
settings. CODEOWNERS expresses ownership but does not enforce approval. No branch
protections, remotes, credentials, Git identity or repository settings changed.
The user review gate in the supplied implementation plan still applies.

## Contract review gate

Concrete proposal: [MILESTONE-1-CONTRACTS.md](../plans/MILESTONE-1-CONTRACTS.md).
Includes exact proposed registration/lifecycle/feedback data signatures, coordinate
and gravity rules, jolt thresholds, completion cutoff, fixed roles, deterministic
dependencies, sound ownership, wire compatibility and migrations for both games.

User clarification (2026-10-07): older clients do not need support because the
application is not released. The revised proposal uses protocol 5, ControllerConfig
schema 2 and RoundSnapshot schema 2, retaining the 47-byte binary frame and existing
protocol-mismatch reload guidance/stopped retries. It removes feature negotiation
and mixed-version support. No protocol/runtime source has changed. The API review
remains pending; this clarification amends compatibility scope only.

**Approval status: APPROVED.** On 2026-10-07 the requesting user reviewed the
proposal and replied: “I love it! Let’s continue”. This records approval of the
shared-contract proposal and coordinated protocol 5 migration without older-client
support. Proceed with checkpoints 2–6; any implementation refinements must preserve
the approved semantics and be documented with their validation evidence.

## Checkpoints and remote backup

- Checkpoint 0: documentation/ownership prerequisite prepared; all baseline
  automated gates pass. The first topic commit saves these review artifacts.
- Initial prerequisite checkpoint: `d10b9b6`, successfully pushed to origin with
  upstream tracking. An additive follow-up records the no-older-clients clarification.
- Resolve latest checkpoint and backup equality with `git log -1` and
  `git rev-parse HEAD @{upstream}`; latest commit/push result is reported in the
  chat handoff to avoid self-referential doc commits.
- Checkpoint 1 test discovery is complete (independent of shared API approval).
- Shared implementation checkpoints 2–6 remain incomplete.

## Remaining work and evidence

After user contract review: motion registration and retirement,
jolt, lifecycle/roles, feedback/sound, replay/conformance, game scaffold and final
integration/documentation. Execute the full required test/typecheck/lint/build
gates at each appropriate checkpoint and final acceptance.

Browser smoke checks for both games, touch fallback, settings/calibration and
harness flows: not run in this prerequisite-only checkpoint. Physical sensors,
haptic behavior and hosted-network evidence: not measured. Synthetic traces or
passing tests cannot certify those checks. No deployment, merge, new production
game, art overhaul or party-session work performed. Milestone 1 cannot close from
this baseline evidence alone.

## Checkpoint 1: direct test discovery

Implemented independently while contract review remains pending. No shared API,
protocol, game rules or runtime behavior changed.

- `scripts/test-discovery.ts` recursively enumerates only tests/src, sorts paths,
  selects .test.ts/.test.tsx, skips dependencies/worktrees/artifact directories
  and does not follow symlinks.
- `scripts/run-tests.ts` passes each file once to the Node test runner with tsx;
  npm test and game:test use it. `--list` exposes the exact file selection.
- Removed architecture-examples.test.ts, whose import wrapper would duplicate
  game and harness suites under direct discovery.
- Game selection includes all game/harness-owned tests, architecture-/game-
  prefixed suites, engine-round, live-catalog, neon-runner, replay and discovery
  tests. Documented selection in the authoring guide.
- Regression uses disposable source roots and the actual copied runner. It proves
  newly added TSX tests are discovered/executed, files execute exactly once,
  artifact/symlink exclusions work and a deliberately failing test returns exit 1.
  The nested fixture clears Node's inherited test-context environment so it runs
  as an independent runner. An initial fixture failed without that isolation;
  fixed before checkpoint validation.

| Command | Result |
| --- | --- |
| `npm test` | PASS: 377 tests, 0 failures (baseline 375 plus 2 discovery regressions) |
| `npm run game:test` | PASS: 139 tests, 0 failures; expanded beyond former architecture wrapper selection |
| `npm run typecheck` | PASS |
| `npm run lint` | PASS |
| `npm run build` | PASS, client/SSR/RSC production boundaries verified |
| `git diff --check` | PASS |

Logs: /private/tmp/milestone-1-discovery-{0,1,2,3,4}.log. The test runner change
revealed no additional failing production tests. Baseline colocated suites remain
present without duplication. No browser/physical-device/hosted-network evidence
is asserted by this tooling checkpoint. Next dependent step is motion registration,
which remains behind the supplied plan's explicit contract-review gate.

## Checkpoint 2a: approved pure motion contracts and impulse core

Approval is recorded above. Added controls-owned registration contracts for
availability, settings validation, semantic parsing, injected clocks and lifecycle.
The interface is named MotionInputProcessor to distinguish it from the existing
raw sensor MotionProcessor; ownership and semantics match the approved proposal.

The jolt owning module implements finite bounded direction/strength values,
device/controller reflection and quarter turns (including angular handedness),
gravity-removed acceleration with a calm gravity-estimation fallback, normalized
channel/axis tie breaking, consecutive calm plus refractory rearming, epoch/time/
sequence safety, cancellation and permanent disposal. Availability requires both
granted sensors. Eight pure synthetic trace tests pass; no physical tuning claim.

Validation: npm test 385/385; game:test 139/139; typecheck, lint and production
build pass. Logs: /private/tmp/milestone-1-motion-core-{0,1,4}.log. Targeted jolt
suite: 8/8. Initial lint caught an unused test type import; removed before gates.

This is a saved intermediate implementation, not checkpoint 2 completion. The
new processor is not registered for live resolution/processing yet. Migrate
pointer/tilt/shake/chop behind the seam first, then wire jolt through registration.
Provider sample projection, configuration schema 2/protocol 5, generic shell
surfaces/settings/commands, legacy retirement and production ingress conformance
remain required. No protocol source changed yet. Existing gameplay remains on
its current path until the migration is integrated and validated.

## Checkpoint 2b: production sensor projection

Provider snapshots now satisfy ValidatedMotionSample and include detached, frozen
linearAcceleration from finite browser acceleration, or null when absent/invalid,
stale, suspended or disposed. The provider retains all permission/listener/timer
ownership. Its raw recording path is unchanged. A test passes its actual projected
sample to the new jolt processor, proving the detector accepts production sensor
projection without browser access or fabricated transport input.

Validation: full suite 387/387; game:test 139/139; focused provider/jolt suites
17/17; typecheck, lint and build pass. Logs:
/private/tmp/milestone-1-motion-provider-{0,1,2}.log. A test's deliberately mutable
cast initially failed typecheck; replaced with Reflect.set to assert rejection of
mutation without weakening readonly types, then focused tests/typecheck/lint passed.
No production code changed after the full suite and build runs.

Still incomplete: registered processing of pointer/tilt/shake/chop, generic shell
presentation/commands and settings, legacy removal, config/protocol migration,
live jolt registration and ingress. Checkpoint 2 remains open. Pure core saved at
fb53ed6 and pushed; this additive provider checkpoint preserves that recovery point.

## Checkpoint 2c: existing motion processor extraction

Added pure registered definitions and processors for pointer, tilt, shake and
chop. Provider lifecycle remains unchanged. Pointer retains gyro/history/filter
implementation, fresh-sample integration, bounded aim, calibration, generic
capture/release and rebound suppression. Tilt retains signed calibration and
stale neutralization. Shake retains its magnitude threshold and strict 600 ms
recognition cooldown. Chop retains held capture, onset dating, release grace,
epoch recovery and follow-through/return rearming. Cancellation emits immediate
release and no activation; processors stay inert after disposal.

The documented semantic contract now carries aim-lock policy, locked-aim capture,
held state and haptic request data, so composition can route these effects without
input-specific branches. The interface name is MotionInputProcessor, avoiding the
existing raw fusion processor name. These are preservation-driven refinements of
the approved interface; they do not introduce another approval gate.

Validation: full suite 398/398, game:test 139/139, production build passed.
Focused registered-motion suite 11/11. Typecheck initially caught a redundant
assertion that made a test's error branch unreachable; removed the assertion and
reran focused tests/typecheck/lint successfully. No production code changed after
the full suite/build. Logs: /private/tmp/milestone-registered-motion-{tests,games,build}.log.

This is a saved intermediate extraction, not the completed registration migration.
The live controller still owns its existing processing. Next add generic registered
composition and wire it into controller input, then move presentation/settings,
retire legacy widgets, migrate configuration/protocol and enable jolt via the same
registry. Checkpoint 2 and all later checkpoints remain open. No physical sensor,
haptic, browser smoke or hosted-network claims are made by these pure tests.
