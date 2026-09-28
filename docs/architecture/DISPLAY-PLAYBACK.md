# Display playback ownership

Implemented on `codex/display-playback-0928` in `.worktrees/display-playback-0928`, from fetched architecture integration checkpoint `8a059ef` (which includes motion checkpoint `34912ee`). Automated acceptance passed at delivery; the subsequent controller-input slice closes multi-client desktop acceptance on the combined build. The original run was blocked by browser URL policy. See the [validation ledger](../VALIDATION.md).

## Responsibilities and interfaces

`src/client/playback/display-playback.ts` owns `DisplayPlayback`: snapshot timeline admission/sampling, missing-base recovery, compatibility errors, presentation cue queues and duplicate tracking, retired rounds, visible-marker acknowledgments, and snapshot diagnostics. The snapshot buffer is private and no longer exposed by Runtime.

Runtime injects the existing catalog snapshot policy and game/mode support predicate. Calls supply authority time, clock readiness, and detached local cursor positions. Playback accepts snapshot/event/phase data through focused methods; it never receives Runtime, RuntimeView, Network, or session authority. Effects are explicit callbacks for snapshot ACK, resync, venue statistics, presentation ACK, recovery warning and due audio cue. Read-only getters expose delay, limiting venue and the last immutable sampled state for the existing shell projection.

`ScreenPort` and `ScreenFrame` are unchanged. Runtime delegates frame advancement and presentation acknowledgments, reflects accepted phase/delay/sample values into its view, and reads playback metrics for diagnostics and the existing version-2 report shape. Keeping the last sampled state separate from a phase-filtered frame preserves the prior shell/standings semantics. Both host loopback and trusted remote messages reach the same playback instance.

Runtime still owns message authentication/routing, clock synchronization, local cursor admission, progress assembly/history, controller input, motion, browser audio/wake lock, and session authority. Network retains WebRTC, relay and reliable history delivery. Rendering remains screen-owned.

## Lifecycle and compatibility

Disconnect clears pending cues. Welcome resets the missing-base request latch so a lost resync request can be retried. Full snapshots clear the latch and recovery warning. Event queues remain bounded at 256 pending cues, 2,000 deduplication keys and 50 retired rounds. Authority/presentation clocks, one-second stale-cue cutoff, delayed results and marker deduplication retain their prior behavior.

End and disposal are terminal and idempotent: late snapshots, events, phases and marker callbacks produce no playback effects. Runtime marks playback terminal before notifying session-end observers or closing transport. Snapshot evidence and completed progress remain available for report export; progress stays owned by Runtime.

Dependency checks allow only playback-local code and the explicit replication, timing, public contract and screen helper/port dependencies. They include erased imports, aliases, reexports, literal dynamic imports and transitive helpers; opaque, unresolved and external imports fail. Engine, screen and shell leaves cannot depend on playback implementation.

There is no protocol/schema migration, new dependency, gameplay change or deployment. Protocol 4, the 47-byte input frame, layout schema 2, configuration schema 1, report version 2 and 200 ms settling remain unchanged.

## Acceptance and recovery

Baseline: 260 tests. The completed extraction passes 270 tests, typecheck, lint and production build/bundle checks. Direct tests run with a fixture snapshot policy and callback recorder without networking, motion, browser globals or a production game. Existing screen tests remain runtime integration checks, and the socket test explicitly samples host and remote frames from the same round.

Current desktop evidence is limited to HTTP 200 and host-room creation. Browser policy blocked adding the controller client; completed round, rematch, reconnect, abort and post-host-loss file download remain unverified for this slice. This historical gap is now closed by the subsequent [controller-input acceptance](../VALIDATION.md) on the combined build; the original run above remains limited. Hardware/network measurements remain separate.

Revert the topic implementation commit to restore the previous ownership; no data conversion is required. Preserve the source branch and worktree. Further controller-input and network decomposition belongs in a subsequent bounded slice.
