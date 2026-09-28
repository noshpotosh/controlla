# Session routing ownership

Implemented at `d880905` on `codex/session-routing-0928`, worktree `.worktrees/session-routing-0928`, from fetched integration checkpoint `4362666`. Display playback and controller input are prerequisites. No deployment or merge is included.

## Responsibilities and interfaces

`src/client/runtime/session-routing/session-router.ts` owns role-based incoming dispatch, upstream control/frame routing, host-to-venue/player delivery, controller relay envelopes, and local cursor admission. Its explicit operations are `welcome`, `setRoster`, `setControllerRoute`, `receive`, `sendUp`, `sendFrame`, `toVenue`, `toPlayer`, `cursors`, `disconnect`, `end`, and `dispose`.

The injected environment supplies local/authority clocks and deferred scheduling. Effects send transport messages or invoke authority input/control, display delivery, and controller delivery separately. The router retains copied routing identity fields without credentials, a copied roster, and detached frozen cursor observations. It has no Runtime, Network, SessionAuthority, browser provider, or DOM reference. `Channel` now lives in `engine/messages.ts`; no old-path re-export remains.

Runtime composes callbacks and owns authority construction, clock synchronization, fallback selection/connection establishment, progress, browser resources, motion lifecycle, reports and shell projections. Network retains WebRTC/WebSocket connections, transport admission, reconnects, history queues, backpressure and statistics. The game, controller and screen APIs remain unchanged.

## Routing and lifecycle

Sender/venue/seat checks and relay envelopes are preserved. Local cursor visibility requires a trusted configuration, matching ready ACK, connected local player, matching generation, forward sequence and the existing timestamp window. Cursor expiry remains one second after the last accepted frame. Cursor rejection does not replace authority admission: valid decoded input still reaches authority or the venue relay, whose existing validation decides gameplay admission.

Host-local delivery remains deferred and is copied when scheduled. Every queued callback captures the routing epoch. Disconnect and replacement welcome retire queued delivery and cursor admission; end/disposal permanently suppress effects and cannot be revived by late welcome, roster, input, or ACK callbacks. Runtime injects a wrapper around the browser's `queueMicrotask` so the scheduling callback cannot rebind its browser receiver.

Protocol 4, 47-byte input frames, 48-byte seat-prefixed relays, layout schema 2, controller configuration schema 1, report version 2, 200 ms settling, and host-browser authority are unchanged. No data migration, dependency change, backend rename or broad relocation is required.

## Enforcement and acceptance

The existing TypeScript graph checker admits router-local modules, shared room contracts, message/protocol contracts and pure core geometry only. It checks erased/transitive/alias/re-export/dynamic edges and rejects opaque or unresolved dependencies. Only Runtime and router-local production modules can consume the implementation. The production bundle audit requires the router module.

**297 tests, typecheck, lint and production build/bundle audit pass.** Twelve deterministic router tests cover routing and cursor behavior, two boundary tests enforce ownership, and a runtime regression covers the browser scheduler receiver and close-time retirement. Existing socket, input, motion, playback, shell, reconnect and report regressions remain passing. Test fixtures now invoke welcome/roster handlers rather than relying solely on direct view assignments.

Desktop acceptance used one host, a remote display, and one simulated phone per screen. Completed round/rematch standings matched; phone reload preserved identity and seat; abort retained totals; host loss retained results and produced a verified version-2 JSON report. The first browser attempt exposed the scheduler binding issue, which was fixed before checkpointing and successful acceptance. See [validation](../VALIDATION.md#session-routing--2026-09-28) for exact evidence and physical-device limitations.

## Delivery and recovery

The implementation checkpoint is pushed to origin; the draft PR targets `codex/architecture-integration-0928`. Existing worktrees and branches are preserved. Reverting `d880905` restores previous runtime ownership without data conversion. Further transport, browser-resource and progress decomposition remain separate slices.
