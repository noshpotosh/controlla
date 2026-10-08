# Milestone 1 acceptance and contract review

Date: 2026-10-07 (America/Chicago). Milestones 0–1 implementation and required foundation evidence are complete. See the final checkpoint below and [requirement audit](MILESTONE-1-AUDIT.md); historical checkpoint limitations remain for provenance. Physical-device/hosted acceptance remains separately unverified.

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

## Prerequisite-only remaining work and evidence (historical)

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

## Checkpoint 2d: live registered motion processing

ControllerInput now delegates pointer, tilt, shake and chop processing to generic
controls-owned MotionControls composition. Input-specific detector/history state
and tick branches have been removed from the runtime collaborator. Composition
routes aim-lock/release policy, held state, haptic requests and locked-aim
activation capture. Activation values and atomic press edges share one converted
captured authority timestamp. Resolution availability, vector capacity and semantic
validation consume registration metadata.

Metadata-only definitions are separate from processor construction: authority and
shell can read capability/configuration/output contracts without reaching pointer,
chop or provider implementations. A parity test checks both registries. Existing
architecture negative tests still prohibit provider, React and runtime escapes.
Generic composition tests cover atomic invalid configuration rejection, ambiguous
bindings, detached immutable state, cancellation/disposal and configured bounds
before the first sensor sample. All existing live pointer/chop regressions pass.

Initial integrated validation exposed eight failures. Fixed registration metadata
reaching forbidden processor implementations, preserved valid off-screen pointer
semantic values, aligned the runtime fixture's two local sensor clocks, supplied
real core geometry to the disposable control scaffold fixture, and refreshed tilt
fixture sample timestamps without changing its calibration assertions. Lint also
caught a test destructuring a factory method; the parity test now enumerates data
without extracting methods. These were fixed before this checkpoint.

Validation: full suite 402/402; game:test 139/139; focused input/composition/runtime
suites 27/27; typecheck, lint and production build passed. Logs:
/private/tmp/live-motion-checkpoint-{tests,build}.log and
/private/tmp/live-motion-games.log. No browser or physical-device evidence yet.

Remaining checkpoint 2 work: replace the temporary schema-1 motion configuration
projection with schema 2's registered motion map and protocol 5; replace transitional
holdAim/chop-count presentation adapters with scoped generic ports; move settings
and motion UI to controls-owned presentation; retire obsolete widgets and legacy
container/CSS; register jolt through the same metadata/processing/presentation seams
and prove production ingress. No older-client support is required. Later lifecycle,
roles, feedback/sound, deterministic harness/conformance and scaffolding work remains.


## Checkpoint 2e: registered configuration and live directional jolt

Resolved configurations now use schema 2 and the generic registered motion settings
map. Protocol 5 coordinates this incompatible migration across clients/signaling;
existing reload guidance and stopped retries remain. No older-client projection
is retained. Game input requirements pass settings through `motion`; Whack-a-Mole
retains its existing play-field bounds and default anchoring. Registry metadata
supplies descriptions, recenter affordances, vector and activation capacity.
Layout schema 2 remains unchanged; missing newer saved-layout toggles default off.

Jolt joins both metadata and processor registries. Its pure metadata is separated
from processor construction, preserving authority/UI dependency boundaries. A
production-path test resolves a required jolt without a button substitute, emits
a directional payload and same-time press edge from the actual phone runtime,
and proves authority accepts exactly one semantic activation despite a duplicate.
Unavailable devices fail explicitly. Repeated motion bindings own distinct
processors across reordering; conflicting per-type settings fail resolution.
Atomic rejection tests cover obsolete schema, unknown/unmatched settings,
invalid jolt configuration and missing enabled settings.

Validation: full suite 405/405; game:test 139/139; typecheck, lint and production
build passed. Logs: /private/tmp/schema2-{tests,games,build}.log. Integrated checks
caught a motion dependency on the broad controls registry and an incomplete
relocated layout fixture. Kept the narrow boundary and copied pure metadata into
the fixture. A proposed shared constant in api.ts violated its declarations-only
contract; moved it into motion registration and reexported it from the registry.
No architecture gate was weakened to admit those dependencies.

