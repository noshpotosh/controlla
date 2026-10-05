# Double Dash in the browser

The fidelity target is the actual US GameCube game running from the user's local
disc image. Emulation preserves the original courses, characters, two-person
karts, items, menus, physics, music, and modes without approximating them in the
existing Tilt Rally simulation.

## Local prototype

Run from the Controlla checkout:

```sh
npm run dev:mario-kart
```

This command starts the ordinary Controlla frontend and room signaling service.
Open `http://localhost:3000`, start a room, connect phones using the usual room
link or codes, select **Mario Kart: Double Dash!!** alongside Neon Harvest and
Whack-a-Mole, and click **Start round**. **End game** releases the runtime and
allows another game to be selected. Free play has a one-hour session limit.

The rebuilt four-controller runtime starts lazily inside the room's stage.
Its candidate and build manifest must already exist in `work/double-dash-build`;
this checkout has them. The separate home-page launcher has been removed.
`npm run mario-kart` remains a standalone diagnostic launcher.

For physical phone motion, use `npm run dev:mario-kart:phone`. It wraps the
existing trusted HTTPS phone-development workflow. Open the printed localhost
address on the host computer and the printed HTTPS address on phones, then
join the same room. Enable motion and recenter through the normal controller
menu. The tunnel exposes the ordinary room app; the local game proxy rejects
tunnel requests. The basic `dev:mario-kart` command is useful for local desktop
testing but plain LAN HTTP cannot grant phone motion permission.

The launcher uses the root-level `Mario Kart - Double Dash!! (USA).ciso` by
default. For another location:

```sh
DOUBLE_DASH_DISC='/absolute/path/game.ciso' npm run mario-kart
```

It downloads the pinned open-source wasm-dolphin runtime into ignored
`work/wasm-dolphin` on first run. Git and network access are needed for that
initial setup. The runtime includes a compiled core; no Emscripten installation
is needed. The disc image remains local and is excluded from Git.

The embedded game uses the room's existing phone inputs, motion permission and
recentering, with touch steering when motion is unavailable. Four stable room
seats map to four GameCube ports. The phone's menu arrows navigate game menus;
on Start / Swap, up means Start/Pause and down means swap riders. Held buttons
expire after 250 ms of missing phone frames; the embedded bridge additionally
neutralizes every port if its parent stops sending room snapshots for 500 ms.

Game bytes are proxied only for requests from a loopback socket and a localhost
host name. LAN and tunnel phone origins cannot fetch the CISO or native runtime.
Phones continue using normal Controlla room transport. This is a local host
prototype; remote screens do not receive synchronized game video, and production
hosting does not serve the local runtime. Rendering remains slow in the verified
software/Canvas 2D path; hardware rendering and physical phone racing remain
unverified. Race results remain in the original game and do not award session
points. The standalone diagnostic screen retains the progress tools below.

The standalone diagnostic presents a Controlla host screen with a plain game stage,
lime play button, phone-pairing menu, sound, pause, fullscreen, and progress
controls. Emulator settings, performance overlays, disc pickers, and the console
bezel are hidden from the player interface. The underlying engine is still
experimental; this presentation change does not resolve rendering or speed.

Room integration was checked in the browser: ordinary room-code phone join,
Double Dash selection, Start round, native Nintendo/Dolby boot rendering inside
the existing stage, phone controller replacement, and End game unlocking the
picker and removing the iframe. Screenshot: `work/double-dash-room-picker.png`.
Typecheck, production build/bundle audit, targeted lint and all 18 runtime tests
pass. The full repository suite has 379 passes and one pre-existing failure:
the controller-boundary audit rejects the computed native core import in
`scripts/mario-kart/check-native-abi.mjs`; that loader and audit are unchanged.

After starting the game, **Save progress** stores a full emulator snapshot in
this browser's IndexedDB. On a later visit, start the same image and choose
**Resume progress**. Each core build has its own slot; upgrading the emulator
does not overwrite or attempt to load an incompatible slot. Saving again
replaces the current build's slot. Browser data clearing removes it. Keep a
**Download state** backup for progress you want to retain elsewhere.
This is explicit snapshot persistence; automatic memory-card persistence and
an actual browser save/reload round trip still need verification.
`npm run mario-kart:check-state` checks native serialization/restoration against
the rebuilt WASM and supplied disc without running a browser. It passed locally,
including confirmation from the native after-load callback.

The browser-storage component was checked separately in the Codex in-app
browser using the actual progress controls and a synthetic 10,245,299-byte
snapshot. After closing and reopening the page, Resume progress retrieved the
snapshot and verified every byte. This proves IndexedDB persistence in that
browser, not the combined emulator/WebGPU restore or desktop Chrome behavior.
Local evidence: `work/double-dash-storage-proof.png` (ignored).

The approved emulator browser test reached the original Nintendo screen and
animated intro using explicit `video=software`, `cpu=single`, `fastsw=0`, and
`presenter=2d`. Save progress and Resume progress completed with an actual
emulator snapshot; the rebuilt worker confirms its native after-load generation
before reporting success. Evidence: `work/double-dash-browser-resume.png`.
This was an in-session restore, not a browser-restart emulator restore.

An earlier default WebGPU test rendered black despite advancing core frames.
Direct-worker OpenGL also failed to present game frames in the Codex in-app
browser. Software with Canvas 2D rendered the intro, but measured only about
6–16% game speed, with JIT engaging and subsequently disabling itself on a
performance guard. Full racing remains unverified. These are unresolved
rendering/performance failures; the build is experimental, not ready for normal
racing. Browser testing also found and fixed settings silently replacing an
explicit Software selection with the automatic WebGPU game profile.

A later browser comparison with `cpu=single`, `wasmjit=1`, and
`jitwarmup=700` rendered the original intro and title with WebGPU. The title
briefly measured 103% game speed, but a subsequent attract-mode scene remained
dark. At frame 2941 the worker reported 23,227 draws, 114 successful shaders,
122 successful pipelines, no missing resources or skipped draws, and no GPU
errors. Successful command submission therefore does not establish rendering
fidelity. The dark scene was initially mistaken for a main menu; restoring its
saved progress with Software revealed the original attract-mode race.

