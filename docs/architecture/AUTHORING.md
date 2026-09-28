# Independent game authoring: Neon Harvest walkthrough

Status: the current accepted authoring example is the sole production descriptor, **Neon Harvest**. Controller and shell boundaries are implemented; **238 tests**, typecheck, project lint, and production build pass. Shell desktop observations and remaining physical-device checks are recorded in the [validation ledger](../VALIDATION.md). The interfaces remain repository-local and versioned with the application. Read the [baseline/provenance](BASELINE.md), [decisions/evidence](DECISIONS-EXPERIMENTS.md), and [meta-plan](../ARCHITECTURE-META-PLAN.md).

## Run the authoring environment

Run `npm run game:dev` and open `/dev/game-harness`. Simulated Ada, Bea and Cy need no rooms, signaling process, phones or permissions. The route is development-only. Pause, step 20 ms, finish a round, disconnect/return a player, or abort. The capability selector chooses touch fallback or simulated motion; host and delayed remote canvases consume the same encoded snapshot boundary. Cursor input on the host canvas and its discrete action are development input, not physical sensor evidence.

Game/mode choices come from the catalog. The current catalog contains only `neon-harvest`, with default mode `standard`; modes remain declarative for future descriptors. `npm run game:test` runs architecture wrappers, including discovered colocated game tests; `npm test` runs the full suite.

## Author the game

1. **Keep a complete game folder.** [`src/client/minigames/neon-harvest/`](../../src/client/minigames/neon-harvest/) owns metadata/factories, rules and state, Canvas rendering, and focused tests. Import author contracts from [`src/client/api/index.ts`](../../src/client/api/index.ts). Rules and renderer do not import runtime, transport, session authority, concrete controls or development tools. Assets, if added later, belong with the game.

2. **Name inputs and select a reusable layout.** The descriptor uses:

   ```ts
   controls: {
     inputs: {
       aim: { required: true, prefer: 'pointer', fallback: 'aim-pad' },
       pulse: { required: true, prefer: 'button', label: 'PULSE' },
     },
     controller: { layout: 'aim-and-pulse' },
   },
   ```

   The layout enables motion pointer and provides an absolute touch pad named `aim` plus a separate button named `pulse`. Raw pad output spans the signed square `[-1, 1]`; the controller adapter converts pointer fallback into normalized game aim. The pad holds its last accepted position on release/cancel and never emits a pulse. Arrow keys move it; Home explicitly centers it. `controller.bind` maps **game action → layout control name** when names differ. Authors implement no packets, generations, permission prompts or phone UI. `GameDescriptor.controls` uses the public `ControllerRequirements` contract. The engine projects the descriptor through `controllerSpec()` into a `ControllerSpec` with identity and control requirements only; it supplies no scoring or lifecycle metadata. `src/client/controls/resolve.ts` owns layout, assignment and capability validation for every caller and rejects incompatible required bindings before play.

   The unchanged transport supports four press slots and one resolved pointer/tilt action; repeated uses of the same sensor count as separate actions. Multiple generic touch vectors remain independent, and touch fallbacks count according to the controls actually resolved. A control preview does not bypass these runtime limits. Layout validation also rejects unimplemented legacy widget types; the former live engine adapter already applied that validation.

3. **Implement the lifecycle against semantic input.** `GameInstance<State>` implements `load`, `ready`, `start`, `tick`, `snapshot`, `finalize`, `disconnect`, `reconnect`, and `dispose`. A descriptor declares player bounds (1–8), duration (45 seconds), `modes` and `defaultMode`. The framework waits for load and controller ACKs, freezes eligibility, then begins a three-second countdown. Preparation has a 15-second deadline and host abort.

   `start(context)` receives mode, fixed players and authoritative start/end times. `tick(input)` receives phase, time, delta, presentation delay, values by player/action and accepted discrete actions. Values retain source `time`; optional `observedAt` records an unchanged held value observed again, not a new input event. Actions carry their own timestamp, captured normalized `aim` and optional detached activation `value`. Authors receive no session-award capability.