Remaining checkpoint 2 work: scoped generic command ports, controls-owned motion
surfaces/settings, removal of input-specific shell adapters and obsolete widgets,
then legacy container/CSS retirement. Later lifecycle/roles, feedback/sound,
deterministic harness/conformance and scaffold checkpoints remain open. Browser,
physical sensor/haptic tuning and hosted-network evidence are still unverified.


## Checkpoint 2f: scoped motion presentation ports

Moved pointer preview, tilt/shake hints, chop tile and jolt hint into the controls
presentation registry. ControllerSurface renders registered motion surfaces;
the shell no longer selects motion types or passes chopCount/holdAim. Those
runtime and input-owner adapters are removed. Input observation now exposes
generic action state, and MotionControlPort provides commands plus detached,
frozen held/activation/point state for a named widget.

Ports capture identity by value, configuration ID/generation and input epoch.
Retired ports ignore commands and expose neutral state. The input owner supplies
command timestamps; retained views cannot backdate commands. Cancel/lost capture
and unmount cancel gestures without the normal release grace or activation.
Adapter close blocks retained commands and observations as well. Existing swing
capture, grace, timestamps, repeated swings and rebound tests use the generic port.

Validation: full suite 406/406 and game:test 139/139; production build passed.
Added adapter-close coverage and strengthened the disabled-motion fixture after
those integrated gates: focused input/adapter suite 29/29; typecheck and lint pass.
Logs: /private/tmp/motion-ports-{tests,games,build,focused,input}.log.
Boundary checks initially caught a shell contract reaching registration.ts;
commands/ports now live in declarations-only motion/contracts.ts. Registration
reexports these types for processors. The original strict boundaries remain.

This saves a coherent intermediate migration. Settings/calibration still have
input-specific shell members and UI. Obsolete widgets and their legacy container
remain pending retirement. Motion surface classes temporarily retain existing
styling; move their styles into controls before deleting legacy-exclusive CSS.
All later milestone checkpoints and browser/device/network evidence remain open.


## Checkpoint 2g: obsolete widget and legacy container retirement

Removed slider, dial, text and draw-canvas from WidgetType, registry, value
validation and public output shapes. They had no saved layouts or production
game users. Designer/gallery choices already derive from registered definitions;
no obsolete choices remain. Structural layout parsing, assignment validation and
layout validation now reject these names with explicit replacement guidance.
ControllerInput rejects unsupported widget types even in schema-2 configurations,
without replacing a valid prior setup.

Deleted LegacyWidget and its shell fallback. Every supported motion surface is
rendered through controls registration. Removed exclusive legacy global/cell CSS;
ported motion styling into controls/motion-views/styles.css with ctl class names,
cell fill, container sizing and reduced-motion handling. Input glossary and
backlog ideas no longer present retired widgets as available. Jolt documentation
now reflects its registered contract and separates synthetic correctness from
physical tuning.

Validation: npm test 409/409; game:test 139/139; typecheck, lint and production
build passed. Logs: /private/tmp/retire-widgets-{tests,games,build}.log. Repository
search confirms no LegacyWidget consumers/file, legacy widget/chop-tile CSS or
retired production type branches remain; obsolete names remain only in rejection
logic, tests and historical/plan documentation. Both production games retain
their controller-resolution and gameplay regressions.

Checkpoint 2 remains open for generic controls-owned settings/calibration and
remaining input-specific shell/runtime settings adapters. Browser smoke and
physical-device evidence remain unverified, as do all later milestone checkpoints.


## Checkpoint 2h: controls-owned settings and calibration