The same-origin page restart and cross-renderer restore confirmed native
after-load generation 1 and displayed that race. Start then returned to the
title and reached the memory-card creation prompt. Software measured roughly
1–13% speed during this comparison. This verifies scene restoration and those
input transitions, not interactive driving or playable performance. Confirm
created the game data, and another Confirm dismissed its notice to display
the original START GAME / RECORDS / OPTIONS menu. Later menu samples reached
16% speed. `work/double-dash-browser-main-menu.png` records that browser result.
Evidence is retained locally in `work/double-dash-hardware-menu-report.json`,
`work/double-dash-software-restored-report.json`, and
`work/double-dash-software-restored-scene.png` (all ignored).

The software main-menu checkpoint also restored successfully into the actual
native hardware renderer (`video=wgpu`, reported as `WebGPU-Real`). It displayed
the original main menu at 103% speed, then accepted Confirm to show HOW MANY
PLAYERS and SELECT MODE / Grand Prix / 50cc. The report at frame 1552 confirmed
native after-load generation 1, 15,210 indexed draws, 1,559 presentations,
46 successful shaders, 53 successful pipelines and no GPU errors. Player
selection later measured 55% speed. This is stronger evidence for those menus;
it does not establish that the dark attract-mode scene or interactive racing
is fixed. Local evidence: `work/double-dash-gpu-restored-menu.png` and
`work/double-dash-gpu-restored-menu-report.json`.

Use `video=wgpu` for native GPU comparisons. `video=webgpu` can select the
Software-to-WebGPU presentation bridge and reports `WebGPU`; zero native replay
draws or presentations cannot establish hardware rendering. For a reproducible
comparison, use `rendererdiagnostics=1&wgpuclassify=1`, restore a checkpoint,
and check both native after-load generation and actual command replay counters.

The next browser check reached SELECT CHARACTER COMBINATION and confirmed Mario
and Luigi. Native GPU rendering displayed the icons, names, stats and OK prompt,
but left the 3D preview empty. A same-origin snapshot saved at 11:28:40 AM on
2026-10-05 restored in Software and displayed both characters and their kart.
This establishes a renderer difference in a matched game state. The GPU report
at frame 12424 recorded 716,490 indexed draws, 76 successful shaders and 81
successful pipelines, with no GPU errors, missing resources or skipped draws.

Disabling partial clears with `wgpuclearrect=0` did not restore the preview.
The report confirmed renderer feature mask `0x0`, native after-load generation
1 and active `WebGPU-Real`; this rules out the partial-clear path as the sole
cause. It does not justify shipping legacy whole-frame clears. Local comparison
screenshots are `work/double-dash-gpu-kart-preview.png`,
`work/double-dash-software-kart-preview.png`, and
`work/double-dash-gpu-kart-clear-off.png`; each has a matching `-report.json`.

A temporary isolated-server probe set the consumer's `DIAG_DEPTH_ALWAYS` to
true, leaving the normal game runtime unchanged. Restoring the same snapshot
then displayed Mario, Luigi and the kart. Its report confirmed the diagnostic
flag, native after-load generation 1, real command replay and no GPU errors.
This isolates depth handling as a cause of the missing preview; forcing depth
tests to always pass is not a fidelity fix and is not shipped. Evidence:
`work/double-dash-gpu-kart-depth-always.png` and its matching `-report.json`.

A second isolated-server probe kept ordinary depth testing and changed only
`GX_NATIVE_DEPTH` to true (far clear 1, unflipped comparisons, producer clear
depth for partial clears). The matched preview displayed both characters and
the kart again, with no reported GPU errors. Its report explicitly records
`diagnosticNativeDepth: true`. This is a candidate depth-convention correction,
not yet a shipped fix: model occlusion, other menus, cold boot and actual racing
must be compared before changing the normal runtime. Evidence:
`work/double-dash-gpu-kart-native-depth.png` and its matching `-report.json`.
The ignored probe servers are `work/double-dash-depth-probe-serve.mjs` and
`work/double-dash-native-depth-probe-serve.mjs`; they rewrite served worker text
on the isolated diagnostic port and do not modify the runtime source or core.

The alternate-depth probe progressed through Mushroom Cup selection and loaded
the original Luigi Circuit race. It displayed the race HUD, timer, standings,
lap counter and minimap, but the world and kart stayed dark at 0 mph. Thus the
preview improvement does not establish a valid whole-game depth correction;
the candidate was not promoted into the normal runtime. A race-state snapshot
was saved at 11:43:31 AM on 2026-10-05 for subsequent matched comparisons.
Evidence: `work/double-dash-gpu-native-depth-race.png` and its matching
`-report.json`. The isolated server was restored to the normal source after
the probe. Input probes now include bounded acceleration and analog steering
for checking driving at measured game frames rather than wall-clock key taps.

The original GPU depth convention also restored that race state with a dark
world and missing kart, while the HUD continued to advance. The 300-frame
acceleration probe moved the player marker and produced an observed 22 mph
speedometer reading after starting at 0 mph. Native input generations advanced
on press and release. This proves acceleration affects the emulated race, not
correct visuals, responsive steering or physical-phone motion. Original-depth
race evidence is `work/double-dash-gpu-original-depth-race.png` and its matching
`-report.json`; post-input captures are retained under
`work/double-dash-browser-acceleration*` and `work/double-dash-browser-steering*`.
All 22 local runtime tests pass, including frame-bounded analog driving probes.

The race-state depth-bypass probe displayed the missing kart but left the scene
very dark (`work/double-dash-gpu-race-depth-always.png`). Software restored the
same snapshot and displayed the bright course, kart and scenery correctly
(`work/double-dash-software-race-reference.png`). Both have matching
`-report.json` files. Depth rejection therefore does not explain the full race
rendering failure.

Patch `0007-restore-console-depth-conversion.patch` restores console-depth
conversion for fog and per-pixel depth in both pixel shader generators. An
isolated native build completed in `work/double-dash-depth-core`, with 179 WASM
exports and four-controller ABI checks passing. Its SHA-256 is
`e5fee0966f3dfee66cf1b60c754aa328974217cc18d1ff49e3a55241c764207a`.
The normal core remains `829e4655…dec9` and its manifest validates unchanged.

