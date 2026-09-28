# Controller input ownership

Implemented on `codex/controller-input-0928` in `.worktrees/controller-input-0928`, from fetched architecture integration checkpoint `2a32c59` (including display playback). This is a behavior-preserving extraction with stale-callback lifecycle safeguards.

## Responsibilities and interfaces

`src/client/controller-input/controller-input.ts` owns phone-side `ControllerInput`: configuration-bound control ports and epochs, detached validated values, per-action sequence/time capture, 30 ms trailing throttles, atomic activation payloads, reliable presses and binary press recovery, frame scheduling, motion-to-pointer/tilt/shake processing, pointer smoothing and press anchoring, sensitivity and recenter counters.

The injected environment provides local/authority clocks and asynchronous timeout scheduling with cancellation. Focused effects emit an encoded input frame, a widget/press message without transport identity, or a haptic request. Each tick receives an immutable motion snapshot. Configuration is copied on admission; status returns a detached frozen epoch, point, sensitivity and recenter count. The collaborator has no Runtime, Network, browser provider, DOM, storage or session-authority reference.

Runtime retains its existing shell-facing methods as delegations. It owns transport routing and venue fallback, trusted configuration admission and ready ACKs, capability negotiation, page visibility and connection state, sensitivity persistence, sensor permissions/sampling, audio/wake lock, received cursor admission, playback composition, authority and progress. Runtime projects input epochs into the existing shell view before notifying subscribers.

The subsequent [session-routing slice](SESSION-ROUTING.md) moves message routing and received cursor admission out of Runtime. Fallback selection, ready ACKs and lifecycle composition remain Runtime-owned.

## Lifecycle and compatibility

Configuration generation or config-ID changes retire old ports and pending values and reset generation-specific sequences. Repeated configuration preserves the current lifetime. Inactivity retires ports, pending timers and held state while retaining same-generation sequence history. Resuming cannot revive retained ports or burst old frames. End/disposal are permanent and idempotent, including late timer callbacks and haptics. A timer also checks the pending-entry identity so a canceled callback cannot flush newer work for the same action.

Pointer algorithms, freshness rules, shake deduplication, cadence, source timestamps and activation payloads are preserved. Motion provider epochs retire integration/press history on recovery. No wire/schema migration or new controller capability is introduced: protocol 4, 47-byte frames, layout schema 2, configuration schema 1, report version 2, 200 ms settling and host-browser authority remain unchanged.

## Enforcement and validation

The existing TypeScript graph checks enforce an explicit dependency allowlist, including erased, indirect, alias, dynamic and reexport edges. Only Runtime and collaborator-local production files can import the implementation. Registry definition metadata keeps the existing erased IconName vocabulary exception; runtime execution of icon UI or external packages is rejected. Production bundle positive controls require the new module.

The full suite passes 282 tests, typecheck, lint and production build/bundle checks. Ten standalone tests cover source-value capture, independent throttles, retired timers, identity/sequence lifetimes, suspension, terminal effects, activation values and counter wrapping, 60 Hz cadence without catch-up, motion freshness, pointer recovery/anchoring/settings, and detached observations. Two new boundary tests cover dependency and consumer enforcement. Existing runtime tests now apply configuration through the runtime handler and inspect emitted effects rather than bypassing input ownership.

See the [validation ledger](../VALIDATION.md) for desktop acceptance and remaining device limitations. Software and desktop checks do not establish physical sensor compatibility, TV or cross-household latency.

## Delivery and recovery

Checkpoints are pushed to origin; the draft PR targets `codex/architecture-integration-0928`. Existing worktrees remain intact. Reverting the extraction restores Runtime ownership without data conversion. No merge or deployment is included. Further network, browser-resource and progress decomposition remain separate slices.
