# Double Dash handoff

The goal remains an almost 1:1 browser version of the original US Mario Kart:
Double Dash, played as an ordinary Controlla minigame with phone motion controls.
The local CISO runs through wasm-dolphin. Shared room integration works, but
real-time performance and full gameplay fidelity are not ready for release.

## Checkpoint and repository

- Checkout: `/Users/nosh/repo/controlla`.
- Branch: `codex/double-dash`, tracking `origin/codex/double-dash`.
- Implementation checkpoint before this handoff: `6831248`, pushed to origin.
  Initial handoff checkpoint: `4d31aed`, pushed to origin. The latest document
  checkpoint also records the subsequent stationary B-button trial.
- Local and recorded remote develop point to `5817ca8`, the additive revert
  removing the experiment from develop. Continue on the feature branch.
- Origin: `https://github.com/noshpotosh/controlla.git`.
- Preserve `/private/tmp/controlla-double-dash-room-check`, branch
  `codex/double-dash-room-check`, commit `5815712`. No cleanup was performed.
- Working tree was clean before creating this document. No collaborator edits
  were included. Follow AGENTS.md: selective commits, explicit topic pushes,
  no force-push/reset, and no integration merge without authorization.

## Run the ordinary game flow

From the checkout:

```sh
npm run dev:mario-kart:candidate
```

Open `http://localhost:3000`, create a room, join phones using normal room codes,
select **Mario Kart: Double Dash!!** beside Neon Harvest and Whack-a-Mole, and
start the round. It renders inside the shared game stage. End game removes the
iframe/runtime and returns to the picker. The separate port 8082 page is a
local diagnostic tool, not the player-facing launcher.

For trusted HTTPS phone development:

```sh
npm run dev:mario-kart:phone
```

The physical-device motion path is not yet qualified. Plain LAN HTTP cannot
provide the required motion-permission flow. Reuse the existing development
workflow; do not bypass browser certificate warnings.

The user's local disc is
`/Users/nosh/repo/controlla/Mario Kart - Double Dash!! (USA).ciso` (GM4E01).
ROM data, runtime checkouts, native binaries and captures under `work/` are
ignored local assets. Do not commit or upload them. A fresh clone alone does
not contain the playable runtime; preserve this machine's qualified builds.

## Verified scope

- Shared catalog, room session, stage renderer and disposal use the normal
  Controlla flow. Prior browser evidence includes room join, Start, native boot,
  race rendering, sound-unmute gesture and End returning to the picker.
- Controller mapping supports four stable ports, held buttons, neutral releases,
  stale-input expiration and motion steering with touch fallback. Unit/binary
  protocol checks are not proof of physical-device play.
- Pausing reaches the native core. A fresh-counter comparison stayed frozen
  for about 16 seconds and subsequently resumed. Earlier UI-only pause evidence
  was invalid; worker start/pause handlers were repaired in `28ff612`.
- WebGPU and software reached identical native ticks `105960713435` after twelve
  paused steps from the original checkpoint. Both show the same settled race
  scene and HUD time 00:21:593. This is one scene, not pixel-perfect/full-game
  qualification. First post-load frames can be black/corrupt in both backends.
- The native-counter rider-swap trial held input for frames 881–910, released
  at 910, then neutral polling was confirmed at 922. The swap visibly completed.
- Left/right steering trials each completed and released after ninety native
  frames. The kart visibly turned and reached paved track.
- B-button intervals showed 25 mph before the trial, then 28/23/9 mph at
  ten/thirty/ninety steps. Slowing is observed; initial speed rise, stopping,
  reverse transition and hardware-equivalent braking remain unresolved.
  Native source inspection found no A/B substitution. The original booklet
  identifies B as brake/reverse; phone wording now explains both functions.
- A restored reference plus twelve neutral steps confirmed 0 mph. Holding B
  for ninety native frames then changed the kart position and reached 3 mph.
  Duration and release assertions passed. Unsigned speed and still images do
  not independently establish reverse direction or original braking accuracy.

## Remaining work in priority order

1. **Reach adequate real-time performance without changing original behavior.**
   Recent matched diagnostic intervals measured approximately 24.4 FPS/40.7%
   native speed for direct block dispatch versus 18.7 FPS/31.2% for its control.
   This single pair is promising, not a proven causal improvement or a playable
   release. Repeat matched runs from the same checkpoint with profiling/cache
   settings and host load recorded. Investigate CPU interpreter/JIT fallback
   costs and WebGPU drain time. Earlier compile/instantiate cost was about 0.43%
   of one measured wall interval, while GPU drain measured about 23.4%; these
   are not exclusive CPU attribution. Preserve exact arithmetic and compare
   correctness against the native reference before promoting optimizations.
   The upstream `src/wgpu-visual-cadence.js` defaults its per-present downsample
   and readback on for WebGPU, independent of `metrics=1`; `wgpuvisual=0` is an
   explicit attribution control. Existing 24.4/18.7 FPS evidence included this
   sampler. Measure a matched on/off pair before attributing its cost. Tab 62
   is retained with `wgpuvisual=0` and the original checkpointsource, but its
   Play request remains at “Getting the race ready…” with demo-mode logs and
   no renderer report or console errors. Server PID 66791 was confirmed live.
   Reinspect that existing boot; no native measurement or speedup is established.
2. **Complete representative original gameplay.** Verify an entire race and
   results screen, lap transitions, course loading, collisions, item pickup/use,
   drift/mini-turbo, rider swaps, pause/resume, menu navigation, rematches and
   save/progress behavior. Exercise additional courses and Grand Prix, Time
   Trials, Versus and Battle rather than inferring all modes from Luigi Circuit.