The isolated candidate server restored the legacy race snapshot for a controlled
comparison (the normal per-core progress policy remains unchanged). The browser
confirmed the candidate hash and native after-load generation 1. With ordinary
GPU depth testing, the kart became visible, but course shading remained dark.
The report recorded 114 successful shaders and pipelines, no missing resources
or skipped draws, and no GPU errors. Evidence:
`work/double-dash-gpu-console-depth-race.png` and its matching `-report.json`.
This is an experimental rendering improvement, not verified whole-game fidelity.
The ignored `work/double-dash-depth-core-serve.mjs` retains the comparison setup.

Keyboard controls follow the emulator's bindings:

| Input | Key |
| --- | --- |
| Start / pause | Enter |
| Steering | W / A / S / D |
| Accelerate (A) | X |
| Brake (B) | Z |
| Items (X / Y) | V / B |
| L / R | Q / E |
| Switch riders (Z) | C |
| Menu directional pad | Arrow keys |

The runtime also supports browser gamepad input. COOP/COEP isolation headers
are supplied by the local server. WebGPU and SharedArrayBuffer support are
required. Memory use is substantial (the core may require about 1.5 GiB plus
the disc image and browser overhead).

## Evidence and remaining validation

The supplied CISO header identifies `GM4E01`, title `Mario Kart Double Dash!`,
with a 2 MiB block size and 236 present blocks. The pinned runtime includes a
`GM4E01` hardware-renderer profile, based on upstream mode-selection checks.
That evidence does not prove racing, every course, sound, or multiplayer work
on this Mac.

Verified locally: launcher syntax, served application-module syntax, loopback
server startup, isolation headers, local-disc route, and rejection of unrelated
repository files. Browser gameplay has not yet been verified. The launcher now validates the CISO
block map, GameCube identity, and filesystem before serving it; sparse-block,
truncation, wrong-game, and malformed-name tests pass. `/disc-info` exposes the
local filesystem index for diagnostics.

The original prebuilt upstream native bridge explicitly rejects controller ports other
than port 1 (`DolphinWeb_GetPadStatus` in `core/upstream/dolphin_web_discio.cpp`).
The isolated rebuilt candidate adds all four ports and phone-input transport;
actual local multiplayer still needs gameplay validation.

Before calling the full browser goal complete, verify boot and memory-card
handling, character/kart selection, an entire race with sound and responsive
controls, every course and item, Grand Prix progression, time trials, battle
modes, and local multiplayer. Measure game speed and unique rendered frames
through gameplay, rather than inferring performance from menus. Connect
Controlla phone input to emulator controller ports and verify disconnect/release
behavior. Multi-screen Controlla sessions require a separate emulator replication
or video transport design; the existing JSON snapshot protocol cannot replicate
the GameCube simulation directly.

## Runtime provenance

Upstream: https://github.com/dougchansan/wasm-dolphin

Pinned commit: `7e38409ace3dda709c178312ff63fd92a3653cc7`.
The launcher adds an in-memory local-disc button, Controlla title, and phone-input
integration. Rebuilt mode also includes the documented native and worker patches.
The upstream GPL license, source, patches,
and provenance remain in the downloaded checkout. No core binaries or game data
are bundled into Controlla's production build. Consult upstream's corresponding
source workflow before distributing an emulator build.

## Motion controls

Phone tilt is the requested steering input. The steering mapper in
`scripts/mario-kart/motion-steering.mjs` accepts Controlla's signed,
screen-aligned `Motion.tilt.x` and produces the GameCube main-stick X byte.
It supports recentering at the held angle, sensitivity, a neutral deadzone,
and sample-rate-independent smoothing. Missing, disconnected, or over-250-ms-old
motion samples immediately return steering to center. Acceleration, braking,
drift, items, rider switching, and Start remain explicit touch buttons.
After enabling motion, **Use touch steering** switches back to the slider;
touching the slider also selects it. Rotating the screen releases old input
and requires enabling motion and recentering for the new grip. Unfocused or
hidden pages release their controls and stop sending connected packets.

The controller page and relay now connect the mapper to emulator port 1 (zero-based
port 0). Click **Player 1 motion** on the emulator screen. The resulting link
contains a per-run pairing token. One phone owns the controller at a time; packets
are sequenced and validated, and a 250-ms timeout releases held controls. Keyboard
and gamepad input resume when phone ownership ends.

For an actual phone, use a trusted HTTPS reverse proxy to this loopback service.
Share the controller link using that HTTPS origin. Proxy only `/controller`,
`/phone.js`, `/motion-steering.mjs`, and `/phone-input` to the phone-facing origin;
keep the emulator, disc, and host event-stream routes local. The host emulator
page stays open on this Mac. This setup uses touch steering when motion is
unavailable. It does not yet reuse Controlla's existing room signaling or WebRTC
transport. HTTP POST input is a functional prototype; latency requires measurement.

Alternatively, the launcher can provide the phone HTTPS endpoint directly with
a certificate and key already trusted by the phone:

```sh
DOUBLE_DASH_RUNTIME=rebuilt \
DOUBLE_DASH_PHONE_ORIGIN=https://your-mac.local:8443 \
DOUBLE_DASH_PHONE_CERT=/absolute/path/trusted-cert.pem \
DOUBLE_DASH_PHONE_KEY=/absolute/path/trusted-key.pem \
npm run mario-kart
```

This listener binds to `0.0.0.0` by default; `DOUBLE_DASH_PHONE_BIND` selects a
specific interface. It permits only the controller page, its two modules, and
input POST route. The game image, emulator assets, and host event stream stay
on the loopback listener. The printed player links and launcher links use the
phone origin. For a reverse proxy, set only `DOUBLE_DASH_PHONE_ORIGIN`; omit
the certificate/key variables. A self-signed certificate that the phone does
not trust will not provide usable motion access.

The Double Dash suite passes eighteen tests including stale-input release,
controller ownership, and actual phone-script lifecycle behavior against browser
event doubles. Served emulator-module syntax and the controller route
were checked. End-to-end steering, motion permissions, landscape-axis direction,
and gameplay still require real browser/device validation.

## Isolated multiplayer build

`work/double-dash-build` is a separate checkout at the pinned runtime revision.
The pinned Dolphin source was fetched and its 66 upstream browser patches were
applied with the expected result-tree verification. Project-local build tools
now include Emscripten 5.0.7, CMake 3.31.6, Ninja, and Rust nightly with rust-src.
The shared-memory Naga shader-conversion static library compiled successfully.