Moved aim instructions, sensitivity range and recenter controls into registered
controls presentation. Pure metadata supplies settings ranges/defaults and
calibration availability. The shell opens/closes a generic panel and supplies
scoped ports; its sensitivity, sensitivityRange, previewPoint and recenter
adapters are removed. Controller menu motion enablement uses the configured
motion map rather than named input branches.

Controls composition owns numeric preference validation, clamping, immutable
observation, restoration and reapplication after configuration changes. The input
collaborator routes commands with receipt timestamps. Runtime persists the generic
map under controlla:control-settings, without migration of the unreleased old
pointer-gain key. Retired ports cannot adjust preferences or recenter replacement
controllers. Tests now use the same scoped settings commands as presentation.

Validation: npm test 410/410; game:test 139/139; typecheck, lint and production
build passed. Focused input/composition/runtime suite 33/33. Logs:
/private/tmp/settings-{tests,games,build,focused}.log. Typecheck initially caught
an inferred optional numeric-map key; the final controls-owned frozen map fixes
that issue. Registration/metadata parity and architecture gates pass.

Checkpoint 2 implementation is complete. Required browser smoke remains pending,
including settings/calibration and touch fallback; physical sensor tuning remains
unverified. Checkpoints 3–6, feedback/haptics, hosted-network evidence and final
integration acceptance remain open. Continue with timing policy and fixed roles.


## Checkpoint 3a: timing policy and authoritative completion

Replaced descriptor durationMs with timed/untimed timing policy. Both durations
are positive finite safe integers, capped at 24 hours; the runner captures an
immutable policy and always derives a finite safety deadline. Both production
games retain their original timed durations, arbitration and event behavior.
Game tick now returns an object with events and optional complete: true.

Running ticks validate results/events/state before latching early completion.
The effective endAt is the tick time bounded by the original deadline. Latching
clears held values, removes queued post-cutoff actions and starts the existing
200 ms settling window. Late discrete input remains eligible only with capture
before cutoff and receipt strictly before cutoff+200. Settling completion cannot
extend/restart the deadline; finalize and awards remain exactly once. Abort/error
paths award no points. Continuous widget/binary updates no longer enter gameplay
after cutoff, while recovered binary press edges keep the discrete-input path.

Snapshot schema 2 now requires timing and validates cutoff against its duration;
known catalog games must match their declared policy. Displays preserve reload
guidance for incompatible schemas. The shell projects timing metadata and labels
untimed choices without an end countdown; the common start countdown is unchanged.

Validation: npm test 415/415; game:test 144/144; typecheck, lint and production
build passed. Focused lifecycle suite 28/28, plus 5/5 completion tests after adding
queued future-action filtering coverage. Logs: /private/tmp/timing-{tests,games,
build,focused,completion}.log. New fixtures exercise early completion in the
runner, public harness and production authority; safety timeout, duplicate
settling requests, cutoff ordering, invalid output and abort are covered. Initial
failures were fixture expectations for aborted ledger records and a forbidden
shell contract type dependency; final tests preserve the existing strict boundary.

Checkpoint 3 remains open: deterministic setup seed, frozen assignments and
per-player requirements, preparation roster freeze, role/round configuration
metadata, capability substitution, stale ACK and reconnect evidence. Browser
untimed/settings evidence and all later milestone checkpoints remain pending.


## Checkpoint 3b: fixed roles and deterministic round setup

Added the optional pure descriptor setup hook and explicit uint32 seed. Detached,
frozen ordered setup data produces exactly one bounded role/requirements assignment
per participant. Every assignment, layout, capability and transport capacity is
resolved before constructing or replacing the previous game. Omitted setup gives
both production games their default role and existing controls. Their random wave
seeds now use context.seed with the same salts; the harness defaults to 3000.