3. **Resolve braking/application timing with controlled comparisons.** Establish
   stopped and reverse states explicitly. Compare identical input sequences
   from the same checkpoint against a control renderer/core; distinguish native
   pad polling, game SI consumption and presented image timing. Do not infer
   signed velocity from the unsigned mph HUD or change physics to fit a capture.
4. **Qualify physical motion and multiplayer.** Test trusted HTTPS on actual
   phones, permission/recenter, portrait/landscape rotation, proportional turn,
   drift with gas, disconnect/reconnect and stale release. Test 1–4 phone ports
   and original split-screen/co-op behavior, including room End and new rounds.
5. **Qualify audio and stability.** Verify music/effects, synchronization, latency,
   pause/resume and sustained races. Unmuting alone does not establish quality.
   Check memory, worker cleanup, repeated sessions and supported browser/GPU
   configurations. Keep emulator controls out of the ordinary room experience.
6. **Promote only a broadly validated runtime.** The ordinary candidate command
   still selects an earlier qualified build. Native experiments are not default
   releases. Re-run shared-room/browser checks with the chosen final core, then
   appropriate repository checks and review. No merge/deploy has been requested.

## Native builds and diagnostic state

Existing local manifests report controller ABI and reference differential checks:

| Output directory under work | WASM hash prefix | Use |
| --- | --- | --- |
| double-dash-paired-differential-core | 8de36c9c9a73 | Ordinary candidate launcher; 3,744 differential cases |
| double-dash-frame-step-core | ff4928b665df | Current diagnostic core; native stepping, paused FIFO and direct dispatch |
| double-dash-direct-block-core | e4da9e2fdcda | Direct block dispatch performance experiment |
| double-dash-paused-fifo-core | 86164c0591a7 | Matched direct-dispatch control |

The last three also retain 12,288 scalar status and 1,536 paired status cases.
All four WASM files matched their manifest hashes at handoff. Manifest evidence
is tied to those hashes; validate integrity again when resuming. Full hashes
and detailed experiment history are in `DOUBLE-DASH.md`.
Do not overwrite these outputs. Use unique output directories for builds and
keep source patches/provenance with each experiment. Current native source has
patches 0034/0035/0036 and guarded multiply 0032; generated madd 0033 is absent.
Broad scalar dispatch is disabled. Rebuilding a different combination requires
checking actual source/configuration, not relying on a directory name.

Current owned diagnostic server is session `99074`, PID `66791`, port 8082
(confirmed listening at handoff). Its startup command is:

```sh
DOUBLE_DASH_RUNTIME=candidate \
DOUBLE_DASH_CORE_OUTPUT_DIR=work/double-dash-frame-step-core \
DOUBLE_DASH_PORT=8082 node scripts/mario-kart/serve.mjs
```

Only stop/restart owned processes after checking current identity. Other local
servers may already occupy ports; preserve the user's normal dev process.

Browser tab 61 is retained for handoff, paused/fullscreen at native frame 1564,
ticks `106690442308`, after the stationary B-button trial. Recheck its existence/state;
a missing tab is not a lost source checkpoint. Its query enables
`rendererdiagnostics=1&pauseprobe=1&framestep=1&probeinputs=1&nativeprobe=1`
with WebGPU, dual CPU and wasmjit1/jitwarmup700. Native probes require pause;
resuming cancels held input. Wait for completed step status and a fresh report:
click return can precede completion, and reports refresh every two seconds.

Original comparison checkpoint is IndexedDB on `http://127.0.0.1:8082`, key
`GM4E01:4630560cfc830e2e2133fe6468dfef5645dac49edc8d25a15e3b4bd767699538`,
saved October 5 at 18:58:43 local. Restore using that checkpointsource hash;
original ticks are `105857240455`. Do not overwrite the original reference.
Fullscreen exposes the complete HUD; the opt-in Exit fullscreen button returns
to probe controls. Screenshots taken with fullPage previously clipped the HUD.

## Validation and evidence

Handoff rerun passed 35 focused tests and server syntax:

```sh
node --import tsx --test tests/double-dash-integration.test.ts \
  tests/double-dash-renderer.test.ts tests/live-catalog.test.ts
node --test scripts/mario-kart/renderer-diagnostics.test.mjs \
  scripts/mario-kart/profile-worker.test.mjs \
  scripts/mario-kart/controller-input.test.mjs \
  scripts/mario-kart/motion-steering.test.mjs
node --check scripts/mario-kart/serve.mjs
```

This is not a full repository build/typecheck/lint or end-to-end fidelity audit.
Recent local evidence pairs are under `work/`:

- `double-dash-{wgpu,software}-step-twelve.{json,png}`: settled renderer comparison.
- `double-dash-native-swap-{thirty,neutral}.{json,png}`: exact held/release and swap.
- `double-dash-native-{steer-left,steer-right,brake-ninety}.{json,png}`: control trials.
- `double-dash-brake-interval-{before,ten,thirty,ninety}.{json,png}`: interval speeds.
- `double-dash-reverse-{stopped,after}.{json,png}`: stationary B-button trial;
  filenames do not establish signed reverse velocity.
- Direct-block/matched-control race JSON, screenshots and host-load snapshots:
  see the corresponding sections in `DOUBLE-DASH.md`.

Use `DOUBLE-DASH.md` as the detailed chronological evidence log, not as a claim
that the full goal has passed. Completion requires representative original
content/behavior, playable timing/audio, physical motion, multiplayer and the
ordinary Controlla flow verified together. The goal remains active.
