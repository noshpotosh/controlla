# Audit and roadmap: stabilise the core, then split by minigame

> **Superseded.** This document is kept for history. The current roadmap is [ROADMAP_FINAL.md](ROADMAP_FINAL.md).

Audited `develop` at `5817ca8` on 2026-10-06, by reading the code and git history. The test suite was not run for this audit, so pass/fail status is unverified.

The goal: freeze the shell, game screen, engine and input plumbing so two people can split the remaining work by minigame, with reusable controllers and deterministic tests that keep games and inputs consistent.

## Audit

Rough distance to each goal (estimates from the findings below, not measurements):

| Goal                                   | Estimate |
| -------------------------------------- | -------- |
| A game is self-contained               | 85%      |
| Touch controls are self-contained      | 90%      |
| Motion inputs are self-contained       | 40%      |
| Shell and controllers are separated    | 70%      |
| Tests keep games and inputs consistent | 50%      |

### 1. Can a new game be added without touching the underlying APIs?

**Mostly yes, if the game uses inputs that already exist. No, if it needs a new motion input.**

What already works:

- A game is one folder under [`src/client/minigames/`](../src/client/minigames/) exporting a `GameDescriptor` from the [author API](../src/client/api/index.ts), registered with one line in [`catalog.ts`](../src/client/minigames/catalog.ts).
- [`tests/architecture-boundaries.test.ts`](../tests/architecture-boundaries.test.ts) enforces that a game imports only its own folder and the author API, and that the catalog is the only production importer of a game.
- The shell, game screen and `GameCanvas` have no per-game branches.
- A headless [harness](../src/client/devtools/game-harness/harness.ts) and the `/dev/game-harness` page run a game with simulated players.

What a new game still has to touch outside its folder:

| Touch point                                                                                                                                  | Why                                                               |
| -------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| [`scripts/production-boundary.ts`](../scripts/production-boundary.ts), [`tests/developer-bundle.test.ts`](../tests/developer-bundle.test.ts) | Hardcoded list of each game's three files                         |
| [`tests/engine-round.test.ts`](../tests/engine-round.test.ts) (line 221)                                                                     | Hardcoded list of catalog IDs                                     |
| [`tests/live-catalog.test.ts`](../tests/live-catalog.test.ts) (line 137)                                                                     | Hardcoded stat keys per game                                      |
| [`src/client/runtime/browser/sounds.ts`](../src/client/runtime/browser/sounds.ts)                                                            | Sound cues live in one core table; a new cue is a core edit       |
| [`src/client/controls/layouts/`](../src/client/controls/layouts/)                                                                            | A new layout if no existing one fits (made in the designer; fine) |
| [`vite.config.ts`](../vite.config.ts)                                                                                                        | Only if the game adds a lazily loaded dependency, as three.js did |

Evidence from history: merging Whack-a-Mole (`ebc4979..389bda6`) changed about 75 files outside its own folder. Nearly all of that was the new `chop` input and anchored aim, not game registration. The game-facing core changes were small: `arbitrationMs` and `localPressing` in the API, about 30 lines in the engine and about 30 in the game screen.

Limits in the game contract that the [backlog](MINIGAMES.md) will hit:

- **Fixed-duration rounds only.** `RoundRunner` ends at `startAt + durationMs`; a game cannot end early or run turns (Bowling, Golf, Darts).
- **One controller layout per game.** No per-player roles (Jam Session, Bomb Squad).
- **No game-to-phone channel.** A game cannot vibrate or message one player's phone.
- **No game scaffold.** `control:new` exists; there is no `game:new`.

### 2. Are controllers self-contained and reusable?

**Touch controls: yes. Motion inputs and four legacy widgets: no.**

- Six library controls (`button`, `dpad`, `stick`, `aim-pad`, `swipe-pad`, `hold-meter`) each live in a folder with a definition, logic, view and styles. They talk only to a `ControlPort`, are registered in `registry.ts` and `views.ts`, and are scaffolded by `npm run control:new`. Games name them and never draw them. See the [controls README](../src/client/controls/README.md).
- Motion inputs (`pointer`, `tilt`, `shake`, `chop`) have no definition. Each is spread over about ten places:
  - [`src/client/controls/motion/`](../src/client/controls/motion/) (algorithms)
  - [`controller-input.ts`](../src/client/runtime/controller-input/controller-input.ts) (per-type branches in a 556-line class)
  - `ControllerConfig.sensors` in [`controls/api.ts`](../src/client/controls/api.ts) (a fixed struct with one field per sensor)
  - `available()` in [`resolve.ts`](../src/client/controls/resolve.ts) and the `legacy` table in [`registry.ts`](../src/client/controls/registry.ts)
  - `SensorTile.tsx`, `shell/LegacyWidget.tsx`, `shell/ports.ts`, `runtime.ts`, `shell/runtime-adapter.ts`, `app/globals.css`