Round identity is reserved before configuration delivery without opening awards.
Preparation freezes its candidate roster; every candidate must reconnect and ACK
the current generation before start. Late arrivals receive no round assignment
and cannot inject discrete, continuous or binary gameplay input. Config messages
carry required roundId/role metadata. Phones cancel retained controls for an
unassigned active round, show a waiting screen and expose the assigned role in the
menu. Reconnect retains assignments. Capability substitution uses frozen semantic
requirements; failed resolution retires old readiness/input, and recovery requires
a new generation ACK. During settling, already accepted terminal presses survive
reconnect as before. Turn order remains game-owned.

Schema-2 snapshots include validated seed/assignments within existing JSON limits.
Shared JSON validation moved to a headless module to avoid setup/snapshot cycles.
Harness options accept seed and per-player capabilities; preflight happens before
game construction. Reserved identity does not change the loading deadline preview.

Validation: npm test 424/424; game:test 152/152; typecheck, lint and production
build passed. Focused role/input/live-motion tests 30/30, final harness/roles 20/20.
Logs: /private/tmp/roles-{tests,games,typecheck,lint,build,final-focused,harness-final}.log.
Initial full-suite failures caught construction before preflight, terminal press
loss and stale-generation expectations; final code/tests preserve terminal input
while enforcing fresh ACKs. Live jolt evidence now negotiates recovery configs and
rearms before the gesture. Substitution tests send valid discrete dpad vectors.

Checkpoint 3 implementation is complete. Checkpoints 4–6, final browser smoke,
physical sensor/haptic tuning and hosted-network evidence remain open. Continue
with bounded per-player feedback and game-owned sound.


## Checkpoint 4a: game-owned declarative sound

Moved Neon Harvest hit and Whack-a-Mole pop/bonk/gold/boom/whiff declarations into
their own game folders without changing layers, frequencies, offsets, lengths or
gains. Descriptor sounds uses the public SoundLayer data contract; framework
prompt/end remain browser-owned and cannot be overridden. New game cues need no
shared cue registry changes. Playback supplies the displayed snapshot game ID to
runtime, which projects that descriptor's declarations into shared audio playback.
Game and browser ownership boundaries stay enforced; audio handles, noise buffers,
scheduling, hydration deduplication and disposal retain their existing owners.

Sound validation runs before setup/game construction. Cues are bounded to 64
names of at most 64 characters and 16 KiB JSON; each has one to eight layers.
Offsets are 0–2 seconds, lengths (0,2], gains [0,1], frequencies 20–20000 Hz,
and waves/filters must be recognized. Framework cue collisions reject atomically.

Validation: npm test 426/426; game:test 154/154; typecheck, lint and production
build passed. Focused sound/browser/playback 13/13; final playback ownership
assertions 7/7. Logs: /private/tmp/sound-{tests,games,typecheck,lint,build,focused,
playback-final}.log. Tests prove custom descriptor cues work without central edits,
cross-game kinds stay silent, bounded declarations reject before construction,
and framework cues retain precedence. Physical audible comparison remains pending.

Checkpoint 4 remains open for bounded authenticated phone feedback, enabled-state
cancellation/enforcement, status rendering, reconnect restoration and haptics without
replay. Checkpoints 5–6 and required browser/device/network evidence remain open.


## Checkpoint 4b: bounded authenticated phone feedback

Added opt-in tick feedback with per-player plain status, enabled state and brief
haptics. Validators bound status to 120 Unicode code points, pulses to positive
integer milliseconds at most 100, and one entry per fixed participant/tick within
8 KiB JSON. Messages carry round ID, current configuration generation and monotonic
revision. Host sends feedback directly over authenticated control routing, including
remote-venue phones; venue/player spoofing is rejected. Per-player delivery is
limited to one update per 100 ms, coalescing latest state and dropping excess
pulses. Reconnect/current ACK restores state without replaying haptics.

Authority rejects disabled reliable, widget and binary input and clears held
values, while retaining already accepted actions. Re-enable establishes a capture
floor. Phones cancel gestures, retire scoped ports and disable game controls while
keeping menu/settings available. Status uses escaped React text. Unsupported
vibration does not prevent feedback state; optional vibration is browser-owned.
Terminal lifecycle and disposal clear feedback. Production games remain unchanged;
a test-only turn fixture exercises the extension seam.