`npm run mario-kart:prepare` applies the four-controller source/worker/device
patches to that checkout and adds the required native export. `npm run
mario-kart:configure` generates the macOS build configuration while recording
actual tool hashes and versions. `npm run mario-kart:test` runs the local
controller, motion, relay, and disc tests. These commands do not replace the
currently served prebuilt core. A full core compile and browser validation
must pass before activating the rebuilt runtime.

The full four-controller WebAssembly compile succeeded from the prepared
source. After compilation, `npm run mario-kart:build` verifies module
syntax and the native export, then writes `controlla-core-build.json` with binary,
loader, toolchain, and patch hashes. Use `DOUBLE_DASH_RUNTIME=rebuilt npm run
mario-kart` to select that candidate explicitly. The launcher rejects missing or
mismatched build evidence and passes the candidate's actual hash to the browser
loader. In rebuilt mode, it creates separate player 1–4 motion links and pairing
tokens; each player gets independent ownership and stale-input release. This
mode remains experimental until actual split-screen gameplay is verified.

The built module exposes 179 WASM exports. A direct Node/Emscripten ABI check
accepted connection and disconnection on all four ports and rejected invalid
ports; no game was booted by that check. The rebuilt candidate is currently
served at local port 8082. Route checks verified its loader hash, three additional
player channels, player-2 POST-to-SSE input delivery, and served module syntax.
This evidence does not establish game boot, split-screen racing, audio, or phone
motion behavior. Browser gameplay remains unverified.

`node scripts/mario-kart/probe-boot.mjs` performs a bounded native diagnostic
using the rebuilt WASM core and local CISO. `DOUBLE_DASH_PROBE_MS` sets its
duration (1–900 seconds). `DOUBLE_DASH_PROBE_START_AT` optionally presses Start
at the given elapsed milliseconds and releases it one second later.
The 45-second run mounted `GM4E01`, entered `Running`,
and produced Nintendo and Dolby startup screens. It writes diagnostic JSON and
a raw RGBA framebuffer under ignored `work/`. This establishes startup progress
in Node with the software renderer; it does not establish browser racing,
hardware-renderer performance, sound, or motion control on a physical phone.

The 120-second diagnostic reached the rendered Double Dash title screen.
Its native controller-poll diagnostics recorded the injected Start button and
subsequent release (two updates). This does not yet prove menu navigation or
racing. HTTPS listener checks returned 200 for the controller page, 204 for
paired input, 403 for an invalid token, and 404 for disc and host-event routes.
Those checks used a temporary loopback test certificate; no phone trust or
physical sensor behavior was established.

The landscape controller preview at 844×390 exposed off-screen buttons; a compact
layout now displays every gameplay button in that viewport. The browser reported
`Controller linked` after receiving a relay response. Sensor and connection
messages use separate status areas. A later 150-second native run with Start at
130 seconds ended on a white frame while the core continued running; this is
unresolved evidence, not successful menu navigation.

A subsequent 180-second run captured every 15 seconds and resolved that white
frame: it is followed by the title screen at 165 seconds. The earlier Start
press at 130 seconds occurred during the intro sequence, before the title.
The next navigation check should press Start after the title appears. Captures
also show the original intro's rendered kart scenes; they are not interactive
race evidence. The probe now records timed RGBA captures and their dimensions
in its diagnostic JSON.

The 240-second probe pressed Start at 190 seconds and reached the original
memory-card creation prompt (Slot A, YES/NO). This verifies that game-side
controller input advances beyond the title. Creating save data, entering the
main menu, and racing are still unverified.

The subsequent 300-second scheduled-confirm run did not reach the title or save
prompt: captures from 180–300 seconds showed a stationary intro frame while
the core reported Running. This contradicts reliable boot progression and must
be investigated before treating the native candidate as stable. The probe now
accepts `DOUBLE_DASH_PROBE_INPUTS` as a JSON array of `{at, mask}` steps and
records each actual application time and native return value.

The native diagnostic previously called `SetAudioMuted` before runtime boot,
which the core rejects, and did not consume PCM. It now pulls/discards 960 frames
every 20 ms, matching the browser's continuous mixer consumption without playing
audio. A 15-second check recorded 673,920 mixed frames and active game audio input.
That establishes the corrected diagnostic path; it does not prove this resolves
the intermittent intro stall or verify audible output. Audio stats are now
included in every sample for subsequent comparison.

The 300-second comparison with continuous PCM consumption reached the memory-card
prompt, accepted YES at 240 seconds, displayed START GAME / RECORDS / OPTIONS at
255 seconds, and advanced to HOW MANY PLAYERS after Confirm at 270 seconds.
This establishes menu navigation and acceptance of the save-creation request in
that run. Save persistence across reloads and repeated boot reliability remain
unverified; one successful comparison does not establish the cause of the earlier
stall. Browser hardware rendering, interactive racing, and physical phone motion
remain separate validation requirements.

For observed-screen diagnostics, set `DOUBLE_DASH_PROBE_INTERACTIVE=1` and run
the probe in a terminal with stdin open. Enter one JSON command per line, for
example `{"port":0,"state":{"mask":1,"analogA":255},"holdMs":200}` to tap A.
The shared packet validator checks port and analog values. Each command releases
to neutral automatically after 1–5000 ms; `{"capture":true}` records a frame
immediately. `work/double-dash-live-frame.json` identifies the newest raw capture
and dimensions. Each run uses a separate capture directory. A running-WASM check
accepted/released port 4 input and rejected port 5; this is input-bridge evidence,
not multiplayer gameplay validation.

The interactive dual-thread run reached player selection, then stopped visibly
responding to A, Start, and Down despite accepted native press/release packets.
It was deliberately stopped after those observed checks. Continuous audio
consumption therefore does not establish a fix for all stalls. The diagnostic
now accepts `DOUBLE_DASH_PROBE_CPU_THREAD=0` or `1` for a controlled threading
comparison and records that setting in its result.

The single-thread comparison (`cpuThread=0`, still cached interpreter/software
renderer) progressed more slowly but explicitly displayed “Data has been created,”
returned to the main menu, and accepted one-player selection to reach SELECT MODE
(Grand Prix / Time Trials). This advances beyond the earlier dual-thread stall.
It remains one observed comparison, not proof of a general threading fix. The
browser's optional PowerPC WASM JIT was not enabled in these Node runs, so their
timing is not representative of the requested browser runtime.

