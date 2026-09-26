# Validation and acceptance ledger

The code provides a runnable prototype of the complete venue topology and two minigames. **None of the physical latency, cross-country fairness, or device compatibility acceptance criteria have been certified.** Automated tests cover protocol and lifecycle behavior; they are not substitutes for playtests.

## Automated checks

- Binary frames under 60 bytes; off-screen coordinates; invalid frame rejection; u16 sequence and u32 timestamp rollover; reorder/loss accounting.
- Minimum-RTT clock selection; slow correction; D ramp and single-venue zero target; bounded extrapolation.
- Off-axis corner fit; degenerate/crossed corners; exact center recenter while preserving H.
- Permission-aware per-player fallback and required-input failure.
- Acknowledged-base deltas; missing-base rejection and resync; interpolation that preserves discrete scores; out-of-order snapshots.
- Configuration ACK gating, stale-generation rejection, duplicate press suppression and recovery of a lost continuous press frame.
- Timestamp-based reaction scoring and bounded cloneable results.
- Signed resume identities, grace periods, eight reserved seats, venue disconnect/rejoin, host termination, routing isolation and enumeration limits.
- Live WebSocket room/venue/controller connection, relay, unauthorized route rejection, venue resume and host-ended notification.
- Two-venue runtime integration using mocked browser APIs and actual WebSocket fallback: local cursor routing, timestamped scoring, phone reload with a fresh epoch, and host termination. This does not exercise real WebRTC or sensors.

Run `npm test`, `npm run typecheck`, `npm run lint`, and `npm run build`. `npm run benchmark` measures an eight-player payload in Node only. Initial local results: clone mean 0.010 ms; MessageChannel p50 0.011 ms, p95 0.018 ms, p99 0.023 ms. Rerun on the deployment/device target; these are not browser results.

## Spec acceptance mapping

| Criteria     | Implementation                                                                           | Remaining evidence                                                  |
| ------------ | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| 1–7          | Create/join, code, roster, signed identity, host start, per-player configuration and ACK | Cold-start browser test with 4–8 real phones                        |
| 8, 10–11, 17 | Pointer/button Latency Lab; tilt/swipe Tilt Rally; capability fallback and teardown      | iOS/Android sensor and permission matrix                            |
| 9, 22        | Separate local route diagnostics, authority age percentiles and camera-result field      | 240 fps monitor/TV recordings; p95 and jitter budgets               |
| 12–13        | Five samples, conditioned homography, persisted H, exact recenter                        | Center/side/~60° seats; yaw drift over a full session               |
| 14–16        | Fullscreen gesture, timed lifecycle, results and completed-round history                 | Fullscreen browser and audio unlock checks                          |
| 18, 26       | Phone/venue grace, reconnect identity, roster propagation, freeze policy, host end       | Suspend/resume on actual mobile browsers; router disconnect         |
| 19–21, 23    | Two-tier peers and snapshot rendering across mixed venues                                | Two-city and cross-country rooms; direct and TURN routes            |
| 24           | Common presentation timeline and timestamp-judged fairness rounds                        | Repeat randomized prompts, compare per-venue reaction distributions |
| 25           | Canonical 16:9 viewport and calibration markers                                          | 16:9 TV + 4:3 tablet aiming comparison                              |

## Manual sequence

1. Start one host screen and 4–8 phones on trusted HTTPS. Grant motion from the explicit button. Deny it on one phone and confirm stick fallback.
2. Calibrate center, TL, TR, BR, BL against the **game area**. Record the seat angle. Recenter; verify no corners are requested again.
3. Run all four Latency Lab modes. Tracking exports RMS error and estimated pursuit phase lag; this includes human tracking behavior. Reaction/Fairness exports mean reaction times and counts. Strobe is designed for a camera.
4. Film hand and screen together at 240 fps. Measure many trials, not one. Compute p50/p95/p99 and (p99−p50), record display model, browser/OS, power mode, TV Game Mode, and network route. Enter measured motion-to-photon in diagnostics and save the JSON report.
5. Launch Tilt Rally without reloading phones. Pointer output must stop; gyro-independent tilt + swipe (or stick fallback) must take over.
6. Background and reload a phone, then disconnect it for less than 60 seconds. Verify name/seat/color, configuration, and saved homography. Recenter after a reload if the phone moved while sensor integration was suspended.
7. Add a second venue, first locally, then remotely. Join uneven phone counts. Check each venue's own cursors remain local while shared objects use snapshots. Compare 16:9 and 4:3 screens.
8. Degrade the second venue's network. Watch D ramp, starvation, clock error, and the limiting venue. A changing common delay can introduce temporary unfairness; measure it rather than hiding it.
9. Close the remote screen, then restore within grace. Other venues must finish normally. Close the host: all clients must report termination and preserve previously completed results for download.

## Known prototype limits / unfinished acceptance work

- No real mobile browser, camera, TV, ICE/TURN, cross-country, or browser-iframe benchmark was run during implementation. WebMCP read-only room access is optional and has not been exercised in a supporting browser.
- No TURN deployment or public signaling endpoint is included. The default STUN path cannot guarantee connectivity on restrictive networks.
- Generic widget values use bounded reliable control messages; the primary pointer/tilt frame is binary and lossy. High-rate drawing needs its own binary point-batch frame before promising the same loss/jitter budget as pointing.
- The fixed frame currently has four action slots. Current games use one. A future controller with more discrete actions must negotiate a different frame layout.
- Drift confidence is a freshness hint, not an experimentally calibrated yaw uncertainty estimate. Physical drift/recenter frequency must still be measured.
- Both shipped games select freeze. The game contract also provides pause-with-grace termination and a basic substitute controller. These policies need genre-specific playtesting. Crash isolation and third-party asset loading are deferred.
- The 200 ms judgment window is conservative and may feel slow; tune from observed distributions. The <120 ms authority resolution budget is not proven and can conflict with that window. Fairness mode is a test instrument, not proof of fairness.
- No screenshots or interactive browser QA were performed. Type checking, integration tests and a production build do not certify the phone UX.

These limits must remain visible until measured or completed; do not label all 26 acceptance criteria passed based on a successful local build.