Session clock dependency is now injectable (finite nonnegative milliseconds) for
deterministic authority feedback tests. Live forced-relay testing exposed a
fractional deadline bug: subtracting start from end could round duration slightly
above its limit. Snapshot validation now compares end directly to start+duration.
A regression reproduced failure before the fix and passes after it; deadline
bounds remain strict.

Validation: npm test 441/441; game:test 164/164; typecheck, lint and production
build passed. Logs: /private/tmp/feedback-{tests,games,typecheck,lint,build}.log.
Focused feedback/control/router/browser tests passed; live WebSocket testing proves
turn switching, player isolation, spoof rejection, reconnect/new generation without
old pulses and host-loss cleanup. Fractional regression evidence:
/private/tmp/feedback-fraction-{before,final}.log. Physical vibration and audible
comparison remain unverified; mocks and relay tests do not certify devices or
hosted-network performance.

Checkpoint 4 implementation is complete. Continue checkpoint 5 replay fixtures,
identity dependencies, detached authority/display samples and common catalog
conformance, then checkpoint 6 scaffolding and final browser/evidence audit.


## Checkpoint 5a: replay identity and detached authority inspection

SessionProgress accepts a bounded identity factory, evaluated once; production
keeps fresh UUID/fallback defaults. SessionAuthority now injects that factory
alongside seed and clock, preserving dependency receiver binding. Harness options
support sessionId and initialTime; externally owned progress cannot also declare
identity. Empty/blank or over-128-character IDs and invalid clocks reject before
round construction. Round reservations retain monotonic suffixes.

Harness authoritativeSnapshot returns detached current data separately from
host/remote delayed display samples. Tests compare complete snapshots (including
identity, events and progress) and outcomes across repeated full rounds for both
production games, prove authority precedes delayed presentation, and mutate nested
inspection data without affecting subsequent authority. Production authority
configurations and wire snapshots replay identically without global clock mocks.

Validation: npm test 445/445; game:test 168/168; typecheck, lint and production
build passed. Focused replay suite 4/4. Logs:
/private/tmp/replay-foundation-{tests,games,typecheck,lint,build}.log; final focused
and build logs use replay-foundation-final-{focused,build}.log. Initial type/lint
checks caught a test import and mixed event/message capture type plus an unbound
identity callback; corrected checks pass. No physical/device evidence added.

Checkpoint 5 remains open: timestamped scenario schedules/public helpers, replacing
private-state scenarios where possible, every catalog game/mode/player count and
representative peak eight-player state/envelope budgets. Scaffolding, catalog-derived
bundle checks and browser/evidence closure follow in checkpoint 6.


## Checkpoint 5b: timestamped scenarios and catalog-wide conformance

Added development-only detached ScenarioStep fixtures and runScenario. Receipt
`at` is independent of value `capturedAt` and Action.time. Stable ordering preserves
simultaneous fixture order; due steps apply before the receipt tick. Helpers use
public load/input/advance/disconnect/reconnect/abort APIs. finish advances through
the actual finite authority deadline and final drain without forcing results,
stopping at early completion when requested. Backward/nonfinite timelines reject;
a stopped/disposed clock cannot loop. Fixtures detach before asynchronous load.
No harness scenario test manipulates private runner/game state.

Shared conformance derives all cases from catalog modes and player bounds: both
production games, standard mode, counts 1–8 (16 cases, each replayed twice).
Mixed capabilities, generic semantic input, disconnect/reconnect, fixed assignments,
all eligible outcomes, detached snapshots, delayed displays and exactly-once awards
are covered. Replay compares authoritative snapshot digests, complete outcomes,
progress and observed peak sizes. Game-specific scoring stays out of the common
suite. Every simulation tick inspects state/envelope size; the engine retains its
own validation. Representative eight-player peak evidence: Neon Harvest state
17413 bytes/envelope 35452; Whack-a-Mole state 9987/envelope 29783, below 40/47 KiB.
These are observed fixture peaks, not a claim about all possible gameplay.