- `jolt` is wanted by five backlog games and would repeat that whole path.
- `slider`, `dial`, `text` and `draw-canvas` exist only in [`shell/LegacyWidget.tsx`](../src/client/shell/LegacyWidget.tsx). They are not registered and fail the layout resolver, so no game can use them yet.
- Transport caps a controller at four press slots and one motion vector (`pointer` or `tilt`).

### 3. Is the shell separated from the controllers, and the reverse?

**Controllers do not depend on the shell (enforced). The shell still contains controller code.**

- `shell/LegacyWidget.tsx` (319 lines) implements the chop tile, pointer preview, slider, dial, text and draw canvas, with their CSS in `app/globals.css`.
- `PhoneActions` in [`shell/ports.ts`](../src/client/shell/ports.ts) has input-specific members: `chopCount`, `holdAim`, `previewPoint`. Each new motion input widens the shell port, the runtime and the adapter.
- `ControllerScreen.tsx` owns the aim-calibration UI, and `ControllerMenu.tsx` reads `config.sensors.pointer` and `tilt` directly.
- Shell to engine, screen and runtime is clean: views get frozen snapshots and narrow ports, checked by tests.

### 4. Deterministic tests

**The framework is well covered; consistency across games and across inputs is not.**

- Present: 45 test files, import-graph enforcement, seeded game randomness (seed derived from `startAt`), and two loops over the catalog ([`architecture-harness.test.ts`](../tests/architecture-harness.test.ts) line 30, [`live-catalog.test.ts`](../tests/live-catalog.test.ts) line 141).
- Missing: a shared conformance suite for games. Each game's test hand-rolls its own fixture and reaches private state with `Reflect.get`. The same invariants are rewritten per game: isolated snapshots, `isState` accepts its own snapshot, every player appears in `finalize` once, 8-player state stays under 40 KiB, disconnect and reconnect.
- Missing: a replay check that the same seed and input script produce identical snapshots twice.
- Missing: a shared conformance suite for controls (value shape matches `kind`, release and cancel neutralise, `rotateOutput` round-trips).
- `npm run game:test` runs `tests/architecture-*.test.ts`, which its name does not suggest.

### 5. Other gaps

- Docs are stale: [`AUTHORING.md`](architecture/AUTHORING.md) calls Neon Harvest the sole game; [`MINIGAMES.md`](MINIGAMES.md) lists Latency Lab and Tilt Rally as built, but they were removed.
- There is no CODEOWNERS file or written rule for what counts as core.
- Large local files (such as disc images) in the repository root are not ignored; a stray `git add` would commit them.

## Roadmap

### Phase 0: agree the freeze (both)

- [ ] Define core as `src/client/{api,engine,runtime,transport,game-screen,shell}` and `src/shared`. Add `.github/CODEOWNERS` so core changes need both reviewers; game and control folders need one.
- [ ] Ignore large local binaries in `.gitignore`.
- [ ] Settle the open decisions below. Three contract changes are already agreed to go in before the freeze: early round end and turns, per-player controls, and game-to-phone feedback. Agree each one's API shape together before either lane implements it.

### Phase 1: foundation, two parallel lanes

Work each lane top to bottom. The lanes meet in two files only: [`controls/api.ts`](../src/client/controls/api.ts) (Lane A owns) and the [author API](../src/client/api/index.ts) (Lane B owns).

#### Lane A: inputs and phone

Covers the controls library, runtime input and the shell's controller screen.

- [ ] **Motion input definitions.** Give motion inputs a definition in `src/client/controls/` (availability check, channel, kind, detector factory, on-phone tile). `controller-input.ts` iterates registered motion processors instead of branching per type; `ControllerConfig.sensors` becomes a generic map; `available()` and the `legacy` table move into the definitions. Depth is an open decision (see below).
- [ ] **Remove input-specific shell members.** Replace `PhoneActions.chopCount`, `holdAim` and `previewPoint` with a generic per-control local-state and feedback port; move `ChopTile` and `PointerPreview` into controls.
- [ ] **Port legacy widgets.** Move the ones a planned game needs into the library with `control:new`; delete `LegacyWidget.tsx`; move their CSS out of `app/globals.css`.
- [ ] **Build `jolt`** as proof of what a new motion input now costs.
- [ ] **Control conformance suite** in `tests/`, looping over every control and motion definition.
- [ ] **Boundary tests:** the shell contains no control implementations; shell ports name no input type.
- [ ] **Game-to-phone feedback.** A game returns per-player feedback alongside its presentation events; the phone delivers it. Lane B reviews the author-API addition.

