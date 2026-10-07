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

## Compass and aim anchoring

Added on `feature/compass-anchor` (from `feature/whack-a-mole` `06191ef`). The pointer moves by turn speed, so any turn it does not show becomes a lasting offset between where the phone points and the cursor. Anchoring keeps a tally of those turns and wins them back.

- The provider also listens for orientation events under the same lifecycle: `deviceorientationabsolute` on Android, and `deviceorientation` with `webkitCompassHeading`/`webkitCompassAccuracy` on iOS. Suspension and dispose detach them, and stale callbacks are ignored. The latest reading rides on the next motion sample as `RawMotionSample.orientation`, so recordings and replay see exactly what live processing saw. The compass is never required. It never affects status, availability, capabilities, `pointerFresh` or host negotiation.
- The processor exposes `aim`: the heading and elevation of the phone's top edge. Elevation comes from gravity, as tilt already does. Heading is the gyro's, held to the compass by `HeadingFilter` (tuning in `COMPASS`):
  - Each reading is compared with where the gyro had the phone when it was taken, to allow for the compass's lag.
  - It is applied only while the phone turns slowly, the top edge is within about 53° of level and the rated accuracy is 30° or better.
  - A brief disagreement counts as a magnetic disturbance and is ignored; if it persists for 2 s, heading is re-aligned.

  The quaternion, rate, gravity, `up` and tilt outputs are unchanged. The `up` sign hysteresis now runs once per sample rather than when `up` is read.

- `GyroPointer.anchoring` adds an `AimLedger` (tuning in `ANCHOR`). It tallies turns the cursor did not show: presses, swing locks, rebounds, dead-zone slip and gyro drift. It pays them back only by stretching or shrinking the player's own steps, by up to 25%. A still or locked cursor never moves by itself. Turns at the edges and Recenter re-anchor as before, and a mismatch over 45° is left to Recenter. Without a compass, sideways slip outside held aim is not counted, because it can't be told from gyro drift. Elevation is always anchored by gravity.
- Anchoring is the default for every motion pointer: the lobby, Neon Harvest and Whack-a-Mole. It was first tried in Whack-a-Mole and the lobby only. A game can opt out with `motion: { anchor: false }` on its input requirement, which resolves to `motion.pointer.anchor: false`; no game does. With it off, replaying the recorded iPhone traces gives byte-identical cursor output.
- The Motion Lab has a compass recording set. Its `center…` segments all point at the middle of the TV, and a hold button replays like Whack-a-Mole's. `npm run replay` reports the compass's rate, accuracy, noise and best-fit lag, and the drift at each return to center with anchoring off and on.
- Still to check on a device: whether iOS delivers compass readings under the single motion grant, the real compass lag (default 250 ms), typical accuracy indoors, and Android.

## Compatibility and acceptance

Protocol 4, the 47-byte frame, layout schema 2, resolved configuration schema 1, one binary motion vector, host authority and normal pointer/calibration algorithms are preserved. The added `GyroPointer.resumeAt` retires integration history at recovery without changing normal input processing. No dependency, deployment, data migration or extra sensor is introduced.

Deterministic provider tests cover permission failure/retry/coalescing, no samples, partial/invalid sensors, freshness/stall thresholds, automatic return, stale callbacks and immutable observation. Runtime tests exercise real host fallback/recovery generations, obsolete ACK rejection, reconnect capability refresh, stale tilt/shake, configuration during suspension, pageshow and a moved cursor returning without a jump. Existing replay, pointer, input, lifecycle and production-boundary checks remain required.

See the [validation ledger](../VALIDATION.md) for actual automated and desktop observations. Mock events are not evidence of physical sensor compatibility or device latency. Real-phone/TV/network acceptance remains separate.

## Delivery and recovery

Topic checkpoints are pushed to origin and the PR targets `codex/architecture-integration-0928`. Existing worktrees remain intact; there is no merge into integration/main or deployment. Revert this slice's implementation commit to recover previous ownership and lifecycle behavior; no data conversion is needed.