Focused validation: 5/5 scenario tests and 16/16 conformance cases pass. Conformance
includes 32 complete production rounds and took 157 seconds standalone. Logs:
/private/tmp/scenario-final-focused.log and /private/tmp/conformance-focused.log.
Integrated validation: npm test 466/466; game:test 189/189; typecheck, lint and production build passed. Logs: /private/tmp/scenario-{tests,games,typecheck,lint,build}.log. Checkpoint 5 implementation is complete; continue checkpoint 6 scaffolding, catalog-derived bundle evidence, documentation inventory and browser smoke/completion audit.
No browser, physical sensor, vibration or hosted-network evidence is claimed.

## Checkpoint 6a: game scaffold and catalog-derived production evidence

Added game:new using controls scaffold conventions. It validates bounded kebab
slugs, folder/registration and catalog identifier collisions before writes; loads
all templates before mutation; supports formatted trailing-comma arrays. Descriptor,
rules, renderer and colocated test are generated under one folder, with one catalog
import/entry. The generic starter accepts semantic SCORE actions, uses finite timed
rounds/default roles and owns a detached point-counter state. No engine, runtime,
shell or controls changes are generated. Discovery includes the generated test.

Catalog registration is parsed without executing games. Production evidence derives
index/game/renderer requirements for every catalog folder, independently requires
Neon Harvest and Whack-a-Mole, and rejects developer, test and template imports.
Negative tests cover a new unbundled registration, missing original modules/catalog
entries and leaked fixture modules. README now lists both actual production games;
authoring, input extension and validation docs explain the new workflows.

Focused scaffold proof: 3/3 tests; generated tests and copied-source typecheck pass;
invalid/duplicate operations leave the fixture unchanged. Catalog bundle checks
6/6. Logs: /private/tmp/game-scaffold-final-focused.log and
/private/tmp/catalog-bundle-focused.log. Initial fixture typecheck failures exposed
missing UI/hooks copies (fixed); initial generator narrowing and test variable lint
issues were corrected. Identifier-collision cases include default/find, and keyword
slug class produces valid identifiers.

Disposable integration checkout: /private/tmp/controlla-game-integration-o_13oo5q,
branch codex/scaffold-integration, corrected baseline 796f665. It contains scaffold-proof only
for integration evidence; the real catalog still contains two games. Generation
changes only its folder and catalog. Main validation: 470/470 full tests and
192/192 game tests (/private/tmp/scaffold-final-{tests,games}.log). Generated-game
validation: 479/479 full tests and 201/201 game tests
(/private/tmp/scaffold-proof-accepted-{tests,games}.log); typecheck, lint and build
pass in both checkouts, including catalog-derived production module checks.

The initial fixture suites exposed a shared hard-coded statistics-key map
(scaffold-proof-{tests,games}-before.log) and an exact two-entry catalog assertion
(scaffold-proof-final-{tests,games}.log). Shared report checks now compare preserved
snapshot statistics and generic placement awards; focused exact statistics remain
in each game folder. The catalog test permits extensions while independently
requiring both original games and unique IDs. Its final focused reruns pass 11/11
in both checkouts (/private/tmp/scaffold-{proof-,}engine-focused.log).

Browser harness smoke found Finish round advancing a fixed 34 seconds. It now uses
the public finish helper, then advances through delivery/presentation delay so
paused displays show terminal results. Both games finish while paused with matching
host/remote results and cumulative awards; screenshot:
/private/tmp/milestone-harness-results.jpg. Typecheck/lint/build pass after this
repair (/private/tmp/scaffold-browser-{typecheck,lint,build}.log). No new production
rules changed. Live-room touch/settings/calibration smoke and completion audit
remain open; physical sensors/haptics and hosted-network evidence remain unverified.