The same single-thread live run accepted Grand Prix / 50cc, rendered character
previews, selected Mario and Luigi with the Red Fire kart, and confirmed Mushroom
Cup. At approximately 884 seconds it rendered the original Luigi Circuit race
intro (Grand Prix 1/4, three laps). This proves those selection stages and course
loading in the software-renderer diagnostic. The bounded run ends before proving
responsive driving, a complete race, or browser hardware-renderer fidelity.

### Generated race shader capture (2026-10-05)

An isolated localhost server (`work/double-dash-shader-snapshot-serve.mjs`)
adds a diagnostic-only snapshot of generated WGSL and pipeline descriptors to
the existing renderer report. It serves the candidate core without changing
shader execution. Restoring the same Luigi Circuit checkpoint on port 8081
produced generation 1, 96 captured shader sources, 86 pipeline descriptors,
and no reported renderer errors. The ignored evidence is
`work/double-dash-race-shader-snapshot.json`, the extracted
`work/double-dash-race-shaders/`, and the matching screenshot.

Shader 314 contains console depth conversion `(1 - fragmentPosition.z) *
16777216`, clamps to 24-bit depth, and computes exponential fog before mixing
the fog color into the TEV output. This verifies that the candidate conversion
reaches an actual generated course shader; it does not prove its bound values
or the resulting fog are correct. The course remains dark. The next diagnostic
is to associate actual pixel-constant uploads and draw calls with these
shader/pipeline IDs rather than relying on shader text or aggregate counters.
The diagnostic server and shader artifacts remain ignored and local.

### Bound race pixel constants (2026-10-05)

The local diagnostic now matches uniform uploads by buffer ID and destination
offset to group-0 buffer descriptors plus the dynamic offsets applied at bind
time. For each EFB pipeline it retains the last matched pixel constant slice.
The generation-1 race capture contains 64 matched pipelines, normal 1536-byte
pixel uploads, and no renderer errors. Evidence remains local in
`work/double-dash-race-bound-constants.json`.

The exponential-fog course shaders (including fragment 180 and 187 in this
run; IDs change on reboot) match fog color `[150,200,255,0]`, integer fog
parameters `[0,4194528,0,2]`, and floats
`[0.000009801238775253296,0.17645263671875,0,1]`. These are pale blue
rather than black. Thus black fog constants do not explain these course
draws' dark output. This trace observes the submitted upload payload and
binding offsets, not a GPU uniform readback. It retains last matched draws
across startup and race, so non-course pipeline values may belong to menus.
Next inspect the race's later blend draws and framebuffer copy/present chain
before altering fog or forcing output colors.

### Race draw-order trace (2026-10-05)

The isolated diagnostic retains up to 600 draws per presented frame, recording
framebuffer, pipeline, index/vertex count, texture-group ID and matched pixel
constants. The generation-1 Luigi Circuit capture has 465 draws and no
renderer errors. Local evidence:
`work/double-dash-race-draw-order.json` and the matching PNG.

In that capture draw 293 is a six-index depth-independent alpha-blended EFB
quad (pipeline 576 / fragment 575), followed by draws into framebuffer 71
and 47. Its pixel constants include color register 1 `[0,0,255,0]`. The
trace alone does not establish its coverage or whether it darkens the world.
A separate ignored overlay-bisection server can skip this fragment ID; IDs
must be verified after reboot before interpreting its result. This is a local
diagnostic only and must not become a shipped rendering fix.

The initial ID-based probe was inconclusive: the reboot had no fragment 575,
so the skip condition never targeted that shader. A source-text match has
replaced the ephemeral ID in the ignored probe; it still needs a fresh
verified run. Do not interpret the initial probe image as an overlay test.

### Source-matched overlay probe result (2026-10-05)

The corrected diagnostic compares generated WGSL source text rather than
ephemeral shader IDs and reports the skipped-draw count. The served worker
passed `node --check` before testing. The restored race report confirms
generation 1, 76 skipped matching EFB draws, and no renderer errors.
The race remains dark and the player minimap icon disappears. Therefore
this shader contributes to HUD imagery and skipping it is not a rendering
fix. Evidence is local: `work/double-dash-source-overlay-probe.json` and
its PNG. The non-skipping diagnostic server was restored afterward.

Next trace the XFB/EFB copy and presentation path, capturing color before
and after the copy rather than removing additional game draws speculatively.

### GPU color readbacks around presentation (2026-10-05)

The isolated color-pair server uses GPU texture-to-buffer copies and maps
them only after submission through the existing deferred readback queue.
The served worker passed syntax validation. Generation-1 captures have no
reported renderer errors. EFB samples at 640x528 include substantial color
(e.g. sky cells RGB 70/107/135 and 77/117/156). Cached presenter-source IDs
initially read empty, so this measurement was strengthened to use the
current group-1 binding-0 record at the end of the backbuffer pass.

The first two current-source samples after restore are empty 608x448
textures. The third (texture 88 in this run) contains the actual dark image:
its upper cells include RGB 43/27/53, 0/0/27, and 9/8/29; alpha is 255.
Evidence: `work/double-dash-race-color-pairs.json` and
`work/double-dash-race-actual-source-color.json`. These observations narrow
the investigation toward copying/composition but do not prove which
operation changes the color: the EFB is reused, source buffers rotate, and
the samples are not yet adjacent to the same specific copy pass. Next sample
the EFB and copy destination immediately at that pass boundary. Existing
legacy copy diagnostics only match 608x456 destinations, whereas these
actual presented source textures are 608x448; do not rely on that filter.

### Aligned copy-boundary result (2026-10-05)

The bounded probe now records EFB, bound source, and destination immediately
after a non-EFB copy pass ends, before later commands reuse the EFB. It maps
readbacks after submission. Served-worker syntax validation passes. The
generation-1 capture has six copy boundaries and no renderer errors; evidence
is `work/double-dash-race-copy-boundaries.json`.

For copy 1 (frame 270, pipeline 73), the 640x528 EFB and bound source are
identical: first grid cells RGB 41/27/51, 0/0/27, and 10/9/29. The 608x448
RGBA destination has similar RGB 43/27/53, 0/0/27, and 9/8/29. Copies 3
and 5 repeat this relationship with rotating destinations. The different
texture extents explain grid-cell differences; this is not pixel equality.
The BGRA 2560x1024 target of pipeline 76 is packed output and must not be
interpreted as an ordinary full-frame RGB image.

