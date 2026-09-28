# Runtime composition and transport ownership

Implemented on `codex/runtime-decomposition-0928` in the main checkout from fetched integration `7e8de1f`. That baseline already integrated motion (`34912ee`), playback (`3fa3714`), controller input (`0e50a08`), and routing (`d880905`, with scheduler typing repair `27f1282`). This slice preserves and completes those extractions rather than replacing their behavior.

## Owners and collaboration

`src/client/runtime/runtime.ts` composes session identity/roster, host authority, clock synchronization, schedules, and the shell projection. Only the shell runtime adapter consumes that concrete composition. Game author APIs and shell ports are unchanged.

| Owner under `src/client/runtime/` | State and responsibilities | Injected collaboration |
| --- | --- | --- |
| `playback/` | Snapshot reconstruction, progress assembly/history, phases, presentation events and acknowledgments, cursor generation/ACK/order/freshness admission and immutable observations | Catalog policy/support predicate; explicit acknowledgment, recovery, and audio effects; authority/local times |
| `controller-input/` | Copied configuration, control lifetimes, aim settings, touch/motion processing, press history, per-action sequencing and trailing throttles | Clock/scheduler, immutable motion snapshots and frame/reliable/haptic effects |
| `session-routing/` | Role/sender/venue admission, relay envelopes, host-local deferred delivery, upstream routing and eight-second direct-host fallback selection | Transport availability/sending, authority callbacks, playback/controller dispatch and cursor observation port |
| `browser/` | Visibility/page listeners, before-unload warning, audio and wake-lock handles; report download adapter | Browser environment and lifecycle/wake-state callbacks |
| `diagnostics/` | Link statistics, telemetry copies, disconnection history, panel measurement and version-two report assembly | Detached read-only source snapshots, statistics request and publish callback |

`src/client/transport/` owns the existing Network implementation. `contracts.ts` declares `Transport` and `LinkStats`; the transport interface covers connection callbacks, sending, channel availability, fallback connection, statistics, and close. WebRTC, signaling/reconnect, relay and queued history algorithms are preserved. Runtime accepts optional transport and browser-environment injection after its existing options/motion arguments; ordinary construction uses production defaults.

Each collaborator has declaration-only contracts. Cursor observations have a separate shared runtime contract; the router never imports concrete playback. No collaborator accepts Runtime or RuntimeView. Engine graphs exclude the complete runtime and transport domains. Browser resources, diagnostics and transport have explicit transitive dependency allowlists, including erased imports. Production consumers cannot bypass runtime composition, and all former runtime/network/collaborator source paths are absent without forwarding modules.

## Lifecycle and compatibility

Start and close are idempotent. Welcome/reconnect retires queued host-local delivery and pending clock probes; old statistics requests cannot publish into a new connection lifetime. Session end stops periodic timers, pending probes, browser listeners, motion subscriptions/provider, routing, input and presentation effects. Late audio/wake grants are ignored or released, and statistics completion cannot send or notify after retirement. Browser suspension disables input and motion; page return restores the established provider policy. Completed progress and reports remain readable after host loss.

Preserved: host-browser authority, protocol 4, the 47-byte input frame and 48-byte venue envelope, controller layout schema 2, resolved configuration schema 1, 200 ms settling, report version 2, stable shell/screen/control ports and developer-tool isolation. No new dependency, game, data migration, transport redesign, backend rename or deployment is included.

## Checkpoints and acceptance

| Checkpoint | Change | Automated gate |
| --- | --- | --- |
| `cb91936` | Runtime/transport ownership and injection seam | 297 tests |
| `d957bf5` | Playback progress and cursor ownership | 297 tests |
| `3ab10ec` | Controller configuration and aim ownership | 298 tests |
| `e770de9` | Routing-owned fallback selection | 299 tests |
| `1249470` | Browser resources, diagnostics and retirement guards | 305 tests |

Every listed checkpoint also passed typecheck, project lint, production build and bundle assertions, and was pushed to the topic branch. Final declaration/consumer/bundle enforcement and desktop acceptance are recorded in [VALIDATION](../VALIDATION.md). The original integration baseline and subsequent additive checkpoints remain recoverable; no shared history was rewritten. Use additive reverts in reverse order to restore prior ownership; no data conversion is required.

Further work is the real-phone/TV/network acceptance matrix and the separately recorded designer markup warning. Splitting transport internals, adding games, persistence and host migration remain deferred. This branch is not merged or deployed.