#### Lane B: game kit and screen

Covers the author API, engine edges, tests and tooling.

- [ ] **Game conformance suite.** `tests/kit/game-conformance.ts`, run for every catalog entry: lifecycle, snapshot isolation, `isState`, outcomes, 8-player budget, disconnect and reconnect, and a determinism replay. Reuse `GameHarness`, `driveSimulatedPlayers` in [`simulation.ts`](../src/client/devtools/game-harness/simulation.ts) and `snapshotPolicy`.
- [ ] **Scenario helper** for per-game rule tests, replacing the `Reflect.get` fixtures in both game tests.
- [ ] **Remove hardcoded game lists.** Derive them from the catalog or directory in `scripts/production-boundary.ts`, `tests/developer-bundle.test.ts` and `tests/engine-round.test.ts`; replace `statKeys` with a descriptor-declared stats list.
- [ ] **`npm run game:new`**, modelled on [`scripts/new-control.ts`](../scripts/new-control.ts), generating descriptor, game, renderer, test and catalog line.
- [ ] **Game-owned sounds.** Let a descriptor declare its synthesized cues; `sounds.ts` keeps only shared ones.
- [ ] **Early round end and turns.** Let a game signal completion before `endAt`; extend `RoundRunner` in [`round.ts`](../src/client/engine/round.ts) and the settling tests. Countdown and results screens stay framework-owned.
- [ ] **Per-player controls.** Let a descriptor give controller requirements per role. The session already resolves one config per player, so the change is in `controllerSpec()` in [`engine/input.ts`](../src/client/engine/input.ts) and the descriptor type. Lane A reviews the resolver side.
- [ ] **Refresh docs:** `AUTHORING.md`, `MINIGAMES.md`, `INPUTS.md`; rename `game:test`.

### Phase 2: exit check (both)

- [ ] One person adds a small throwaway game using only `game:new`, an existing layout and the conformance suite. The diff must stay inside the game folder plus one catalog line. If it does not, fix the leak before splitting.

### Phase 3: games, split by game

Each person owns whole games from the [backlog](MINIGAMES.md). First picks that need no new inputs: Target Practice, Basketball, Saber Slash, Brawl. `jolt` games (Bowling, Golf, Chop Shop) follow once Lane A builds it. Core changes go through the CODEOWNERS rule.

## Open decisions

Each has a recommendation; none is settled yet.

| #   | Decision                                                                                                             | Recommendation                                                                             |
| --- | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| 1   | Is the partner a human or an agent? This sets how detailed each lane item must be.                                   | Write for whichever is true; an agent needs a brief and a named passing test per item.     |
| 2   | What diff is allowed in the Phase 2 exit check?                                                                      | Game folder, one catalog line, optionally one layout JSON.                                 |
| 3   | May the foundation change the wire protocol (now 4, 47-byte frame, four presses and one motion vector)?              | Allow one bump during the foundation, owned by Lane A, then freeze.                        |
| 4   | How deep is the motion-input refactor: a full definition seam, or only moving controller code out of the shell?      | Relocate only, build `jolt` by hand, and add the seam if a third new motion input appears. |
| 5   | Does "turns" mean early end, untimed rounds, or engine-owned turn order?                                             | Early end and untimed rounds with a safety cap; turn order stays game logic.               |
| 6   | Are per-player controls fixed for the round or swappable mid-round?                                                  | Fixed per round.                                                                           |
| 7   | How much can a game put on a phone: haptics, a status line, or its own UI?                                           | Haptics plus a short status line and an enabled state. Games never draw controls.          |
| 8   | Which four to six games are next? This decides whether `jolt`, `dial`, `text` and `draw-canvas` are foundation work. | One existing-input game, one turn-based `jolt` game, one per-role game. Delete `slider`.   |
| 9   | Should the three.js stage become a shared kit?                                                                       | Leave it game-owned until a second 3D game exists.                                         |