Thus the actual presentation copy receives an already dark EFB, contradicting
a conclusion that the final copy is where the darkness first appears. Earlier
brighter EFB samples were at a different point in the command sequence. Next
trace EFB pass endings and clears/draws preceding the copy to identify where
bright scene color changes. No output-color or copy bypass has been promoted.

### EFB pass-end transition (2026-10-05)

The local probe records twelve EFB pass endings, with pipeline ID, frame
number and pass-end reason. Served-worker syntax passes; restored generation
1 has no renderer errors. Evidence: `work/double-dash-race-efb-end.json`
and extracted `work/efbend-460.wgsl` (IDs are run-local).

Frame 423 ends an EFB pass at pipeline 449 with RGB upper cells 59/99/116,
77/117/155 and 74/106/117. The next pass ends at pipeline 460 with upper
cells 5/9/38, 7/11/41 and 7/10/38. HUD-related additions follow before
copying. Later pass 618 restores substantially brighter scene colors,
explaining the earlier misleading present-time EFB readings.

Pipeline 460 is RGB-only source-alpha blending with depth writes disabled
and less-equal depth testing (producer convention). Its vertex shader is
53; fragment shader is 459. Draw-order evidence includes repeated six-index
draws 163-203. Pixel color register 1 varies alpha (e.g. `[250,250,250,8]`,
`[250,250,250,79]`); register 2 is blue-tinted (e.g. `[0,20,50,0]`,
`[10,23,50,0]`). This localizes a measurable brightness collapse to that
pass, not necessarily its final draw. Next inspect that pass's vertex
coverage and TEV/blend values, using source identity rather than stable IDs.
Do not simply remove these draws: their intended contribution is unverified.

### Darkening-pass shader bisection (2026-10-05)

The generated fragment calculation samples a texture, interpolates register-2
blue tint toward register-1 color by sampled RGB, and multiplies sampled
alpha by register-1 alpha. Its source-matched skip probe passed served-worker
syntax validation. The generation-1 race reports 1,919 matching EFB draws
skipped and no renderer errors, yet the course remains dark. Evidence:
`work/double-dash-blended-pass-probe.json` and its PNG.

Therefore those textured quads are not the sole cause of the pass's brightness
collapse. A pass-end measurement includes its attachment load and clear
operations as well as its draws; blaming the last recorded pipeline was too
narrow. Next record the pass's loadOp, encoded clear RGBA, independent
color/depth flags, and in-pass ClearRect commands. The non-skipping server
was restored; the skip probe remains ignored and must not be shipped.

### Pass load/clear and destination-alpha evidence (2026-10-05)

The local pass-state probe captures up to forty passes after restore with
load flags, RGBA, draw sequence, and ClearRect records. Syntax validation
passes. Generation 1 reports no renderer errors. Evidence:
`work/double-dash-race-pass-state.json`. The affected EFB pass uses
`clearMask=0`, color/depth `load`, and no ClearRect. It begins with one
six-index draw using pipeline 420 (fragment 419), followed by the textured
quads investigated previously. The full-screen clear occurs only after
the XFB copy. Thus attachment clears do not explain this pass's collapse.

The first fragment shader (`work/darkpass-419.wgsl`) writes alpha from
`global.member_2[3]` (I_ALPHA.a), not the TEV alpha. Its pipeline blends
color with `src-alpha` / `one-minus-src-alpha`, always depth, and writes
all RGBA. Native PixelShaderGen.cpp WriteColor explicitly says destination
alpha writes the 6-bit override to ocol0 while blending must use the real
TEV alpha from ocol1. WebGPU VideoBackend.cpp advertises dual-source blend
false; ShaderCache.cpp consequently sets no_dual_src and disables the
second source. The current single-output pipeline therefore uses the
destination-alpha override as the color blend factor in this draw.

This provides a concrete semantic mismatch to repair: preserve real TEV
alpha for color blending while independently writing destination alpha.
It does not yet prove this is the only rendering defect. Next implement
and test a faithful two-pass destination-alpha path or supported equivalent,
not a shader skip or replacement color.

### Native destination-alpha prototype (2026-10-05)

Experimental patch 0008 contains a two-pass native prototype. A specialized
fragment shader whose GLSL writes `ocol0.a = float(alphaRef.a >> 2) / 63.0`
gets a second translated variant that writes real TEV alpha for RGB blending.
Affected blended RGBA pipelines use that variant with alpha writes disabled,
then repeat the same geometry with an alpha-only original shader. The alpha
pass disables depth writes and uses equal testing when the RGB pass writes
depth. Both indexed and non-indexed native draw paths are covered.

The Apple Silicon Emscripten build compiled the changed backend and reached
final linking in the isolated `work/double-dash-alpha-core` output. Logs:
`/tmp/controlla-alpha-configure.log`, `/tmp/controlla-alpha-build.log`.
This remains an unverified experiment: patch 0008 is not automatically applied
by prepare-core, not in the default core, and not claimed to solve fidelity.
Runtime verification, ubershader coverage, failure behavior, and build manifest
integration remain before promotion. Source backups live in ignored
`work/double-dash-alpha-source-backup/`.

The prototype build remains confirmed live in exec session 74611 after
compiling the modified backend; final WASM linking has not yet returned.
The producer's SetRecordedPipeline changes only the pipeline ID and leaves
geometry/uniform bindings intact for the second draw. Runtime helper tests
pass 22/22. The builder now rejects default-core output when the experimental
backend is present and records its source hash, prototype marker and patch
0008 in isolated manifests. The default-output rejection was executed and
verified before starting any compilation. Because the running build loaded
the earlier builder script, rerun the updated isolated builder after it exits
to refresh metadata; do not start a second build while the linker is live.

### Destination-alpha candidate race result (2026-10-05)

The isolated build completed successfully, including WASM optimization and
module validation (179 exports). Rerunning the updated builder refreshed
patch-0008 provenance without recompiling. The four-port native ABI check
passed connection/disconnection on all ports and invalid-port rejection.
Candidate SHA256:
`6c7107b1bfe9dea4364f998e3fb86ebbb29dc23f496ae7e67222e650777560d3`.
Output and manifest are in `work/double-dash-alpha-core/`.