4. **Implement the accepted simple rules.** Neon Harvest uses seeded waves and analytic motion, with at most 70 nodes and 96 presentation effects. Moving collectors sweep their path against pickups; the closest path wins, and exact ties rotate by node ID against the fixed roster. Sparks give 10 game points and gold gives 30. The multiplier is `min(5, 1 + floor(chain / 5))`; a gap greater than 2400 ms resets the chain. Pickups in the last 10 seconds score double. Mines warm up for 1100 ms, deduct up to 50 points, reset the chain and stun for 1000 ms. A pulse is a discrete edge with a six-second cooldown and 170-pixel radius in the logical 1600×900 scene; it clears mines and collects pickups.

   Continuous collection, motion processing and spawning stop at the round cutoff. The existing 200 ms final arbitration accepts only actions timestamped in `[startAt, endAt)` and received strictly before `endAt + 200`. Settling processes terminal pulses with `dt: 0`, evaluating cooldown, stun and end-of-round bonus at the action timestamp; it does not roll back prior collections. Disconnect freezes that player's contribution while preserving earned score and eligibility. The excluded combat expansion has no role in this implementation.

5. **Own cloneable snapshots and presentation.** Nodes, player chains/cooldowns/stuns and counters are game-owned state, not a shared `GameState` union. `snapshot()` returns detached JSON-compatible data and `isState` validates it. State is bounded to 40 KiB, the whole envelope to 47 KiB including reserved cursor allowance. The framework owns round identity, phase, roster, cursor map, outcomes and compact progress. Optional interpolation must hold discrete values unchanged; invalid or throwing interpolation falls back to the prior valid state.

   `GameRenderer<State>.render` receives Canvas context, viewport, presentation time/delay and a deeply read-only snapshot. Optional read-only local cursors and reduced-motion preference are presentation inputs, not access to runtime or authority. Common countdown/results and player identity remain in the screen adapter. A successful draw may return known measurable event IDs; it never sends transport messages directly. Presentation events declare an explicit authority or presentation clock. Only known built-in sound kinds play; hydration never replays historical audio. Renderer failure is local to that display and disposes its renderer without aborting authority.

6. **Produce final outcomes, not session awards.** After the final drain, the framework calls `finalize()` once. Return every eligible player exactly once with `{ playerId, placement, score, stats? }`. Neon Harvest's metrics are `collected`, `bestChain`, and `mineHits`. Optional statistics are finite numbers, at most 16 keys (64 characters each), within 1 KiB UTF-8 JSON. Lower placement wins; ties receive equal awards. The session policy gives one point for each eligible opponent placed below a player. Repeated completion cannot add points again; abort closes the round without awards.

   Snapshots show game score, placement award and total only when the display timeline reaches that result. The authoritative ledger retains all participant totals and the latest 50 reports. Complete history hydrates separately in atomic bounded revisions; current-roster standings may use a ledger revision only once it is no newer than the displayed progress revision. Reports remain downloadable after host loss.

7. **Run headless, then register once.** From a script at the repository root:

   ```ts
   import { GameHarness } from './src/client/devtools/game-harness/harness.ts';
   import { neonHarvest } from './src/client/minigames/neon-harvest/index.ts';

   const harness = new GameHarness(neonHarvest, {
     mode: 'standard',
     remoteDelay: 80,
   });
   await harness.load();
   harness.advance(3000);
   harness.setValue('ada', 'aim', { x: 0.5, y: 0.5 });
   harness.press('ada', 'pulse');
   harness.advance(45_400);
   const snapshot = harness.display('remote');
   const progress = harness.progressView();
   harness.dispose();
   ```

   Register in [`src/client/minigames/catalog.ts`](../../src/client/minigames/catalog.ts). Shell, harness, designer usage and production bundle checks use that catalog; no second game registration or new engine/screen branch is needed. For live testing, start the ordinary frontend and signaling service and connect screens/controllers. Every role must use application protocol **4**; reload all existing participants after upgrading. Controller schema and binary frame stay unchanged.

## Contribute to the application shell

Start in [`src/client/shell/`](../../src/client/shell/). `JoinScreen` owns the join form; `ConnectedShell` subscribes and routes roles; `RoomScreen` owns host/display chrome; `ControllerScreen` and `ControllerMenu` own phone session UI; `DiagnosticsPanel` presents typed metrics. `App` composes these views, creates one session per join, closes it on leave/unmount, and supplies catalog metadata and the existing `GameCanvas` screen slot.

Use `ports.ts` for UI contracts and `runtime-adapter.ts` for concrete adaptation. A new view receives only its required snapshot/commands. Do not import runtime, motion, network, game implementations or tools into a view. Never expose resume tokens, mutable runtime collections, game state, raw wire messages or the snapshot buffer. Snapshots are detached and frozen; reading them does not sample presentation or replay audio. The existing controller config retains its public type annotations for compatibility but is frozen in each shell snapshot.

Preserve stable session commands/screen ports and captured widget generation/input epoch. New asynchronous work must retire on leave: motion permission and wake-lock requests can finish after teardown. Phone touch suppression must restore the previous body overscroll setting. Developer extensions remain injected by `DevelopmentApp`; their observation port cannot control raw motion internals.

