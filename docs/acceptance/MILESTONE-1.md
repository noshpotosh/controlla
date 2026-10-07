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

Compatibility proposal: retain protocol 4 / 47-byte binary frame with bounded
feature negotiation and reject unsupported peers before new-feature rounds.
The earlier possible protocol 5 migration was superseded during analysis by this
conditional protocol 4 design. Implementation must test negotiation; if safe
compatibility cannot be demonstrated, return for a separately reviewed bump.

**Approval status: PENDING.** No shared-contract/runtime implementation authorized
past this explicit gate yet. Original request to implement the plan is not recorded
as approval of signatures drafted afterward. User amendments/approval must be
recorded here before shared implementation proceeds.

## Checkpoints and remote backup

- Checkpoint 0: documentation/ownership prerequisite prepared; all baseline
  automated gates pass. The first topic commit saves these review artifacts.
- Resolve exact commit with `git log -1` or the first commit after baseline; the
  commit ID is reported in the chat handoff to avoid self-referential doc commits.
- Remote backup status: pending initial push at time of this record; update after
  push. No implementation checkpoint 1–6 complete.

## Remaining work and evidence

After user contract review: discovery repair, motion registration and retirement,
jolt, lifecycle/roles, feedback/sound, replay/conformance, game scaffold and final
integration/documentation. Execute the full required test/typecheck/lint/build
gates at each appropriate checkpoint and final acceptance.

Browser smoke checks for both games, touch fallback, settings/calibration and
harness flows: not run in this prerequisite-only checkpoint. Physical sensors,
haptic behavior and hosted-network evidence: not measured. Synthetic traces or
passing tests cannot certify those checks. No deployment, merge, new production
game, art overhaul or party-session work performed. Milestone 1 cannot close from
this baseline evidence alone.