The source-snapshot server was switched to that isolated candidate with no
shader-skip probes. Browser evidence confirms this exact core hash, loaded
checkpoint generation 1, 131 shaders, 104 pipeline descriptions, and no
reported renderer errors. The saved Luigi Circuit race now visibly renders
a bright sky, road, scenery, and kart with the HUD intact. Evidence:
`work/double-dash-alpha-race-report.json` and `work/double-dash-alpha-race.png`.
This is the first verified native candidate that removes the previously
measured dark-blue course. It supports the destination-alpha diagnosis.

This remains a candidate, not completed fidelity: driving and menu regressions,
other tracks, four-player split screen, sound, performance, ubershader coverage,
and failure handling still need validation. The default core has not been
replaced, and patch 0008 remains outside automatic prepare-core application.

### Corrected candidate driving and pause evidence (2026-10-05)

Bounded native acceleration on the 6c7107 candidate moves the kart along
Luigi Circuit and the HUD reaches 50 mph. During the hold, native telemetry
confirms button 0x100, stick 128/128, input generation 1; renderer errors
remain empty. Evidence: `work/double-dash-alpha-driving.json`, expanded
PNG, and `work/double-dash-alpha-driving-compact.png` (the latter shows
50 mph and course movement). The 90-frame left-plus-gas probe turns the
kart into the barrier. Its later report confirms neutral release (stick
128/128, zero buttons, generation 4), not a still-held left input. Evidence:
`work/double-dash-alpha-left.json` and PNG.

Start opens the game's native pause menu over the race; screenshot:
`work/double-dash-alpha-pause.png`. This verifies a pause transition, not
all menu transitions or a full race. Performance reports during driving
are approximately 26-30 percent game speed. A magenta strip was visible
in one acceleration screenshot and needs investigation. Physical phone
motion, sound audibility, full races, four-player performance, other tracks,
and wider destination-alpha behavior remain unverified. Candidate remains
isolated from the normal embedded runtime.

### Candidate timing attribution (2026-10-05)

The plain alpha candidate server, without shader snapshot injection, restored
the same generation-1 race with `metrics=1`. The capture at frame 2737
reported 19 percent speed, zero renderer errors, zero producer ring/upload
waits, no residual command backlog after drains, and a host RAF average of
0.223 ms. XFB decoding averaged 2.3 ms; frame intervals averaged 66.5 ms.
Evidence: `work/double-dash-alpha-causal-performance.json` (ignored local file).
These counters do not prove GPU execution cost or isolate PPC execution time.

A second capture with `wgpuprodprofile=1&wgpudrawprofile=1`, frame 583,
reported 20 percent speed. Native sampled estimates include 2.774 seconds
for FIFO decoding across the capture, 0.301 seconds for draw resources,
and 0.266 seconds for upload copies; shader translation accumulated
1.056 seconds. Phase totals can overlap and include boot work, so they
must not be summed into a CPU budget or treated as steady-state race costs.
Evidence: `work/double-dash-alpha-native-performance.json`. Next measurement
should use differences between two restored-race captures and enable the
existing core slice profiler to attribute emulation/advance/throttle time.
The runtime remains experimental and is not promoted by these measurements.

The follow-up steady-state window (`double-dash-alpha-steady-a.json` to
`double-dash-alpha-steady-b.json`, ignored under `work/`) spans 856 frames
and 59.577 seconds with checkpoint generation 1 throughout. Estimated native
FIFO decode cost is 14.944 ms/frame; shader translation is 0.013 ms/frame.
Browser command drain time is 16.356 ms/frame. Native upload copying is
1.953 ms/frame, ring publication 1.601 ms/frame, draw resources 2.079 ms/frame,
and geometry commit 0.774 ms/frame. FIFO decode surrounds `RunFifo`, including
nested draw/upload work, so these phase estimates overlap. The command drain
measurement covers browser CPU replay, not GPU completion.

Source inspection found that `ppcprof=1` disables Cached Interpreter block
redispatch (`CachedInterpreter.cpp`, `redispatch_enabled`). Consequently PPC
profiled speed cannot serve as an unchanged-runtime baseline. Its block/slice
attribution can locate work, but any optimization must be compared afterward
with profiling off. The steady-state evidence above leaves profiling off.

The bounded PPC attribution capture at frame 750, generation 1, reports
14 percent speed with redispatch disabled. Its worst slice is 72.304 ms:
71.725 ms in timing advance, 0.579 ms in execution, no compilation, throttle,
or DVD wait in that slice, and event `other-core-timing`. This is worst-case
evidence rather than an average. The run-loop sample average is 57 us over
567,946 slices, spanning boot and restore. Inspect the timing event callbacks
before concluding that CPU instruction execution dominates. Capture:
`work/double-dash-alpha-ppc-attribution.json`; visible race proof:
`work/double-dash-alpha-timing-race.png`.

### Native state-cache experiment (2026-10-05)

An isolated `wgpustatecache=1` run used the same alpha core, restored checkpoint,
and metrics/native phase options, with PPC profiling off. Generation-1
captures `work/double-dash-alpha-cache-a.json` and `...cache-b.json` span
380 frames over 38.048 seconds. The producer suppressed about 295 slot-1
and 461 slot-2 bind-group commands per frame, with zero suppressed pipeline
commands. Browser drain time is 19.432 ms/frame, native FIFO decode estimate
20.848 ms/frame; end-of-window speed is 18 percent, zero renderer errors and
zero producer ring waits. This window does not show a speed improvement.
Different window lengths and progressing race state prevent attributing the
higher costs solely to caching. The experiment is not enabled in the normal
runtime. Screenshot `work/double-dash-alpha-state-cache-race.png` shows the
bright course, kart, and HUD intact at 0 mph. It does not prove full-render
parity across gameplay. Source inspection confirms cached pass state resets
at pass boundaries and compares bind-group dynamic offsets before suppression.

The profiler's `other-core-timing` category includes `SyncGPUCallback`, which
executes GPU FIFO work on the CPU in single-core mode, as well as DSP and
other events. No named slow-event logs were available from the browser log
capture, so the worst timing callback is not yet identified. Compare dual-core
scheduling and/or expand the event categories before attributing that spike.

### Dual-core restore failure (2026-10-05)