## Checkpoint 6b: browser smoke and completion audit

Prior checkpoint: b60faca, pushed to origin/codex/milestone-1-foundation-1007.
The full implementation is audited against the supplied plan in
[MILESTONE-1-AUDIT.md](MILESTONE-1-AUDIT.md). The audit identified and corrected
one remaining ownership gap: Neon Harvest's live rematch/solo and peak-state
scenarios now live in its game folder. Their assertions are preserved; shared
live-catalog checks use participant assignments rather than game state fields.
The extracted room fixture contains only generic authority/transport mechanics.
Direct discovery selects the relocated tests automatically, and the actual
scaffold fixture copies the supporting test fixtures for source typecheck.
Focused validation: 11/11, /private/tmp/milestone-ownership-focused.log.

Browser smoke used the local frontend on port 3031 and signaling on 8891 with
exact localhost origins configured. Both production games prepared a default-role
phone, used their expected touch fallbacks, reached results and returned to a
startable room. The phone reported round completion; host and phone console
warning/error logs were empty. Keyboard aim and pulse/whack buttons were exercised;
these are functional checks, not scoring or physical responsiveness measurements.
The host background warning appeared while another tab was selected and cleared
when the host returned to the foreground. No physical latency claim is made.

Motion permission reported granted on this desktop, but no sensor samples arrived.
The phone explicitly reported unavailable motion and retained touch fallbacks;
Motion Lab displayed Waiting for motion samples. Actual controls-owned
ControllerSettings and ControllerCalibration components were therefore exercised
in a separate disposable browser fixture with an explicitly synthetic port.
Sensitivity changed from 6 to 5.9, settings and calibration Recenter buttons each
dispatched commands, Done closed the panel, and reopening retained 5.9. Runtime
clamping/persistence/retired-port behavior remains covered by controller-input
tests; this browser fixture makes no sensor/physical calibration claim.

Durable browser evidence: [harness results](evidence/milestone-1/harness-results.jpg),
[live results](evidence/milestone-1/live-results.jpg),
[settings/calibration fixture](evidence/milestone-1/settings-calibration.jpg) and
[phone fallback](evidence/milestone-1/phone-fallback.jpg). Disposable UI fixture:
/private/tmp/controlla-settings-browser-proof. Copy phone link did not populate
the automated browser clipboard; navigation of the empty URL was rejected, so
joining used the ordinary setup form with displayed room/screen codes. No browser
security bypass was attempted. This clipboard limitation is not a room join failure.

Physical iOS/Android sensors, jolt tuning, real vibration and hosted P2P/TURN/relay
routes remain unverified. The plan requires recording them separately; they belong
to later device/hosting acceptance and are not certified by simulation. No hosted
service was deployed.

Final post-audit acceptance at the completed source tree:

| Gate | Result | Local log |
| --- | --- | --- |
| npm test | PASS, 470/470; no skipped/cancelled tests | /private/tmp/milestone-audit-test.log |
| npm run game:test | PASS, 192/192; no skipped/cancelled tests | /private/tmp/milestone-audit-games.log |
| npm run typecheck | PASS | /private/tmp/milestone-audit-typecheck.log |
| npm run lint | PASS | /private/tmp/milestone-audit-lint.log |
| npm run build | PASS, client/SSR/RSC boundary verified | /private/tmp/milestone-audit-build.log |

The full/game commands took approximately 232 seconds while running concurrently.
Actual logs include the relocated Neon tests, generated scaffold execution and all
16 catalog conformance cases. Both eight-player peaks match the audited bounds.
Build still reports informational unknown route classification; it succeeds.
No required foundation implementation or evidence remains. Latest commit and
HEAD/upstream equality are reported in the handoff after the explicit topic push;
this avoids a self-referential commit ID in the document. Original develop remains
unchanged; other worktrees and disposable proof checkouts are preserved. No merge
or deployment is performed. Future hosted/device acceptance is roadmap milestone 2.