Run `npm test`, `npm run typecheck`, `npm run lint -- --ignore-pattern '.worktrees/**'`, and `npm run build`. The shell adapter/lifetime tests and architecture graph checks cover immutable projections, command delegation, close/retry, stale ports, late browser promises and forbidden imports. Follow the [shell acceptance scenarios](NEXT-SHELL-BOUNDARY.md#acceptance-scenarios) for browser changes; preserve calibration and report availability. Game authors still use the game API and catalog, without shell edits.

## Exercise the boundaries

| Failure or edge                                                                 | Expected behavior                                                                                                                                                                  |
| ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Missing/wrong-kind binding, unavailable required input                          | Reject atomically in the controls resolver; the preview surfaces the error. Neon Harvest uses its named aim-pad fallback when motion is unavailable.                               |
| Load failure, false readiness, deadline or abort before begin                   | Close preparation without points; error/abort presentation must not reuse a previous round's picture.                                                                              |
| Invalid state, nonfinite score/statistic, duplicate/missing player, thrown rule | Reject before awarding; present a safe error envelope without trusting the broken snapshot producer.                                                                               |
| Render failure or unknown game/schema                                           | Failure stays local; incompatible display shows reload guidance. Malformed updates retain the last valid state and allow one outstanding resync per connection.                    |
| Disconnect/return or suspension                                                 | Clear stale input and retire callbacks; fresh configuration ACK/input is required. Fixed eligibility and prior score remain. Settling preserves already accepted terminal actions. |
| Pulse cooldown, stun, double-point boundary or exact tie                        | Use action time and deterministic fixed-roster tie order; no repeat pulse from holding the button and no rollback of collected nodes.                                              |
| Abort during settling or duplicate completion                                   | No abort award and no duplicate points. Cross-game policy uses test-only descriptors instead of shipping old games.                                                                |
| Delayed/reordered generic input                                                 | Validate generation, per-action sequence, timestamp, shape and configured binding; preview success alone is not transport evidence.                                                |

Controller contributors import shared contracts from `src/client/controls/api.ts`; UI view props remain in `src/client/controls/types.ts`. Definitions, ports, layouts and output contracts have no core or game dependency. `npm run control:new -- <type>` generates a definition importing the controls API and registers its type, definition, view and styles without editing core types; `--from` preserves the copied source, and duplicates fail without changes. Review of a real `--from stick` copy exposed over-broad renaming of a shared output type; the repaired generator preserves shared types and passes actual stick/dpad copy and typecheck regressions beyond the initial template fixtures. The aim-pad retains value on cancellation while releasing capture. The four-control probe still tests two independent vectors and two discrete actions. Tooling contributors use production contracts without pulling the harness or editors into gameplay bundles. Calibration, diagnostics, reports and Motion Lab are preserved in their existing production/development roles. Post-migration desktop checks exercised the gallery, designer play mode and standalone preview; the preview portrait guard appeared. Development Motion Lab opened and prompted to enable motion while waiting for samples; no sensor access was granted, so no physical motion-permission/orientation check is claimed.

**Contract decision.** Question → can the accepted simple game use only the author boundary? Options → retain a legacy adapter or implement one independent game and remove obsolete production paths. Proposed decision → accepted: Neon Harvest owns its rules/state/rendering and shared services own lifecycle, input safety, snapshots and awards. Evidence needed → game tests, import graph, delayed display, live browser flow and current production-bundle audit. Owner → implementing engineer/game owner. Dependencies → reusable aim-pad and shared framework contracts. Acceptance check → one catalog entry, immutable display data, meaningful preserved lifecycle/input/report tests, and no former-game dependency in production. Deferred scope → public SDK, separate packages, remote loading, alternate renderers, persistence, host migration and physical latency claims.

**Controller contract decision.** Question → should authors know a game-shaped resolver manifest? Options → retain the bridge or project only controller requirements. Proposed decision → implemented: public `ControllerRequirements`, narrow `ControllerSpec`, and one validated controls-owned resolver. Evidence needed → descriptor/config equivalence, capability/binding/capacity failures, actual generator fixtures and dependency enforcement. Owner → controller/integration engineer. Dependencies → contract and resolver checkpoints plus the existing semantic-input adapter. Acceptance check → 224 integrated tests pass; no `Manifest`, core resolver, `controllerManifest` or moved aliases; protocol/config/layout/binary shapes stay unchanged. Deferred scope → new provider lifecycles, packet formats, more games and broad source relocation.
