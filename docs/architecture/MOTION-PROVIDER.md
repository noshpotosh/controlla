# Controller motion lifecycle

Implemented on `codex/controller-motion-lifecycle-0928` from fetched architecture integration checkpoint `df751f7`. This slice adds lifecycle behavior and moves motion ownership; it does not decompose runtime/network or introduce new packet formats.

## Ownership and contracts

`src/client/controls/motion/` owns the browser provider, pure sensor processor, calibration, pointer processing, trace format and immutable snapshot contracts. General `Point` and `clamp` remain in `core/types.ts`; `Quaternion` belongs to calibration. Old motion/core modules have no forwards. The replay tool now feeds recorded samples directly into the pure processor without browser stubs.

The provider owns permission requests, event listeners, sample observation and availability timers. Its injected environment supplies the monotonic clock, permission API, browser metadata, event listener and scheduler. `enable` coalesces requests and invokes permission inside the user gesture. `start` is an advisory request used by configuration and diagnostics; only `resume` can clear suspension. `suspend` detaches events and timers. `dispose` is permanent and idempotent; stale event/timer callbacks and late permission results cannot revive it.

`getSnapshot` returns detached, recursively frozen status, permission, capabilities, sample freshness, processing output and a timing epoch. Status subscriptions notify on status/permission/availability changes, not every sensor sample. Diagnostic observations receive separate sample copies and cannot mutate processing or interrupt it. The Motion Lab retains its narrow start/subscribe/recent-samples/permission port.

The provider graph admits only its own modules, the declaration-only controller API, and general core geometry. It rejects runtime, network, engine, shell, game, developer-tool and external package dependencies, including erased/indirect imports and opaque loading.

## Availability and recovery

- Permission and availability are separate. A granted browser stays sampling while active, even when the host resolves touch fallback. Acceleration and gyro are validated independently; null/nonfinite vectors are unavailable. Tilt/shake require acceleration, while pointer needs both.
- The initial sample deadline is 1,800 ms. Freshness expires at 500 ms; advertised sensor availability expires after 2,000 ms without a valid sample. Invalid events withdraw the affected sensor immediately. Fresh valid samples automatically restore availability without another permission prompt.
- Runtime holds stale pointer position, neutralizes stale tilt, and never repeats a shake from a previously consumed sample. Integration resets across sampling gaps and suspension. Recovery anchors to the last displayed aim and retires old press history while preserving sensitivity and calibration.
- Hidden/pagehide suspends sampling; visible/pageshow resumes granted sampling. Configuration, diagnostics and aim-settings actions cannot override suspension. Reconnect/roster synchronization republishes capabilities, and permanent session end disposes the provider.
- Runtime transports capability changes through existing host negotiation. The host resolver still owns fallbacks, required-input errors, generations and ACK admission; ordinary samples do not send capability messages. No fallback is invented when a descriptor requires motion without one.
- The shell exposes a read-only motion status and distinguishes permission granted, waiting for samples, active samples, suspended and unavailable. Diagnostics remains observation-only.

## Compatibility and acceptance

Protocol 4, the 47-byte frame, layout schema 2, resolved configuration schema 1, one binary motion vector, host authority and normal pointer/calibration algorithms are preserved. The added `GyroPointer.resumeAt` retires integration history at recovery without changing normal input processing. No dependency, deployment, data migration or extra sensor is introduced.

Deterministic provider tests cover permission failure/retry/coalescing, no samples, partial/invalid sensors, freshness/stall thresholds, automatic return, stale callbacks and immutable observation. Runtime tests exercise real host fallback/recovery generations, obsolete ACK rejection, reconnect capability refresh, stale tilt/shake, configuration during suspension, pageshow and a moved cursor returning without a jump. Existing replay, pointer, input, lifecycle and production-boundary checks remain required.

See the [validation ledger](../VALIDATION.md) for actual automated and desktop observations. Mock events are not evidence of physical sensor compatibility or device latency. Real-phone/TV/network acceptance remains separate.

## Delivery and recovery

Topic checkpoints are pushed to origin and the PR targets `codex/architecture-integration-0928`. Existing worktrees remain intact; there is no merge into integration/main or deployment. Revert this slice's implementation commit to recover previous ownership and lifecycle behavior; no data conversion is needed.