The alpha candidate with `cpu=dual`, PPC profiling and state caching off,
restored the existing single-core race checkpoint. It reported 105-110 percent
CPU game speed, but visual cadence stopped at zero and the stage was black.
Captures `work/double-dash-alpha-dual-a.json` and `...dual-b.json` span 2,153
core frames over 35.965 seconds while presented frame stays 632 and command
count stays 87,724. Shader/pipeline errors, missing resources, and producer
ring waits remain zero. Native FIFO decode call count also stays 236,445;
tail-flush calls continue increasing. Thus the speed counter reflects CPU
progress without fresh GPU production, not playable performance. Acceleration
reaches native pad generation 2, but no visible driving result is verified.
Screenshot `work/double-dash-alpha-dual-driving.png` records the black output.
Dual-core is not promoted. Next check is a fresh boot without the checkpoint
to distinguish cross-mode restore failure from dual-core rendering failure.

### Fresh dual-core stall (2026-10-05)

Fresh boot without restoring state initially renders the title at frame 1,772
with 61 changing frames/second and 103 percent CPU speed. After Start,
the scene freezes before mode selection. Reports
`work/double-dash-alpha-dual-fresh.json` and `...dual-fresh-confirm.json`
advance core frame 3,535 to 7,846 while presented frame stays 1,877,
checkpoint generation stays 0, and visual cadence is zero. The screenshot
`work/double-dash-alpha-dual-fresh-stall.png` shows the unchanged intro scene.
This contradicts a restore-only explanation: dual-core loses FIFO production
even without loading a state. The initial title speed is not evidence of
playable full-speed races. Investigate CPU/CP FIFO delivery and GPU drain
gates with bounded diagnostics; retain the working single-core path.

Disabling generated JIT (`wasmjit=0`) does not resolve dual-core restore
stalling. Captures `work/double-dash-alpha-dual-nojit-a.json` and
`...nojit-b.json` advance frame 1,515 to 5,585 with native JIT run count 0,
but presented frame stays 692 and FIFO decode call count stays 256,002.
The next diagnostic candidate, patch 0009, exposes FIFO drain gates in the
existing helper report without changing execution. It is checked for patch
application, but is not applied, compiled, or included in the runtime yet.

### Compiled FIFO gate candidate (2026-10-05)

The isolated FIFO diagnostic build completed successfully: WASM
`4e3ecea59ec0d6d66710681e4ee93833fea22fa9085b851c762eeaee51c78634`,
179 exports, all four controller connection/disconnection cases accepted and
invalid ports rejected. Manifest records patch 0009, CPU source hash, and the
diagnostic flag. Original alpha candidate remains preserved. The candidate
server now runs on the existing loopback test origin, using the baseline
saved-state key only for this diagnostic comparison; do not save candidate
progress into that key.

At restored generation 1, core frame 842/presented frame 749, the native
report exposes `rwd=0,read=1,link=1,interrupt=0,breakpoint=0`, with read/write
pointers both 4,259,392 and no renderer errors. Evidence:
`work/double-dash-fifo-gate-report.json`. These independent atomic reads
indicate an empty CP FIFO rather than a disabled read gate or pending
interrupt at this sample. A second sample and CPU producer/PI pointer
inspection are needed before attributing the stall's cause.

The second FIFO diagnostic sample contradicts the initial stall assumption:
core frame advances 842 to 1,445 and presented frame advances 749 to 1,352.
The race visibly renders a later timer, with 17 changing frames/second,
29 percent CPU speed, and no renderer errors. CP read/write pointers change
from 4,259,392 to 4,177,248 while queue distance is again zero. An empty FIFO
at a sample is normal when the consumer catches up; it does not establish
missing production. Evidence: `work/double-dash-fifo-gate-second.json` and
`work/double-dash-fifo-dual-race.png`.

This diagnostic-core run omitted `wgpuclassify=1`, unlike the earlier dual-core
stall runs. Both native source and runtime options changed, so no cause is
proven. Compare this same core with classification on before inferring that
patch 0009 fixed execution or that the classifier caused the stall.

The same FIFO core with `wgpuclassify=1` reproduces frozen presentation:
`work/double-dash-fifo-classified-a.json` to `...classified-b.json` advances
core frame 1,967 to 2,734 while presented frame stays 647 and visual cadence
stays zero. Both gate reports show queue distance 0, read/link enabled, no
interrupt/breakpoint, read pointer 4,263,616 and write pointer 4,125,472.
Renderer errors remain empty. This matched-core comparison strengthens the
association with classification but does not prove deterministic causation.
The next isolated server keeps classification on and suppresses only its
EFB, backbuffer, and XFB readback gates; no native code or main runtime changes.

The readback-suppression experiment retains classification but keeps its
three capture gates off. Core frames 1,210 to 3,903 and presented frames
1,206 to 3,897 continue advancing; instantaneous speed reports 41 then
36 percent, visual cadence 23 then 21 fps. Evidence:
`work/double-dash-fifo-no-readbacks-a.json` and `...no-readbacks-b.json`.
These runs support isolating captures from counter collection, while the
exact native scheduling failure remains unproven. Patch 0010 makes classifier
readbacks explicitly opt-in and reports their enabled state. Prepared source
syntax, reverse patch check, idempotent prepare, and 22 runtime helper tests
pass. The permanent patch reports readbacks disabled in the browser and
continues rendering at frame 1,188/presented 1,183, 22 visual fps, 41 percent
speed, and no renderer errors. Evidence: `work/double-dash-fifo-readback-default.json`
and `.png`. This is not full-speed play or a full-race fidelity validation.

### Driving with classifier captures disabled (2026-10-05)

The permanent patch 0010 defaults sustain the native 300-frame acceleration
probe. The kart moves from the start straight to the grass beside the next
turn; the later screenshot is after automatic input release and shows 0 mph.
Report at core frame 2,504/presented frame 2,496 indicates 45 percent speed
and no renderer errors. Evidence: `work/double-dash-fifo-driving.json` and
`.png`. This verifies course movement and continued presentation, not a full
race, physical phone controls, or full-speed play.

The next comparison enables the existing `wgputailgate=1` optimization. Source
inspection confirms its predicates match the early returns in `Flush()` and
`RefreshPeekCache()`; the native flag stays default-off. Compare restored-race
frame deltas, clean/dirty counters, output, and errors before promoting it.
