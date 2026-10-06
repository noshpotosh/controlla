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

The tail-gate comparison stalls: `work/double-dash-fifo-tail-a.json` to
`...tail-b.json` advances core frame 2,188 to 2,799 while presented frame
stays 674. Tail counters show 306,705 clean samples and zero dirty-at-skip
events in the second report. FIFO queue distance stays 0 with read/link
enabled, no pending interrupt/breakpoint, and divergent read/write pointers
(4,283,008 vs. 4,125,472). The option is not promoted. This recurrence under
a different timing change also cautions against treating the earlier
classifier/readback association as a fully identified root cause. Repeat
the same tail-off configuration before further runtime promotion.

### Empty FIFO sleep candidate (2026-10-05)

The repeated tail-off baseline advances 197 core/presented frames over
6.774 seconds, with 37 percent speed and no renderer errors at the second
sample (`work/double-dash-fifo-repeat-b.json`). Browser drain cost is
9.923 ms/frame and sampled native FIFO decode estimate 7.658 ms/frame.
Sampled idle-tail estimate is 64.319 ms/frame across the parallel GPU thread;
these overlapping estimates cannot be summed into an elapsed frame budget.
The extremely frequent idle tail calls motivate patch 0011, which permits
sleep through Dolphin's BlockingLoop when the FIFO is empty rather than
repeatedly calling clean flush paths.

A host C++ test using the actual BlockingLoop header passed 10,000 producer
wakeups with idle sleep permission (`/tmp/controlla-fifo-wakeup.cpp`). This
does not validate Emscripten scheduling or all FIFO behavior. The native
candidate is applied only in the ignored build checkout and built to
`work/double-dash-sleep-core`; the FIFO diagnostic and prior alpha core
remain preserved. Browser speed, latency, presentation, and fidelity checks
remain required before promotion.


The compiled idle-sleep WASM hash is
`733c55a9db62676638d0ee53e20bf47917ed8c2ccdbcfcd2ba6f1931c9018e52`.
Its 179 exports and four-port native input ABI passed integrity/interface
checks. Browser testing rejects promotion: restoring the baseline race
advanced core frames 452 to 815 while presented frames stayed at 110
(`work/double-dash-sleep-a.json`, `work/double-dash-sleep-b.json`).
A fresh boot initially delivered images (presented 245 to 688), rendered
part of the attract sequence, then stalled: core frame 3198, presented
1696, visual cadence zero, reported speed 99 percent
(`work/double-dash-sleep-fresh-d.json`). Therefore this failure is not
exclusive to state restoration, and CPU speed alone cannot qualify it.
The independently observed FIFO distance was zero with read pointer
4347552 and write pointer 4125472; these observations are not a coherent
snapshot and do not establish a root cause. Continue investigating native
FIFO scheduling/pointer consistency before promoting patch 0011.


### Cached-code invalidation candidate (2026-10-05)

Finish-path diagnostics reproduced a stalled restore: core frames 1004 to
2331, presented frame fixed at 503, finish requests/schedules/deliveries
fixed at 1001, active interrupt zero. Bounded OS observations showed all
11 observed threads waiting and no current guest thread. Main-thread queue
0x803cb1ac is referenced by the retail executable's draw-done wait and
finish-interrupt wake code. The disc's debug symbol map is mismatched to
retail function addresses and must not be used for PC attribution.

Disabling DcbxLoop (`disable=8`) delivered 5819 new frames over 228.452
seconds (25.47 fps), including acceleration. FastDcbxLoop incorrectly assumes
that WASM JIT off means no cached compiled blocks; it also skips large
invalidations. Patch 0013 retains batching but restores cache invalidation.
The isolated compiled candidate (`work/double-dash-invalidation-core`), hash
`8b3006242ce105a3e7553543245edc5f5b93671d22cced9c6b15e15c6db64b2a`,
passed integrity, all current patch hashes, and four-port ABI checks.
With batching enabled, restored race samples advanced core 791 to 1775,
presented 759 to 1742, and finish deliveries 1515 to 3480. Acceleration moved
the kart onto grass; second sample speed 54 percent, visual cadence 31.
Reports: `work/double-dash-invalidation-a.json` and `-b.json`; screenshot
`work/double-dash-invalidation-driving.png`. This is a promising candidate,
not proof of root cause or full-speed/fidelity qualification. Longer runs,
fresh boot, repeat restoration, physical phone motion, complete races,
other tracks and multiplayer remain unverified before promotion.


## Combined invalidation and FIFO sleep comparison (2026-10-05)

The isolated combined candidate preserves cached-code invalidation (patch 0013)
and allows the empty FIFO loop to sleep (patch 0011). Its WASM SHA-256 is
`33120978ada83a689aea65547c6eb67d0df168479bde13a268f0908fbf936ed9`.
The native export and four-port ABI checks passed. This candidate has not replaced
the ordinary room runtime.

With state caching disabled, two consecutive restored-race samples delivered
805 frames in 24.215 seconds (33.24 fps). Browser GPU replay averaged 8.231 ms
per delivered frame; sampled FIFO tail work fell to approximately 0.212 ms per
frame. Producer estimates overlap CPU/GPU execution and must not be summed as
elapsed frame time. Acceleration moved the kart onto the grass. These observations
qualify initial driving and continued rendering, not fresh boot, a complete race,
physical phone input, multiplayer, or stable full-speed operation.

The same candidate with `wgpustatecache=1` delivered 5,730 frames in 181.789
seconds (31.52 fps), with browser replay averaging 8.874 ms per frame. The report
confirmed producer state caching enabled. Acceleration again moved the kart;
the subsequent screenshot showed the kart against the course wall with collision
effects. The unequal sample durations and warmup prevent a controlled speed
comparison, but this run provides no demonstrated improvement from enabling the
cache. Keep it opt-in. Evidence is retained locally in ignored
`work/double-dash-combined-cache-{a,b,driving}.json` and the driving PNG.
The saved baseline progress was not overwritten.


### Exact uniform-content cache screen

On the same combined candidate, replay-op deltas from the state-cache run
attributed approximately 7.314 ms per delivered frame to UPLOAD_BUFFER
(periodic timing estimates), with 1,869.3 upload records per frame. This motivated
an isolated `wgpuubocache=1&wgpuubometrics=1` screen, with state caching disabled.
The report confirmed the producer UBO cache active. It suppressed 48,309 vertex,
147,505 pixel, and 93,886 geometry uniform uploads (431,222,992 bytes total).
The restored race delivered 844 frames in 35.932 seconds (23.49 fps), and browser
replay averaged 10.266 ms per frame. This short sample includes warmup and driving
and is not a controlled regression measurement. It does not demonstrate a speed
gain. Acceleration moved the kart onto the grass and the HUD/course remained
visible; visual equivalence and complete-race correctness remain unverified.
Keep uniform caching default-off. Local evidence:
`work/double-dash-combined-ubo-{a,b}.json` and
`work/double-dash-combined-ubo-driving.png`. Baseline progress remains preserved.


### Upload trace cleanup rejected after restored-race stall

The browser verification of the opt-in upload-trace cleanup reached core frame
1,238 with only 381 presented frames. A second observation reached core frame
2,559 with presentation still fixed at 381. No periodic upload trace was captured.
This invalidates promotion of that cleanup; its checkpoint was reverted additively,
and the local runtime patch was reversed. The timing correlation does not prove
that logging is the root cause. Initial cached-code invalidation driving evidence
therefore remains insufficient to establish reliable restoration. Reports are
`work/double-dash-upload-trace-off-{a,b}.json`; screenshot is
`work/double-dash-upload-trace-off-stall.png`. An unfamiliar existing immediate
upload scratch-buffer change was also found in the ignored runtime tree and was
preserved, not absorbed into a tracked checkpoint.


The logging-reverted comparison remained live through core frame 2,442 / presented
frame 2,431. Between two samples it delivered 1,015 frames in 31.848 seconds
(31.87 fps). The right-steering-plus-gas probe changed the kart direction and
position; the screenshot showed Lakitu's wrong-way indicator on the starting
straight. Finish requests/schedules/deliveries advanced together from 2,828 to
4,858. This is one successful repeat, not proof of restore reliability or of a
logging causal effect. In the prior stalled sample, requests/schedules were 755,
deliveries 754, and all guest threads eventually waited with current thread zero.
Restore can replace pending events while lifetime diagnostic counters persist,
so the one-count difference alone does not establish a lost interrupt. FIFO
read/write positions also differed in that stalled run despite zero reported
distance; these independently read fields warrant investigation. New evidence:
`work/double-dash-upload-trace-reverted-{a,b}.json` and the driving PNG.


### Combined candidate fresh boot still stalls

Without loading progress (checkpoint generation zero), the corrected-invalidation
plus idle-sleep candidate rendered the original intro and title, reaching core
frame 2,096 / presented frame 2,087. Start skipped the intro. Later it entered an
attract-mode split-screen race; a Confirm probe did not establish entry into the
interactive game menu. Presentation stopped at frame 3,723 while the core counter
advanced from 4,725 to 6,049. Finish requests/schedules/deliveries all stopped at
7,441; all observed guest threads were waiting and current thread was zero.
FIFO distance was zero, read pointer 4,184,160, write pointer 4,125,472, and safe
read pointer 4,125,440. Thus this failure does not depend on save restoration or
on the reverted upload logging cleanup. Cached-code invalidation preservation
and empty-FIFO sleeping do not yet qualify a reliable dual-core game runtime.
Do not promote the combined candidate. Fresh boot evidence:
`work/double-dash-combined-fresh-{a,b,c,stall}.json` and associated PNGs.
A useful next isolation is hardware rendering with a single CPU/GPU thread,
keeping the corrected core and no progress restore.


### Single-core hardware fresh menu-to-race verification

The same combined native candidate with `cpu=single`, hardware WebGPU, WASM JIT,
and caches disabled booted without progress restore (generation zero). Start
reached the memory-card prompt; Confirm led to the Start Game menu. Native inputs
then selected one player, Grand Prix, 50cc, Mario and Luigi, the default kart,
and Mushroom Cup. Luigi Circuit loaded and completed the countdown. A 300-frame
acceleration probe moved the kart from the starting grid onto the grass.

Race samples advanced from core/presented 14,257/14,242 to 15,874/15,860,
delivering 1,618 frames in 57.970 seconds (27.91 fps), including intro/countdown
and driving. The latter instantaneous speed was 52%; this is not full-speed
qualification. The race-intro camera showed rendering defects, while the later
race screenshot showed the kart, course, minimap, lap and speed HUD. Full-race,
other courses, multiplayer, physical phone motion, and visual equivalence remain
unverified. Do not promote this candidate yet. The normal room runtime remains
unchanged. Evidence: `work/double-dash-combined-single-fresh-{a,b}.json`,
`work/double-dash-single-fresh-race-{a,b}.json`, and
`work/double-dash-single-fresh-race-driving.png`. Baseline progress was preserved.


### Single-core steady queue and mapped upload screen

A stationary segment of the freshly started single-core race delivered 1,048
frames in 38.113 seconds (27.50 fps). Browser replay averaged 8.039 ms/frame;
periodically sampled UPLOAD_BUFFER work accounted for about 6.190 ms/frame.
Native producer estimates included FIFO decode 6.250, ring publish 1.055,
upload copy 1.044 and draw resources 0.902 ms/frame (overlapping estimates).

An isolated reload with `wgpuuploadtransport=mapped` and the preserved baseline
restore confirmed actual mapped transport. Its measured interval delivered 641
frames in 25.984 seconds (24.67 fps), with replay at 7.421 ms/frame. It incurred
210 additional capacity waits totaling 278.645 ms; remap failure count stayed
zero. The kart/course/HUD rendered and race time advanced. This restored,
stationary smoke and the fresh queue sample are not a controlled A/B comparison;
there is no demonstrated end-to-end speed gain. Keep mapped staging opt-in.
No saved progress was overwritten. Evidence: `work/double-dash-single-steady-
{a,b}.json`, `work/double-dash-single-mapped-{a,b}.json` and associated PNGs.


### Expanded racing control probes

The opt-in input panel now includes Brake, Item, Swap riders, and directional
Drift + gas probes. Combined button masks preserve analog gas/brake pressure;
drift also sets the right trigger like the ordinary room controller. Five focused
diagnostic tests passed, including combined drift pressure and timed release.
On the single-core mapped candidate, the native swap probe visibly changed the
rear rider from Luigi to Mario and the minimap portrait changed accordingly.
Evidence: `work/double-dash-rider-swap.json` and `.png`. This verifies native
rider swapping through the diagnostic bridge, not physical phone motion or
multiplayer. Drift, items and braking still require behavioral qualification.
The diagnostics remain opt-in and are absent from the normal room stage.


The initial 90-frame drift attempts turned the kart but were not behaviorally
qualified: native telemetry sampled after release reported neutral controls,
and snapshots did not establish sustained tire slip/sparks. Drift probes now
hold for 300 game frames so the two-second diagnostics interval can observe a
held state. Timed automatic release remains tested. Do not count these attempts
as verified drifting or braking. Captures: `work/double-dash-drift-live.json`,
`work/double-dash-drift-right.json` and associated PNGs.


### Bounded CPU/GPU distance candidate

Patch 0014 enables Dolphin's existing MAIN_SYNC_GPU policy in the browser FIFO
configuration. The experiment keeps original distance thresholds and wake/wait
logic; it does not synthesize guest interrupts or adjust guest FIFO pointers.
Its purpose is to test whether bounding CPU lead prevents the observed dual-core
stall. The build wrapper rejects the ordinary output directory, verifies reverse
patch applicability, and records a boundedGpuDistance manifest flag and patch
hash. Forward/reverse patch checks, wrapper syntax, and isolated configuration
passed. The native build is started with output `work/double-dash-sync-core`;
browser reliability and performance are unverified. Default room runtime remains
unchanged. Do not promote until fresh boot, race driving and repeat restore pass.

The bounded-distance candidate build completed and four-port ABI checks passed
(179 exports). WASM SHA-256:
`e764beb1fe11b2e0facdb9e368b62e00e446913746c4aad00d0a88348727206a`.
A dual-core restored-race sample progressed from presented frame 929 to 1,618,
delivering 689 frames in 31.981 seconds (21.54 fps). Initial speed was
20%, later 43%; this does not establish a performance gain or reliable restoration.
The course, kart and HUD rendered. Fresh boot, driving and repeated restores
remain pending. Evidence: `work/double-dash-sync-{a,b}.json` and PNGs.

The bounded-distance candidate's 300-frame acceleration probe moved the kart
onto the grass near the course barrier (core/presented 3,244/3,246). A second
restore reported checkpoint generation 2 and continued rendering from presented
frame 4,448 to 5,453: 1005 frames in 31.765 seconds (31.64 fps).
Finish delivery counters continued advancing. No stall occurred in this
initial driving and repeated-restore check, but fresh boot, a complete race,
phone motion and full fidelity remain unverified. Keep the candidate isolated.
Evidence: `work/double-dash-sync-driving.json` / `.png` and
`work/double-dash-sync-repeat-{a,b}.json` / final PNG.

Fresh boot of the same isolated bounded-distance candidate (generation 0)
continued through two-player and four-player Luigi Circuit attract sequences.
Presented frames advanced from 7,158 to 9,045 in 47.647 seconds (39.60 fps),
with finish requests, schedules and deliveries advancing to 18,091. This
exceeds the earlier combined candidate's fresh-boot stall at presented frame
3,723, but does not establish long-run reliability. A Start probe during attract
mode did not visibly reach the menu; fresh-start interactive input remains
unverified. No candidate save was made, and shipping defaults remain unchanged.
Evidence: `work/double-dash-sync-fresh-{a,b,c}.json` and final `c.png`.

Follow-up fresh-boot input check reached the title screen after another Start
probe, then accepted Start to open the memory-card creation prompt and Confirm
to reach the original Start Game / Records / Options menu. The earlier absence
of a menu was insufficient evidence of an input failure. Native telemetry
recorded four host/worker updates by the second Start observation; the final
menu rendered at core/presented frames 13,003/12,955, still generation 0.
This verifies fresh-boot Start and Confirm transitions, not race completion
or physical phone controls. Evidence: `work/double-dash-sync-start-input.json`
and `work/double-dash-sync-fresh-menu.json` / `.png`.

The same generation-0 synchronized dual-core boot completed the original
one-player → Grand Prix → 50cc → Mario/Luigi → default kart → Mushroom Cup
menu flow and entered Luigi Circuit. A 300-frame acceleration probe moved the
kart from the grid onto the grass near the barrier; the live HUD showed lap
1/3 and 19.942 seconds. Presented frames advanced 20,025 → 21,412 over
41.934 seconds (33.08 fps), including countdown, input and subsequent idle.
This verifies initial fresh-start driving without a restored checkpoint;
it does not qualify full-race completion, sustained full speed or phone motion.
Evidence: `work/double-dash-sync-fresh-race-{a,b}.json` and
`work/double-dash-sync-fresh-race-driving.png`.

Fresh synchronized-race rider swap was visibly accepted: rear rider changed
Luigi → Mario and the minimap driver icon changed to Mario. A combined
drift/steering/gas probe moved the kart off the grass and turned it onto the
road, but telemetry snapshots sampled neutral input before/after the held
interval and screenshots do not prove sustained drift or mini-turbo. Keep
drift qualification pending rather than treating combined movement as proof.
Evidence: `work/double-dash-sync-fresh-swap.png` and
`work/double-dash-sync-drift-{held,held-b,immediate}.json`.

Retained probe telemetry was browser-verified after reloading the diagnostic
module and restoring the known baseline race. The right-drift probe requested
mask 65, stick X 192, full analog A and right trigger. Observations from core
frames 1,083–1,380 recorded `input:41`, `buttons:120`, `stick:192,128`;
the native formatter emits masks in hexadecimal. The probe released at frame
1,380 against target 1,376. Thus combined input reached native polling across
the held interval; sustained drift/mini-turbo remains unqualified because this
attempt ended against a barrier. Evidence:
`work/double-dash-sync-retained-drift.json` / `.png`.

Lower-overhead screen of the same synchronized core restored the baseline with
`wgpuprodprofile=0&wgpuclassify=0` (metrics and report polling retained).
Native `wgprod:1,0,0,12` confirmed producer profiling disabled. The stationary
race advanced 1,061 → 2,248 presented frames in 41.815 seconds (28.39 fps),
reported speed 44–45%, and continued rendering the HUD. Disabling detailed
profiling did not produce near-full-speed execution in this sample. This is
not a paired controlled estimate of profiling overhead; startup and workload
differences preclude comparing it directly with earlier driving samples.
Evidence: `work/double-dash-sync-profile-off-{a,b}.json` and final `b.png`.

Periodic upload trace gating is retried as experimental JS patch
`0015-opt-in-upload-trace.patch` on the synchronized native candidate. It
requires deep replay diagnostics before formatting/logging the periodic UBO
trace. This preserves the prior attempt as a separate numbered experiment;
that attempt was reverted after a dual-core stall, before bounded GPU-distance
synchronization was added. Automatic preparation and shipping output are
unchanged. Forward/reverse application and worker syntax checks passed on the
active runtime tree, preserving the pre-existing immediate-upload scratch
implementation. A browser reload and performance/reliability check are pending.

The synchronized trace-gated run restored successfully and continued rendering
1,101 → 2,303 presented frames over 42.065 seconds (28.57 fps). Finish requests,
schedules and deliveries reached 4,607 with no stall during this short sample.
The preceding matching restored stationary screen measured 28.39 fps; this
single comparison does not establish a meaningful speed gain. Patch 0015 stays
experimental and excluded from automatic preparation, and its active runtime
application was reversed after measurement (forward applicability and worker
syntax rechecked). The browser retains the tested loaded worker until reload.
Evidence: `work/double-dash-sync-trace-off-{a,b}.json` and final `b.png`.

The existing mixed JIT tier (`wasmjit=2`) was screened with the synchronized
core, baseline restore, producer profiling/classification off, and the upload
trace experiment unapplied. Native stats confirmed `tier:mixed` and
19,079/32,768 compiled mixed blocks by the final sample. Presented frames
advanced 1,106 → 2,320 in 40.099 seconds (30.28 fps), speed 48–50%, with the
race and HUD continuing to render. This small single-run difference versus
the 28.39 fps guarded-tier screen does not establish an optimization or full
fidelity. Mixed remains experimental; driving, fresh boot and long-run checks
are pending. Evidence: `work/double-dash-sync-mixed-{a,b}.json` and final PNG.

Scale-zero quantized-store candidate 0016 compiled successfully into isolated
`work/double-dash-quantized-core`. WASM SHA-256:
`94cf2b8f00ab30d3123786c91aadda3e0972e85c67bb0cabefd7e68b172e4690`.
The manifest records 179 exports, the candidate flag, native CPU source hash
and patch hash. Four-port connection/disconnection and invalid-port ABI checks
passed; no game was booted by those checks. Generated-WASM conversion screens
passed for unsigned-byte and signed-halfword boundaries, infinities and
20,000 seeded values. Native NaNs, unsupported GQR and memory cases retain
fallback. The candidate server validates core/loader/patch integrity and now
serves loopback port 8081; the browser must reload to receive the new core.
Gameplay fidelity, actual helper-call reduction and speed remain unverified.

Initial browser screen of core 0016 used mixed JIT and the baseline race
restore. Presented frames advanced 1,637 → 2,682 over 33.865 seconds
(30.86 fps). The race/HUD rendered and the tab returned no warning/error logs,
but full pixel fidelity is unqualified (a distant magenta strip is visible).
The targeted PSQ fast-helper count stayed zero, with no `psqst7q0` fallback
entry, versus 112,958 → 411,415 PSQ helper calls in the preceding mixed-tier
screen. This establishes helper-path reduction for the observed workload,
not a meaningful speed improvement: prior mixed-tier throughput was 30.28 fps.
Other FP helper calls remained high, 7,591,742 → 17,727,298 in this interval.
Keep the candidate isolated; fresh boot, driving and full fidelity remain
pending. Evidence: `work/double-dash-quantized-{a,b}.json` and final `b.png`.

Paired-sign candidate 0017 (on top of 0016 and synchronized FIFO) completed
native compilation and module syntax validation. Isolated output:
`work/double-dash-paired-sign-core`, WASM SHA-256
`da3298e5f4520002d400bdaa8a72ba6d81af43d5b771f10927282f2549c21484`.
All four controller connection/disconnection and invalid-port ABI checks
passed, with 179 exports. Exact-bit generated-WASM screens passed for neg,
abs, negative-abs and move over 40,000 seeded patterns, signed zero and NaNs.
Rc variants and unavailable FPU keep fallback. The isolated-output rejection
guard was explicitly exercised; default output was not overwritten.
The integrity-checking browser server is prepared but not yet started.
Gameplay fidelity, helper-call reduction and performance remain pending.

Paired-sign candidate browser screen (mixed JIT, baseline restore) rendered
1,223 → 2,712 presented frames in 47.883 seconds (31.10 fps), speed 48–55%.
The race and HUD continued, with no warning/error entries in tab logs. Paired
negation `fp4/40`, previously 2,383,968 calls in the quantized-only final
snapshot, no longer appeared among the top eight FP helpers. This supports
reduction of that path, not proof that every sign helper was eliminated.
Total FP helper calls still advanced 3,789,281 → 15,952,139. The measured
rate is close to the prior 30.86 fps sample and does not establish a useful
speed gain. Fresh boot, driving and full pixel fidelity remain unverified;
keep this output isolated. Evidence: `work/double-dash-paired-sign-{a,b}.json`
and final `b.png`.

Guarded-tier screen of the same paired-sign core (`wasmjit=1`) restored the
baseline and rendered 1,296 → 2,300 presented frames in 41.682 seconds
(24.09 fps), speed 50% → 34%. Cross-module FP helpers advanced only
841 → 1,785 and system helpers stayed zero, but rejected blocks may execute
within the native interpreter and are not represented by those import counts.
Thus low imported-helper counts do not establish low total CPU cost. This
sample was slower than the preceding mixed-tier screen; it does not establish
a repeatable tier ranking because no repeated paired comparison was run.
Neither tier is near full speed. Evidence:
`work/double-dash-paired-guarded-{a,b}.json` and final `b.png`.

Enabled existing `ppcprof=1` on guarded paired-sign core to collect native block
and slice timing. Later telemetry published 995,579,196 blocks / 972,245 samples
at rate 1/1,024, but the current window average rounded to 0 microseconds;
the top window included `0x800a9740` (psq_l), 28 samples / 30us, max 20us.
This sparse microsecond-resolution window is too weak to identify the dominant
execution cost. The worst recorded slice was 53,789us, of which 53,730us was
VI end-field throttling (requested 49,236us), not useful instruction work.
Profiling also disables the native block redispatch shortcut, so throughput
with profiling must not be compared as normal-play performance. These results
justify improving measurement before further opcode optimization.
Evidence: `work/double-dash-paired-ppc-profile{,-later}.json`.

The isolated precise-profile candidate completed compilation and passed the
four-port native input ABI check (179 exports). WASM SHA-256:
`33a8e55cce925633f994124c563b9d5dedda4fb2a5157290e9c4e6ac26746b66`.
Restored the same saved race with guarded JIT and `ppcprof=1`. Two published
windows retained 99,718 and 99,146 samples, averaging 525ns and 493ns per
sampled block. Nanosecond units preserve clock precision; they do not imply
nanosecond clock resolution. Both windows led with `0x8005b5fc` (rlwinm),
`0x800a9740` (psq_l), and `0x800a9774` (stwu), although their ordering varied.
The first block accumulated 665,344ns / 1,412 samples and 608,256ns / 1,381
samples respectively. This repeatability supports examining these blocks
before another speculative opcode change; it does not prove total CPU cost
or a full-speed improvement. Profiling disables block redispatch and retains
its own overhead. The 850 presented-frame interval took 40.06412 seconds
(21.22 fps), so it is not a normal-play throughput qualification. Paused after
capture without overwriting the saved race. Evidence:
`work/double-dash-precise-profile-{a,b}.json` and `-paused.png`.

Follow-up attribution audit: the leading block represents approximately
1.27% / 1.24% of each window's sampled execution time, and all eight displayed
blocks together represent only 5.09% / 4.71%. These percentages use reported
sample count times the rounded average, so their denominator is approximate.
The fixed 4,096-entry table with eight probes also dropped attribution for
15,161 / 15,433 samples (15.20% / 15.57%); totals still include those samples.
Thus the repeatable leaders are not evidence of a dominant opcode bottleneck.
Before selecting a new specialization, broader attribution is needed. The
profile excludes the normal redispatch path and its measurement overhead is
not separately quantified, which further limits conclusions about normal play.

Extended experimental patch 0018 to use 32,768 attribution entries and display
32 blocks. Reports now include exact `totalns`, `attributedns`, `displayedns`,
and `unique` values so coverage does not depend on a rounded average. The
larger table adds approximately 896 KiB of static storage relative to the
previous candidate. It retains the eight-probe bound and sampling rate; it
does not guarantee zero collisions or remove profiling overhead. Reverse
patch provenance and default-output rejection passed. Configuration completed
for isolated output `work/double-dash-broad-profile-core`; compilation and
browser behavior remain unverified at this checkpoint.

The broad-attribution build subsequently completed successfully and its loader
passed module syntax validation. WASM SHA-256:
`77487fd18c360e5d019f1092f5dd1e513feb86c4c8dfd8a126c68b4075ec9005`.
Native input ABI validation passed connection/disconnection on four ports and
invalid-port rejection (179 exports). This check does not boot the game or
validate profiling coverage. Browser testing remains pending.

Browser restoration and two broad-attribution captures subsequently passed.
Both windows reported zero collisions and exact attributed time equal to
sampled total time: 55,015,424ns across 98,604 samples / 9,178 unique blocks,
then 51,328,768ns across 98,860 samples / 9,291 unique blocks. The displayed
32 blocks cover 11.39% and 12.86% respectively. This resolves the previous
table's missing attribution but still shows distributed execution cost.
The second ranking is led by `0x80055e98` with seven samples and a single
940,288ns maximum, illustrating why occasional long samples should not alone
drive specialization. Frequent leaders remain rlwinm, stwu and psq_l blocks.
Profiling overhead and disabled redispatch still prevent normal-play speed
claims. Paused after capture without saving over the baseline race. Evidence:
`work/double-dash-broad-profile-{a,b}.json` and `-paused.png`.

Added a room-authority integration check for motion-capable phone input:
resolved tilt controls receive real binary protocol frames, steer the kart
from left to right while holding gas and drift, and center/release after
260ms without frames. The check asserts the resulting native controller
bytes, including analog A and right trigger. It verifies the software
transport through SessionAuthority into DoubleDash, not physical sensor
calibration, browser motion permission, or the iframe/native endpoint.

Added an embedded-bridge integration test that runs the actual embedded
message listener and polling callback against a fake loaded adapter, then
uses ControllerInputGate and nativeControllerArguments to inspect native ABI
packets. It verifies held steering/gas/drift, four-port connection and missing
port neutralization, stale release, reconnect, and rejection of invalid or
unrelated-window/origin messages without extending input freshness. The
native setter is simulated; this does not prove delivery into a running WASM
game or physical phone operation.

Rechecked the current normal room flow after motion changes: started a room
on localhost:3000, selected Double Dash beside Neon Harvest and Whack-a-Mole,
joined a browser test controller through the room/screen codes, and started
the round. The controller received steering, menu, start/swap and four kart
buttons. Nintendo boot rendering appeared inside the shared room stage with
only the sound gesture button over it. End game removed the iframe, restored
the selectable catalog and enabled Start round. This proves the current
selection/boot/cleanup flow, not physical phone steering, audio output or race
performance. Screenshot: `work/double-dash-room-current-boot.png`.

Experimental patch 0019 admits non-recording `ps_sum0` / `ps_sum1` through the
guarded tier's known-helper classifier. The instructions remain on EmitFpCall,
which flushes dirty register cache state, invokes the native FP helper, checks
for a halt and reloads written GPRs. No arithmetic emitter is added. This is
intended to reduce rejection of surrounding integer blocks while retaining
the reference paired-sum instruction behavior. Rc forms remain excluded.
Reverse patch validation, builder syntax, isolated configuration and default
output rejection passed. Native build is running for isolated output
`work/double-dash-sum-helper-core`; behavior and speed are not yet verified.

The paired-sum helper candidate built successfully (179 exports) and passed
four-port connection/disconnection plus invalid-port ABI checks. WASM SHA-256:
`40171cdf0765bb3fab02724e11258c65ac406c4cf6051370f7cd884802b5ea94`.
Restored the fixed race with guarded JIT, `ppcprof=0`, producer profiling and
classification off. Presented frames advanced 1,744 → 3,147 in 42.18243s
(33.26 fps), reported speed 59% → 58%. Paired-sum opcodes appeared in FP
helper counts rather than the prior leading block-rejection list, confirming
the changed admission path. This one interval is not a repeatable performance
qualification against the earlier 24.09 fps guarded screen: repeated paired
measurements were not run. The screenshot shows an active Luigi Circuit race
but does not establish full-race or all-track fidelity. Paused without saving
over the comparison state. Evidence: `work/double-dash-sum-helper-{a,b}.json`
and `-paused.png`. The candidate remains isolated from the normal runtime.

Measured the matching broad-profile core without patch 0019, with the same
saved race and URL settings (`ppcprof=0`). Presented frames advanced
1,590 → 2,759 in 40.064285s (29.18 fps), speed 54% → 59%. The preceding
candidate interval was 33.26 fps, a 13.99% difference in this pair. This is
stronger evidence than comparison with the older guarded run, but only one
interval per core has been measured and their frame ranges are not identical;
it does not establish a repeatable patch effect. Both remain below full speed.
Baseline core SHA starts `77487fd1`; candidate starts `40171cdf`. Paused the
baseline without overwriting the save. Evidence:
`work/double-dash-sum-baseline-{a,b}.json` and `-paused.png`.

Repeated the paired-sum candidate after reloading and restoring the same save:
presented frames 1,803 → 3,265 in 44.135565s (33.13 fps), speed 58% → 59%.
This agrees closely with the first 33.26 fps candidate interval. The matching
baseline has only one 29.18 fps interval, so repeatability of the patch's
relative effect remains unproven. Both candidate runs are primarily idle-race
observations, not sustained driving or full-track fidelity qualification.
Paused without changing the save. Evidence:
`work/double-dash-sum-repeat-{a,b}.json` and `-paused.png`.

Repeated the matching baseline after reload/restore: presented frames
1,827 → 3,079 in 39.900165s (31.38 fps), speed 51% → 63%. The second candidate
interval (33.13 fps) exceeds this by approximately 5.57%; the first pair's
difference was 13.99%. Thus both measured comparisons favor admission, but
baseline variation prevents a precise gain claim. Two intervals per core
remain a limited screen of idle-race performance, not statistical qualification
or full-speed driving. Retain patch 0019 as an isolated candidate for further
behavior tests. Evidence: `work/double-dash-sum-baseline-repeat-{a,b}.json`
and `-paused.png`. The normal runtime remains unchanged.

Further behavior screen on the matching baseline (`77487fd1`): a 300-frame
acceleration probe moved the kart from the start straight to the course edge.
Retained native observations showed input mask `1`, native buttons `100`
(hex A), and centered stick through release at frame 5,443. A subsequent
90-frame left-steer-plus-gas probe delivered stick `64,128` and changed the
kart's heading toward the banked road. Swap riders changed the visible rear
rider from Luigi to Mario and the minimap portrait to Mario. These are
diagnostic native-input checks, not physical phone tests, a completed lap,
or validation of patch 0019. Items, moving brake response and sustained drift
still need direct behavior checks. Evidence:
`work/double-dash-baseline-drive-{accel,steer,swap}.{json,png}`. Paused without
overwriting the comparison save.

Repeated acceleration (300 frames), left steering with gas (90 frames), and
rider swap (30 frames) on paired-sum candidate `40171cdf`. Acceleration moved
the kart to the course edge, steering changed its heading toward the banked
road, and swapping changed the visible rear rider and minimap portrait from
Luigi to Mario. Retained acceleration observations show native A (`100` hex)
held through release at frame 1,963. A distant magenta strip is visible in the
acceleration screenshot; visual fidelity remains unresolved and its cause is
not attributed to patch 0019 by these checks. No lap, item use, moving brake
response, sustained drift or physical phone was qualified. Paused without
changing the save. Evidence:
`work/double-dash-sum-drive-{accel,steer,swap}.{json,png}`.

Initial magenta-strip source audit: the active worker has
`S28AX_FS_CONST=false` and `DIAG_DUMMY_TINT=false`; its missing-resource dummy
is not initialized to magenta. Native magenta invalid textures exist in
VideoCommon/Resources/InvalidTextures.cpp, but the color texture is referenced
by custom material resource fallback, not established as the strip's path.
The captured browser log query returned no `dummytex` entries and no warning
or error entries; absence of those logs does not prove correct resources or
pixels. Do not hide the artifact by replacing magenta with another color.
Further classification at the affected draw/texture is needed before a
rendering fix can be selected.

### Frame-chain readbacks and texture fallback reporting (2026-10-05)

The isolated paired-sum candidate was booted with `wgpuclassify=1` and
`wgpuclassifyreadback=1`, then restored from the same saved race. The capture
`work/double-dash-artifact-classifier.json` reports `FIRST_EFB_PASS_MUTATED`,
zero missing resources, no split passes, and nonzero color readbacks from
EFB, XFB, and backbuffer. These establish a working presentation chain, not
correct per-draw texture/color semantics. Acceleration was observed at native
frames 969–1251 and released at 1266 (target 1264). The final screenshot faces
a close track wall; it does not reproduce or resolve the earlier distant
magenta strip. Readbacks describe early post-restore frames, not this final
wall view.

Patch `0020-report-texture-fallbacks.patch` adds worker-lifetime missing texture
and unsupported-format substitution counts and copied ID/format arrays to
`commandReplay.textureFallbacks`. Unlike the classifier's missing-resource
count, this also exposes the format substitution path; counters are cumulative
and need before/after snapshots to attribute a scene. Preparation applies the
JS-only patch. It changes no texture or draw behavior. Worker and preparation
syntax checks and reverse patch applicability passed. Browser inspection of
the new payload remains pending until the worker reloads.

### Browser texture fallback comparison (2026-10-05)

Reloaded patch 0020 is browser-verified. Boot, restored-race frame 1071, and
post-drive snapshots all report zero missing and unsupported-format fallback
counts, with empty ID/format arrays. Acceleration targeted frame 1490 and
released at 1491. Evidence is in `work/double-dash-texture-before.json`,
`work/double-dash-texture-after.json`, and `work/double-dash-texture-after.png`.
The screenshot again contains distant saturated pink regions, so the worker's
dummy substitution paths do not explain them in this run. This does not
establish that the pink regions differ from original course artwork; a
reference-renderer comparison is still needed before treating them as defects.
This run reports `FIRST_EFB_PASS_NO_MUTATION_LATER_PRESENT_MUTATION`: the
first sampled pass is empty but later color readbacks are nonzero. This differs
from the previous run and makes first-pass classification unsuitable as an
image-equivalence gate after restore. The emulator is paused and the saved
race baseline was not overwritten.

### Reference paired arithmetic candidate (2026-10-05)

Source audit found a concrete aliasing defect in `EmitPairedSingleScalarMulAdd`:
when `FD == FC` and scalar lane zero is selected, writing destination lane zero
changes the scalar read by lane one. For `ps_muls0`, A=[2,3], C=[5,7], FD=FC,
the emitted sequential arithmetic produces [10,30] rather than [10,15].
The reference interpreter calculates both results before `SetBoth`.
The direct add/sub, multiply/add/sub, and scalar multiply/add emitters also
skip the reference handlers' FPSCR/FPRF updates; multiply paths omit
`Force25Bit`, and separate WASM multiply/add is not equivalent to the
reference fused arithmetic for all operands. No claim is made that this
explains the distant pink artwork or that the game executes the alias case.

Experimental patch `0021-reference-paired-arithmetic.patch` replaces those
three emitters with `EmitFpCall`, retaining block execution while delegating
these operations to the existing native reference interpreter. Sign and merge
operations remain separate. It is excluded from automatic preparation. The
builder requires isolated output, verifies reverse applicability, and records
its flag/hash. Syntax, reverse applicability (including patch 0019), default
output rejection, and isolated configuration passed. Native compilation is
running under exec session 24970, logging to
`/tmp/controlla-reference-paired-build.log`, with output
`work/double-dash-reference-paired-core`. An initial relative output path
failed the output guard; reconfiguration used an absolute path. Browser and
performance validation remain pending. Existing candidate binaries and the
shipping core are preserved.

### Reference arithmetic build and browser validation (2026-10-05)

Build session 24970 completed successfully. Isolated WASM SHA-256 is
`56a9c321d43d069485aa748c4151887d47121b91fcb357862bf8f232b59ba0cc`,
loader SHA-256 is `d70a9ce5c7137636d755306daf723e87b2e92b58efefe663a4155ce7b1e05627`.
The module has 179 exports; all four controller ports accept connection and
disconnection, and invalid ports are rejected. The manifest records patch 0021
and `referencePairedArithmetic: true`.

The local server now runs `work/double-dash-reference-paired-serve.mjs` in
session 10756 on port 8081; previous sum-helper server 44087 exited 130. It
verifies the new patch hash in addition to existing candidate provenance.
Browser-reported active SHA matches the new WASM, without fallback. The same
saved race restored successfully. Profile and classifier are disabled.
Captured reports `work/double-dash-reference-paired-{a,b}.json` span presented
frames 942–2033, 1091 frames over 44.29864 monotonic seconds: 24.6283 fps.
Game speed reports 46% then 36%; no renderer errors or texture fallbacks were
reported. This single interval is slower than the earlier paired-sum samples
near 33 fps; it does not qualify sustained racing performance.

Acceleration targeted frame 2924 and released at 2931. The final driving
report and screenshot are `work/double-dash-reference-paired-drive.{json,png}`.
The kart reaches the flower/grass edge, confirming coarse driving behavior.
The distant animated regions appear cyan in this capture, but the race clock
differs from previous pink captures, so this is not evidence of a color fix.
The emulator is paused; baseline progress is preserved. Native semantic
regression coverage, repeat throughput measurements, full-race behavior,
audio, physical motion controls, and original-frame equivalence remain open.

### Generated-WASM scalar alias regression (2026-10-05)

Experimental patch 0022 extends the existing exported
`RunPpcWasmSinglePrecisionArithmeticSmoke` with four generated-WASM cases:
`ps_muls0`, `ps_muls1`, `ps_madds0`, and `ps_madds1`, each with FD=FC.
A=[2,3], C=[5,7], B=[1,4] yields expected pairs [10,15], [14,21], [11,19],
and [15,25]. The smoke checks exact integer-valued results, FPRF updates,
and final next-PC. It invokes the actual block compiler and imported native
FP handler. The original arithmetic smoke cases remain. These cases cover
scalar aliasing and classification only, not full exception/rounding semantics.

The builder records the regression patch hash and rejects default output.
JS syntax and reverse patch applicability passed. Build session 82230 is
linking, logging to `/tmp/controlla-reference-paired-regression-build.log`.
The earlier 56a9c321 candidate binaries/manifest are preserved at
`work/double-dash-reference-paired-before-regression`; the regression build
uses `work/double-dash-reference-paired-core`. Executing the new smoke remains
pending until compilation completes. The already-loaded browser stays paused.

### Native scalar alias regression passed (2026-10-05)

Build session 82230 completed successfully. WASM SHA-256 is
`d8a9863f91f476bd4a6ddc7165f8f52c34777d927218409027bac5fd27a6275b`. The integrity-checking runner
`scripts/mario-kart/check-paired-arithmetic.mjs` initialized the native runtime
and executed the exported generated-WASM smoke successfully: all four alias
result pairs, FPRF updates, and final next-PC passed. Existing single-precision
smoke cases also passed. The refreshed binary passed all four-port ABI checks.
No game was booted during these checks.

Run with `DOLPHIN_WASM_OUTPUT_DIR=/absolute/candidate/output npm run
mario-kart:check-arithmetic`. The runner rejects missing regression provenance
and checks loader/WASM hashes before execution. Output is retained in
`/tmp/controlla-paired-arithmetic-check.log`. Full rounding/exception coverage
and an unfixed-emitter negative control remain to be exercised. The previous server 10756 exited 130; replacement server 82779 verifies
and serves the new manifest on port 8081. The browser remains paused with
the earlier binary loaded until its next reload.

### Native negative control detects scalar alias defect (2026-10-05)

Negative-control build session 52415 completed successfully with patch 0022
and the original arithmetic emitters (patch 0021 temporarily reversed). Its
manifest records `referencePairedArithmetic: false`, regression enabled, and
WASM SHA-256 `79182c863a1209d3f8d3b8e9fb36075934afcdfd681e8909e6069be92a5a4865`.
The same integrity-checking regression runner fails with code 71, the first
`ps_muls0` alias result check. The fixed binary passes via
`npm run mario-kart:check-arithmetic`. This establishes an actual generated-WASM
regression and its correction, rather than a source-only prediction.

Negative output is preserved in `work/double-dash-paired-negative-core`;
logs are `/tmp/controlla-paired-negative-build.log` and
`/tmp/controlla-paired-negative-check.log`. Patch 0021 was reapplied and reverse
applicability confirmed. Configuration was successfully restored to the fixed output.
The paused browser and test server continue to use the fixed candidate.
This validation does not establish full game fidelity or solve its performance
cost. Further exact arithmetic optimization remains necessary.

### Direct reference dispatch performance candidate (2026-10-05)

Patch 0023 changes the native FP import's OPCD=4 arithmetic dispatch from
`GetInterpreterOp` plus indirect invocation to a switch calling the same
reference handlers directly. Cases 10–15, 20,21,25,28–31 match the interpreter
A-form table; other instructions retain table dispatch. FPU availability and
program/DSI checks, counters, rounding, exceptions, FPRF, and alias handling
remain in their existing reference paths. This is an optimization candidate,
not evidence of a speed improvement.

The builder rejects default output and records/verifies patch 0023 provenance.
Syntax, reverse applicability and isolated configuration passed. Native build
session 56892 is running with output `work/double-dash-direct-reference-core`
and log `/tmp/controlla-direct-reference-build.log`. The fixed reference binary
and negative control are preserved. Generated-WASM arithmetic regression and
browser throughput comparison remain pending. Patch 0023 is excluded from
automatic preparation.

### Direct reference dispatch build and browser sample (2026-10-05)

Build session 56892 completed successfully. WASM SHA-256 is
`e8a5d7fab723afb5e36ac6174e1337ec9d031f5eed4cb1a10efb32ac6c473a38`,
with 179 exports. The native generated-WASM scalar alias/FPRF/next-PC smoke
and all four-port ABI checks passed.

Server 82779 exited 130; candidate server 66790 verifies patch 0023 and
serves the isolated output on port 8081. Browser active-core SHA matches
the candidate, and the fixed saved race restored successfully. Profiling,
classification and readbacks were disabled. Captures
`work/double-dash-direct-reference-{a,b}.json` span presented frames
1185–2505: 1320 frames over 47.846935 monotonic seconds, 27.5880 fps.
No renderer errors were reported. The paused screenshot is
`work/double-dash-direct-reference-paused.png`.

This interval is higher than the previous reference-handler interval
(24.6283 fps), but single intervals and differing race-clock ranges do not
establish a repeatable gain. Both use the same restored idle race workload.
The candidate retains reference handlers and passes the concrete arithmetic
regression; full FP edge cases, sustained driving throughput and full-speed
original fidelity remain unverified. Baseline progress was not overwritten.

### Repeated direct reference dispatch measurement (2026-10-05)

A fresh reload/boot restored the same saved race with candidate SHA e8a5d7fa,
profile and classifier disabled. Reports
`work/double-dash-direct-repeat-{a,b}.json` span 1293 presented frames over
45.931335 monotonic seconds: 28.1507 fps, with no renderer errors.
Screenshot `work/double-dash-direct-repeat-paused.png` shows the idle kart
on the starting straight, Lap 1/3 at 53.551 seconds; emulator is paused and
progress baseline remains untouched.

The two candidate intervals measure 27.5880 and 28.1507 fps, versus the one
reference-table interval at 24.6283 fps. Candidate repeat consistency is useful
but does not establish the gain until a repeated baseline comparison is
collected. These idle race intervals still fall far short of original full
speed and do not qualify sustained motion-controlled racing.

### Repeated reference baseline comparison (2026-10-05)

The preserved reference arithmetic binary d8a9863f (regression patch included,
direct-dispatch patch absent) was served by session 42424 after candidate
server 66790 exited 130. Fresh reload/boot restored the same saved race, and
browser active SHA matched the baseline. Renderer, CPU/JIT and disabled
profile/classifier settings matched the candidate. Captures
`work/double-dash-reference-baseline-repeat-{a,b}.json` span 942 presented
frames over 47.96046 monotonic seconds: 19.6412 fps. No renderer errors were
reported. The paused screenshot shows the idle starting straight at 46.942
race seconds. Baseline progress was not overwritten.

Baseline intervals are 24.6283 and 19.6412 fps, while direct-reference dispatch
intervals are 27.5880 and 28.1507 fps. Both baseline intervals are slower,
supporting retaining patch 0023 as a candidate, with its native arithmetic
regression already passing. Baseline variation and nonidentical race-clock
windows preclude a precise percentage-gain claim. These measurements do not
prove full-speed gameplay, driving performance, or complete original fidelity.
The live server/browser currently use the paused baseline; isolated candidate
binaries remain preserved for the next experiment.

### Expanded native paired arithmetic comparison (2026-10-05)

Patch 0024 adds 3744 differential cases to the exported arithmetic smoke:
13 A-form paired operations, three aliased destination registers, eight
FPSCR low-bit modes (rounding and NI), and 12 rotated operand vectors.
Values cover signed zero, finite rounding boundaries, single subnormals,
large finite values, infinities and quiet/signaling NaNs. Each case first runs
the reference table handler, then resets inputs and runs the emitted WASM
block, comparing both result lanes bit-for-bit, complete FPSCR and next-PC.
The original smoke inputs are reset before its existing tests run. This
qualifies emitted arithmetic against the native reference, not independently
against physical GameCube hardware or all exception-enable modes.

The builder/runner verify patch 0024 provenance. Syntax, reverse applicability
of patches 0022/0024, and isolated configuration passed. Build session 61226
is running to `work/double-dash-paired-differential-core`, logging to
`/tmp/controlla-paired-differential-build.log`. Prior candidate binaries remain
preserved, and browser baseline stays paused. Differential execution is
pending compilation.

### Expanded arithmetic comparisons passed (2026-10-05)

Build session 61226 completed successfully. Isolated WASM SHA-256 is
`8de36c9c9a73fff3a3427a98c8a81bae54d2b9fe468929dd19264fedf174ac3c`,
with 179 exports. The integrity-checking runner executed all 3744 differential
cases successfully: bit-identical result lanes, complete FPSCR and next-PC
matched the native interpreter. Existing single-precision and scalar-alias
cases passed as well. The four-port input ABI also passed. Check output is
`/tmp/controlla-paired-differential-check.log`. No game was booted by the tests.

The runner now records the successful check's timestamp, tested WASM hash,
scalar-alias count and differential count in the isolated build manifest.
A fresh build replaces the manifest, requiring fresh verification. This
record qualifies the tested native comparison cases, not original hardware
equivalence, exception-enable behavior, all possible operand combinations,
or browser gameplay/performance. The new binary has not yet been browser
validated; the paused baseline server/browser remain available.

### Verified candidate in the ordinary game stage

Run `npm run dev:mario-kart:candidate`, then select Double Dash from the shared
Controlla game picker. This uses the isolated paired differential core and WebGPU
inside the ordinary stage. Candidate selection checks the native input ABI, the
3,744-case arithmetic verification, patch provenance, and loader/WASM hashes.
The default core output is `work/double-dash-paired-differential-core`; override
with `DOUBLE_DASH_CORE_OUTPUT_DIR`. These local build outputs remain ignored.

Embedded boot previously waited indefinitely for a suspended AudioContext to
resume before starting the core. Embedded mode now starts muted and uses the
existing Enable sound button for a user gesture. Browser testing of the official
candidate server reached the attract sequence with emulator controls hidden;
clicking Enable sound completed and removed the button. Audible sound quality
was not assessed. Screenshots are in `work/double-dash-embedded-candidate.png`
and `work/double-dash-embedded-candidate-sound.png`.

The complete candidate room launch was prevented by an existing vinext dev
server in this checkout; that server was preserved. The shared picker/stage
was verified earlier with the default runtime. Candidate runtime selection and
embedded four-port input tests pass, as do TypeScript and renderer tests. This
is a testing checkpoint, not a claim of original-speed gameplay or physical
phone motion qualification.

### Candidate shared room browser verification

The candidate room test now passes in an isolated worktree at
`/private/tmp/controlla-double-dash-room-check`, branch
`codex/double-dash-room-check`, based on checkpoint `5815712`. The existing
checkout/server was preserved. The isolated frontend used port 3001, signal
port 8799 with matching localhost allowed origins, and runtime port 8082.

Created room FDRCW / screen 90EF, selected Double Dash beside Neon Harvest and
Whack-a-Mole, connected a browser controller, and started the ordinary round.
The embedded URL used WebGPU/dual CPU and the verified differential candidate.
The game reached its animated attract sequence with emulator controls hidden;
the sound gesture removed Enable sound. The controller received Steer, Menus,
Start / Swap, Accelerate, Brake, Drift, and Item controls. No browser console
errors were observed in the final running state. This proves room boot and
controller layout, not physical motion or control-to-game behavior.

End game restored Start round and all three game choices; the DOM contained
zero iframes afterward. Screenshot: `work/double-dash-candidate-room.png`.
Temporary test tabs and the isolated frontend/signaling servers were stopped.
The test worktree is retained for recovery. Original-speed gameplay, audio
quality, physical phone motion, multiplayer, and complete race qualification
remain open.

### Opt-in floating-point opcode attribution candidate

Patch 0025 gates the detailed 65,536-entry FP opcode attribution counter on
`s_ppc_block_profile_enabled`. The aggregate FP import count remains available
in ordinary runs; detailed opcode counts require CPU profiling. Arithmetic,
FPU checks, dispatch, and program/DSI checks are unchanged. Previously the
detailed table was updated on every imported FP operation even with profiling
disabled. This is a performance hypothesis, not a measured speed improvement.

The candidate uses isolated output `work/double-dash-fp-attribution-core`.
Build provenance checks patch 0025 and candidate selection verifies its hash
when enabled. Configuration succeeded; native build and arithmetic/browser
qualification are pending. The earlier verified candidate is preserved at
`work/double-dash-paired-differential-core`. Logs:
`/tmp/controlla-fp-attribution-configure.log` and
`/tmp/controlla-fp-attribution-build.log`.

The arithmetic verifier now exercises patch 0025 with CPU profiling disabled,
enabled, then disabled again. It requires arithmetic comparisons to pass each
time and checks detailed FP opcode counts remain empty initially, become
nonempty with profiling enabled, and stop updating after profiling is disabled.
JavaScript syntax passed. The exact native build remains live in session 52709
(linker PID 22921 observed active); these new runtime assertions have not yet
executed against its output. No speed improvement is claimed.

### FP attribution candidate build and arithmetic result

Build session 52709 completed with exit zero. Candidate WASM hash:
`e65f32b6c9a562e8beb223e46b97e410a99c6a34b43bc0dc3a7178a0c0cab6a3`.
Module syntax and four-controller native ABI checks passed. The arithmetic
verifier passed all 3,744 differential cases and scalar alias checks with
profiling disabled, enabled, and disabled again. Verification evidence was
saved against this exact binary in its ignored manifest.

The initial counter assertion failed because GetPpcWasmHelperStats caches its
report using production block counters; native smoke blocks do not invalidate
that cache. Counter assertions were removed from the runner rather than
treating the cached report as a fresh observation. Counter-toggle behavior
remains unverified. Arithmetic comparisons remain meaningful in both modes.
Log: `/tmp/controlla-fp-attribution-check.log`. Browser gameplay and performance
for this candidate are still pending; no speed improvement is claimed.

### FP attribution candidate initial browser sample

The production candidate gate initially rejected this output because the
runtime nativeInputAbiChecked flag was absent. The preceding build result
proved export structure, not runtime controller behavior; the earlier ABI
claim was too strong. Ran `mario-kart:check-abi` against this isolated output:
all four ports accept connect/disconnect and invalid ports are rejected. The
manifest now records that successful runtime check, and official candidate
selection admits the exact e65f32b6 binary.

Official server session 9068 serves this candidate on port 8082. Browser tab 18
booted the local game with WebGPU, dual CPU, WASM JIT, 700 warmup, and profiling
disabled. It rendered the attract sequence without console errors. Resume
progress found no saved checkpoint for this origin/core hash, so this sample
is not comparable to the earlier idle-race samples.

Presented frame delta was 307 over 44.064345 monotonic seconds, or 6.9671 fps.
Evidence: `work/double-dash-fp-attribution-attract-{a,b}.json`; screenshot
`work/double-dash-fp-attribution-attract.png`. The scene changed through the
attract demonstration; compilation and scene costs were not isolated. No
performance gain or regression versus the earlier candidate is established.
Full speed remains unmet. Candidate tab 18 is paused and retained, along with
the paused baseline tab 14 and its existing server.

### Explicit checkpoint transfer for controlled comparisons

`checkpointfiles=1` adds diagnostic-only Export checkpoint and Import checkpoint
buttons. Export downloads native state bytes locally; import delegates native
compatibility checking and does not overwrite browser saved progress. The
ordinary game UI does not enable this option. Four progress tests pass,
including explicit import success, empty input, unloaded adapter, and native
compatibility rejection. Transfer end-to-end remains unverified.

Automatic approval review rejected navigating paused baseline tab 14 because
it could discard unsaved race state. That tab was preserved. Separate tab 19
showed the transfer controls but did not finish engine startup during the
bounded observation; Resume progress reported an unloaded adapter. No state
was exported/imported. Temporary tab 19 was closed; paused tabs 14 and 18
remain. Screenshot: `work/double-dash-checkpoint-transfer-controls.png`.
A matched-checkpoint speed comparison remains pending.

### Exporting saved progress without an engine

Added diagnostic Export saved checkpoint. It reads only the existing browser
record for the game/core key, copies bytes, and requests a local download; it
does not boot or mutate an emulator and does not overwrite saved progress.
Five progress tests pass, including immutable export and missing-record errors.

A fresh baseline tab still did not complete boot after an early sound gesture,
so audio activation alone is not an established explanation for that stall.
A separate unloaded tab successfully found the saved browser record and
triggered the checkpoint download action. The browser download event timed out,
so saved-file existence and import remain unverified. Access to Downloads was
denied by OS permissions; no broader access was attempted. Export status now
says download requested, reflecting what the page can actually prove.
Screenshot `work/double-dash-saved-checkpoint-export.png` captures the prior
status wording. Temporary tabs were closed; paused tabs 14 and 18 preserved.

### Standalone muted boot and fresh FP attribution

The standalone candidate profiling tab also stalled before loaded state.
Official serve now suppresses the upstream auto-unmute block in every mode,
so boot does not await a suspended AudioContext. Standalone retains its Sound
button; embedded retains Enable sound. A fresh browser run with the change
reached Game loaded, animated the attract sequence, and accepted the explicit
Sound gesture (Muted changed to Audio). Audible quality was not assessed.
Server session 96236 replaces the task-owned 8082 server; paused tabs were
not navigated or reloaded. Temporary profiling tab was closed after capture.

Fresh e65f32b6 CPU-profiling report is in
`work/double-dash-fp-attribution-cpu-profile.json`. It contains 3,354,578 FP
imports, with fp4/21 (paired add) at 1,149,498 and fp4/20 (paired subtract) at
926,532: approximately 62% combined. The earlier profiling-off attract report
contains no FP opcode attribution entries. This establishes collection off/on
in separate browser runs, not a same-run toggle or per-operation time cost.
The helper report's sampled block profile fields remain zero; they do not
provide useful block timing attribution here.

Evidence screenshot: `work/double-dash-muted-profile-boot.png`. JavaScript
syntax passed. This fixes an observed startup wait; no speed gain, complete
race, or original fidelity claim follows from it.

### Finite paired add/subtract candidate

Patch 0026 adds a guarded native fast path for OPCD 4 paired add/subtract.
All four input lanes must be finite, determined by their double exponent bits.
The reference NI_add/NI_sub helpers perform no exception mutation for finite
inputs; the candidate computes double sums/differences and retains reference
ForceSingle, UpdateFPRFSingle, optional UpdateCR1, FPU availability checks, and
program/DSI checks. Both lane results are computed before writing FD, preserving
FA/FB destination aliases. NaNs and infinities use unchanged reference handlers.
FP total and opt-in opcode counters remain collected on the fast path.

This is an unqualified performance experiment. The original interpreter
handlers remain unchanged as the differential oracle. Existing 3,744 native
comparisons cover some finite, exceptional, alias and rounding inputs, but not
all possible values, Rc paths, or exception-enable scenarios. No fidelity or
speed claim is made until checks and browser comparisons run.

Configuration passed; native build is live in session 65455, output
`work/double-dash-finite-paired-core`. Logs:
`/tmp/controlla-finite-paired-{configure,build}.log`. Patch provenance guards
require isolated output and verify patch 0026; runtime candidate selection
rejects stale patch evidence. Prior verified cores remain preserved.

The arithmetic runner now requires patch 0026 provenance and differential
coverage for finite-path candidates, and records 576 paired add/sub cases
with that patch hash only after a successful native run. These are the
existing matrix's two operations × three destinations × eight FPSCR modes
× twelve operand vectors, not 576 finite-only cases. Syntax passed; execution
awaits the live build session 65455 (linker PID 29578 observed active).

Temporary candidate tab 18's paused e65f32b6 attract state was saved through
Save progress; status confirmed completion at 18:17:04 local. Screenshot:
`work/double-dash-fp-candidate-saved.png`. The saved temporary engine was then
closed to release its memory. Baseline race tab 14 remains open and paused.
The saved candidate state is scoped to port 8082 and its core hash; restore
has not yet been reverified.

### Finite paired arithmetic native and initial browser results

Build session 65455 completed successfully. Exact WASM:
`215574b1bfcb9a2e57de35cd481da473d51b5614b8b1c69fbb1d15b8595dcdaf`.
The arithmetic runner passed all 3,744 cases with profiling off/on/off,
including 576 paired add/sub comparisons and existing scalar alias/FPRF/next-PC
checks. Native controller ABI checks accepted all four ports' connection and
disconnection, rejecting invalid ports. Logs:
`/tmp/controlla-finite-paired-check.log` and the configure/build logs.

Official candidate selection admitted this exact verified output on port 8083
(server session 68234). Fresh browser tab 24 booted muted and rendered attract
scenes. Presented frames advanced 724 over 56.396665 monotonic seconds,
12.8376 fps. No console errors appeared. Reports:
`work/double-dash-finite-paired-attract-{a,b}.json`; screenshot:
`work/double-dash-finite-paired-attract.png`. Tab 24 is paused and retained;
baseline tab 14 remains preserved.

This interval differs in scene and timing from the earlier e65f32b6 attract
sample, so it does not establish a causal speed gain. Full speed remains unmet.
Rc/exception-enable coverage, matched-race performance, full races, audio and
physical motion qualification remain outstanding. Default candidate launcher
continues using the earlier preserved output rather than promoting this one.

### Paired CR/FPSCR/exception comparison candidate

Patch 0027 adds 1,536 native differential comparisons for paired add/subtract:
two operations × three destinations × two Rc modes × eight FPSCR seeds ×
eight operand vectors × two MSR exception-enable modes. FPSCR seeds include
rounding/NI modes, FI/FR, exception enables and existing status flags. Inputs
include finite values, signed zero, small values, infinity, quiet/signaling NaN.
Both result lanes, FPSCR, all eight CR fields, halt return, Exceptions and npc
are compared to the original interpreter plus the same exception dispatch
wrapper. The original interpreter remains unchanged as the oracle.

The comparison is added to the existing exported arithmetic smoke without
changing its ABI. Reference patch 0024 and alias patch 0022 reverse checks
still pass. Build provenance requires isolated output and patch 0027 evidence;
candidate selection additionally requires a successful 1,536-case verification
record before serving such a binary. This does not prove independent hardware
equivalence or every possible operand/control combination.

Configuration succeeded. Build session 60739 is pending; output `work/double-dash-paired-status-core`, logs
`/tmp/controlla-paired-status-{configure,build}.log`. Runtime assertions and
browser behavior remain unverified; earlier candidate cores are preserved.

### Paired status comparisons passed

Native build session 60739 completed successfully. Exact WASM:
`4630560cfc830e2e2133fe6468dfef5645dac49edc8d25a15e3b4bd767699538`.
Arithmetic verification passed the existing 3,744 differential cases and new
1,536 Rc/status/exception cases, with profiling off/on/off. The verification
manifest records the exact WASM hash, patch 0026 hash and case counts. Native
controller ABI checks subsequently accepted connection/disconnection on all
four ports and rejected invalid ports. Production candidate selection admits
this verified output. Log: `/tmp/controlla-paired-status-check.log`.

These results qualify comparisons against the unchanged interpreter, not
independent hardware behavior or an exhaustive set of operands, MSR/FPSCR
combinations or FPU-unavailable scenarios. Both FE bits are either disabled or
enabled together. Browser behavior/performance of this exact new binary has
not been tested; the earlier finite-path 215574b1 core remains preserved with
its browser sample. Full-speed fidelity, complete races, matched-state speed,
audio quality, and physical motion/multiplayer remain open.

### Explicit cross-core checkpoint restore and status-core browser sample

Diagnostic `checkpointfiles=1&checkpointsource=<64-character WASM hash>` now
provides an explicit same-game restore from the same origin's saved record.
It delegates compatibility to the native loader and never writes progress.
Six progress tests pass, including invalid source/game and native rejection.
The normal room interface does not expose these diagnostic controls.

Baseline e65f32b6 and status-core 4630560c both restored the e65 checkpoint
saved at 2026-10-05 18:17:04 local time. Native loadedCheckpointGeneration was
1 for both. Reported restored ticks were 137437180845 and 137437179978,
respectively: a difference of 867 ticks (about 1.8 microseconds). Thus this
establishes cross-core loading, not deterministic replay equivalence.

Status-core 4630560c subsequently presented 930 frames over 43.863715 seconds,
21.202 FPS, with no captured browser console errors. Evidence is local ignored
`work/double-dash-status-comparison-{a,b}.json` and `.png`; baseline restore
report is `work/double-dash-comparison-baseline-restored.json`. The prior
baseline restore has no corresponding sustained interval, so this sample
cannot establish a speed improvement. A matched scene interval comparison is
still required. The native-verified status core now also has browser boot and
checkpoint-load evidence, but full-speed gameplay remains unqualified.

### Status-core simulation throughput and CPU profile

The recorded status comparison interval advanced 15.501644529 seconds of
native time in 43.863715 seconds wall time: 35.3405% of real time. Native
frame count advanced 925 versus 930 presented frames; telemetry snapshots
are asynchronous. WebGPU drain work increased 8526.23 ms during this interval
(19.4% of wall time, overlapping the native worker). Presentation reported
zero dropped frames, zero queue depth and zero frame lag. These observations
point toward slow frame production rather than a presentation queue bottleneck;
they do not isolate CPU, native video production or GPU costs completely.

A fresh status-core run with `ppcprof=1` loaded successfully after releasing
the previous paused engine and restored the same saved record. Its report
`work/double-dash-status-cpu-profile.json` now contains nonzero sampled block
execution timing: 113671936 ns across 7545 unique blocks, sample rate 1024.
Hot displayed PCs include 800f6c68, 800f6f0c, 800f6eb4 and 800f6c78. Entries
label the first opcode of a block, not the cost of that individual instruction.
The profile includes startup before restoration; it is not a post-restore-only
cost attribution or a profiling-off speed measurement. Saved screenshot:
`work/double-dash-status-cpu-profile.png`. The profiled scene is paused for
further inspection; optimizing these blocks requires inspecting their entire
instruction sequences and compilation paths before changing semantics.

### Inspecting the sampled integer blocks

Read-only extraction of the local GM4E01 DOL mapped four sampled PCs back to
instruction sequences, stopping at their first branch. Local ignored evidence:
`work/double-dash-hot-block-opcodes.json` (game instructions stay local).
800f6c68 contains addi/cmpwi/rlwnm/conditional branch; 800f6f0c contains
cntlzw/subfic/cmp/conditional branch; 800f6eb4 contains andi./srawi/conditional
branch; 800f6c78 contains two lbzx, cmpwi and a conditional branch. Their costs
cannot therefore be attributed to paired FP from the first opcode label.

The emitter implements these rotations/shifts directly, including i32.clz for
cntlzw. Its minimum prefix is four instructions by default. The existing
`shortprefix=1` diagnostic policy lowers it to two without changing instruction
semantics. The three-instruction 800f6eb4 sequence is a concrete candidate for
avoiding interpretation under that policy; actual analyst block boundaries,
compilation acceptance, performance and fidelity still require browser evidence.
Next experiment: restore the same checkpoint with profiling disabled and
shortprefix=1, inspect rejection/compile counters and measure native throughput.
No compiler policy or production default has been changed on this evidence.

### Short-prefix policy browser experiment

Using the exact status-core binary, profiling disabled and `shortprefix=1`,
the saved e65 checkpoint restored successfully (generation 1). Initial
helper telemetry reported 19277 compiled blocks and 1608 short rejections,
versus 10464/7896 in the earlier default-threshold sample. Thus the policy
materially changes compilation acceptance, but these counters cover different
runtime windows and are not a controlled count comparison.

The short-prefix sample presented 722 frames over 39.964270 seconds: 18.0661
FPS. Native time advanced 12.045590683 seconds, 30.1409% of wall time. No
captured browser console errors occurred. Local ignored evidence:
`work/double-dash-short-prefix-{a,b}.json` and `.png`. The sampled native scene
window was 3.7368–15.7824 seconds after restoration, versus 5.3552–20.8569 for
the earlier default sample (21.202 FPS, 35.3405% speed). These nonmatching
windows preclude attributing a regression to the threshold. More accepted
blocks did not establish a speed benefit. Keep the production default at four;
future comparisons should bound the same native scene interval and repeat
both policies before promotion. The experimental scene is paused, and its
saved source record remains unchanged.

### Browser-verified post-restore CPU profile reset

Server with checkpoint 63f5c44 served the exact status-core 4630560c. A fresh
profile-enabled browser booted, restored the saved e65 record, and reported
`CPU profile restarted` after the diagnostic reset request. Native evidence
also confirms reset: before reset, 100283766 blocks/97933 samples; afterward,
417749 blocks/407 samples. A later refreshed report contained 302059282
blocks/294979 samples and a 97868-sample window. Thus the result is not merely
a UI acknowledgement or startup telemetry cached before the reset.

Local ignored reports are `work/double-dash-profile-{before,after}-reset.json`
and `work/double-dash-scene-cpu-profile.json`; paused screenshot is
`work/double-dash-scene-cpu-profile.png`. This fresh window's displayed leaders
include 800bf6e4 (one 1.43 ms outlier), 800a9774, 8005b5fc and 800a9740.
The earlier startup/decompression-style 800f6c/800f6f blocks are not prominent
in this window. That weakens using those blocks to justify production short
prefix tuning. Scene timing, not startup-inclusive profile, must guide the
next optimization. Paired add/sub remains the most frequent recorded FP
helper keys (counts describe frequency, not execution cost). Reset does not
change instruction semantics, saved progress or production compilation policy.

### Fresh one-player Grand Prix and acceleration verified

A fresh status-core 4630560c browser session (ppcprof=0, probeinputs=1) used
bounded native input probes to leave the attract demo, create local game save
data, and enter Start Game -> 1 Player -> Grand Prix -> 50cc. Mario and Luigi,
the default red kart, and Mushroom Cup were selected with separate confirmed
inputs. Luigi Circuit loaded into actual player gameplay: lap 1/3, eighth
place, player marker and 0 mph were visible before acceleration.

A 300-frame held acceleration probe registered native buttons:100, then
released at frame 12650. The kart moved from the start line to grass beside
the course. The post-release screenshot shows 0 mph, so it is not a captured
peak-speed measurement. No captured console errors occurred. Local ignored
evidence: `work/double-dash-luigi-circuit-acceleration.{json,png}`. This tests
an actual selected race and native input delivery, not physical phone motion,
complete laps, items, steering, drift, brake or full-speed fidelity.

The race was paused and Save progress succeeded at 2026-10-05 18:58:43 local,
under GM4E01 and the status-core 4630560c hash on origin 127.0.0.1:8082. The
earlier e65 attract checkpoint remains separate. Local paused evidence:
`work/double-dash-luigi-circuit-checkpoint.{json,png}`. Browser tab 31 is
preserved for controlled driving checks and this new gameplay checkpoint can
support more relevant performance comparisons after verifying restoration.

### Live race restore, left steering and rider swap

The 18:58:43 status-core race checkpoint restored successfully. While paused,
the frame telemetry still reported load generation 0; after resuming, fresh
telemetry reported generation 1, confirming native restoration. A 90-frame
left-steering plus acceleration probe registered native stick 64,128 and
buttons:100, released at frame 14872, and turned the kart from the grass onto
the road. A separate 30-frame rider-swap probe registered buttons:10 and
visibly changed the rear rider from Luigi to Mario. No captured console
errors occurred. Local ignored evidence:
`work/double-dash-luigi-steer-left.{json,png}` and
`work/double-dash-luigi-swap.{json,png}`. The browser is paused for continuation;
the original saved race record was not overwritten. These checks cover native
stick steering and rider swap in one race; physical phone tilt, drift, items,
complete laps and full-speed fidelity remain unqualified.

### Live drift and release verified

On the same status-core Luigi Circuit race, a 300-frame right-drift plus gas
probe produced native buttons:120 and stick 192,128. The held-input screenshot
shows 39 mph, an angled kart and yellow tire sparks, establishing visible
in-game drift response. The probe released at frame 16960; later native
telemetry reports buttons:0, stick 128,128 and input:0. No captured console
errors occurred. Local ignored evidence:
`work/double-dash-luigi-drift-held.{json,png}` and
`work/double-dash-luigi-drift-released.json`. This verifies one drift maneuver
and neutral release, not mini-turbo timing, full races, physical phone motion
or full-speed fidelity. The session is paused and its original saved race
checkpoint remains untouched.

### RAM bounds-check hoisting live-race sample

An opt-in `fastmemhoist=1` fresh status-core browser restored the saved Luigi
Circuit race (native load generation 1). Grouped RAM check codegen counters
were nonzero: groups 5493, fast 13966, slow 2880 at sample start. These are
emission counters, not dynamic runtime execution counts, despite their name.
The idle-player race interval presented 1275 frames over 44.197065 seconds:
28.8481 FPS, native time advancing at 48.1337% of wall time. No captured console
errors occurred. Local ignored evidence is
`work/double-dash-hoist-race-{a,b}.json` and `.png`. No matching default-policy
idle race interval has yet been measured; this cannot establish an improvement.
The policy remains diagnostic-only, with grouped memory safety/differential
qualification and repeated matched race comparisons required before promotion.
The race is paused, and the saved gameplay record remains untouched.

### Default-policy race baseline versus bounds-check hoisting

A fresh default-policy status-core session restored the identical 18:58:43
Luigi Circuit checkpoint, native generation 1. Its hoisting emission counters
were zero. With the player idle, 1388 frames were presented over 45.764620
seconds: 30.3291 FPS and native throughput 50.5665% of real time. No captured
console errors occurred. Local ignored evidence:
`work/double-dash-default-race-{a,b}.json` and `.png`.

The default scene interval was 7.0714–30.2130 seconds after restoration; the
hoisting run was 6.5884–27.8621, at 28.8481 FPS and 48.1337% speed. Both use
the same saved state and exact binary, but scene boundaries differ and there
is only one sample per policy. Therefore this does not prove a regression.
It provides no evidence for promoting fastmemhoist; default-off is retained.
Both policies remain substantially below full speed. Future optimization
should target other measured costs rather than assume grouped bounds checks
improve this scene. The baseline game is paused; saved progress is unchanged.

### FP boundary and race interval cost inspection

Source inspection confirms generated blocks import the native FP helper via
`fp: wasmTable.get(fp_index)` when instantiating their WASM module. They do
not install a per-call JavaScript wrapper, so JavaScript bridge removal is
not an optimization target for these helper calls.

The default idle race interval recorded about 2,994,173 FP helper calls per
wall second. JIT module compilation increased only 1208 microseconds and
instantiation 46339 microseconds across 45.764620 seconds; therefore cold JIT
construction does not explain this interval's roughly half-speed emulation.
WebGPU drain work increased 9978.275 ms (overlapping native work; not an
exclusive CPU budget). Hoisting sample FP calls were about 2,893,184/sec,
with compilation 316401 us and instantiation 30067 us. Frequency alone does
not prove helper arithmetic is the bottleneck; native helper-specific sampled
timing is the next evidence needed before rewriting reference arithmetic.
The existing sampled block profile labels whole blocks by their first opcode
and cannot assign a helper cost from those labels.

### Native FP helper sampled timing candidate

Patch 0028 adds an RAII wall-time sampler around the native FP helper. Only
when existing CPU profiling is enabled, every 1024th aggregate FP call reads
the monotonic clock. Every helper return path is included. Atomic cumulative
sample count, total nanoseconds and maximum duration are reported as
`fptiming:v=1,rate=1024,samples=...,totalns=...,maxns=...`. Arithmetic and FPU /
exception behavior are unchanged. Counts are cumulative for the core lifetime;
profile reset does not reset these counters, so scene cost requires deltas.
Periodic sampling may alias instruction patterns, clock overhead is included,
and wall time can include scheduling; this is not an exact CPU cost oracle.

Build guards require isolated output and exact patch evidence; candidate
selection checks the timing patch hash. Existing patch 0026 reverse-check
still passes; two runtime-selection tests and build script syntax passed.
Configuration completed for `work/double-dash-fp-timing-core`. Native build
session 59962 is pending, log `/tmp/controlla-fp-timing-build.log`. The previous
status core and paused baseline browser remain preserved. Build success,
arithmetic/status assertions, controller ABI and browser timing are unverified
for this candidate. Do not promote it until those checks complete.

### FP timing candidate built and native checks passed

Build session 59962 completed successfully. Exact WASM hash:
`2bf63d4d41af0dac55be5ac5bb7a476f081054d24ccc609e30e74ef94d8e2ff6`.
Arithmetic checks passed 3744 differential cases and 1536 status/exception
cases with profiling off/on/off; controller ABI accepted all four ports and
rejected invalid ports. Logs: `/tmp/controlla-fp-timing-{arithmetic,abi}.log`.
A separate profiling-enabled native smoke returned 1 and reported five FP
timing samples, 50688 total ns and 13056 maximum ns. This establishes sampler
activation, not representative game cost; browser scene sampling is pending.

Runtime-selection coverage now rejects absent and tampered patch-0028 hashes
and accepts the matching record. The arithmetic verifier also checks that
hash before running the binary. Both runtime-selection tests pass. Browser
boot/restore and matched scene timing remain required; no production runtime
or compilation policy was changed. The prior status-core baseline is paused.

### Sampled FP timing: live race qualification

The isolated `2bf63d4d` timing core restored the saved `4630560c` Luigi
Circuit race through the comparison loader; both interval reports show native
checkpoint generation 1. After restarting the CPU profile, a 52.116685-second
interval presented 1317 frames (25.2702 FPS), advancing at 42.1593% of native
speed. No browser console errors were reported. Evidence is saved locally in
`work/double-dash-fp-timing-race-{a,b}.json` and the corresponding PNG; the
race was paused afterward without replacing the source saved checkpoint.

The cumulative timing counters increased by 128300 samples and 52406272 ns,
averaging 408.47 ns per sampled helper. Multiplying by the sampling rate of
1024 estimates 53.664 seconds, or 102.97% of elapsed wall time. This is not a
credible exclusive CPU attribution: periodic sampling bias, timer overhead,
clock resolution and scheduling interruptions are not isolated. In particular,
the extrapolation exceeding wall time invalidates treating it as a measured
fraction of a single worker's execution budget. The profiling-enabled FPS is
not directly comparable to the earlier profiling-disabled 30.33 FPS interval.
Next qualification should measure this same core with profiling disabled and
then calibrate sampling overhead/bias before using these timings to justify
an arithmetic optimization. No candidate promotion follows from this sample.

### Timing core with profiling disabled

The same `2bf63d4d` binary, default compilation policy and saved `4630560c`
Luigi Circuit checkpoint were tested with `ppcprof` omitted. Native checkpoint
generation was 1 at both ends. In 47.898710 seconds it presented 1637 frames:
34.1763 FPS and 57.0158% native simulation speed. FP timing samples, total ns
and maximum ns stayed zero at both ends, verifying that the opt-in sampler
does not read its clock while disabled. No browser console errors were seen.
Local evidence: `work/double-dash-fp-timing-off-race-{a,b}.json` and PNG.
The race is paused; the original saved checkpoint remains unchanged.

The preceding profiling-enabled sample was 25.2702 FPS (42.1593% speed).
These sequential, single intervals suggest material profiling overhead, but
do not isolate the new sampler from existing block profiling and FP opcode
attribution, or control host load and exact native time windows. Neither this
comparison nor the earlier 30.33 FPS status-core sample establishes a speed
improvement from the timing patch. Full-speed gameplay remains unqualified.
Performance decisions should use profiling-disabled measurements; sampled
helper timing needs overhead calibration before exclusive-cost attribution.

### State cache on the arithmetic-correct timing core

With the same `2bf63d4d` binary, profiling disabled, the same saved Luigi
Circuit checkpoint and `wgpustatecache=1`, the producer cache was active
and the consumer cache remained disabled. A 41.847205-second interval
presented 1423 frames (34.0047 FPS), at 56.7651% native speed. No console
errors were reported; local evidence is
`work/double-dash-timing-state-cache-race-{a,b}.json` and PNG. The race is
paused without updating the saved checkpoint.

The producer suppressed an additional 757/366597/551453 bind-group records
for groups 0/1/2, plus 551453 vertex-buffer and 551453 index-buffer records.
Pipeline suppression remained zero. Thus the optimization actually removed
repeated commands, rather than merely setting a request flag. Renderer drain
time increased by 8985.205 ms during the interval (overlapping native work,
not an exclusive CPU budget). The preceding cache-off sample was 34.1763 FPS.
These single sequential windows show no material throughput benefit here;
do not enable this option in the shared game stage based on this result.
Visual equivalence across tracks and scene transitions is still unqualified.
Further performance work should target costs beyond repeated GPU state
commands; this cache does not close the remaining native-speed gap.

### Single-thread execution comparison

The `2bf63d4d` core with `cpu=single`, WebGPU, profiling off and state cache
off restored the same Luigi Circuit checkpoint (generation 1 at both ends).
It presented 1340 frames in 44.067285 seconds: 30.4080 FPS and 50.7316%
native speed. No browser errors were reported. Local evidence:
`work/double-dash-timing-single-race-{a,b}.json` and PNG. The race is paused
and the source checkpoint is unchanged. The preceding split-mode cache-off
sample was 34.1763 FPS; this single interval supports retaining `cpu=dual`,
not switching the shared game stage to single-thread execution.

`node scripts/mario-kart/analyze-race.mjs <start.json> <end.json>` now computes
frame throughput and native speed from saved reports. It rejects nonincreasing
time/frame/tick counters, changed or missing restored checkpoint identity,
clock-rate changes and changed cache flags. It reports optional sampled FP
timing with explicit warnings for extrapolation beyond wall time. This does
not prove identical scene windows, build identity, hardware pixel fidelity or
exclusive CPU cost. Verified with the real single-mode and FP-profile report
pairs; a reversed pair must fail instead of producing a negative benchmark.

### Inline normal-number FPRF experiment (pending)

Patch `0029-inline-normal-fprf.patch` adds the reference classifier's exact
normal-single exponent/sign case directly to `PowerPCState::UpdateFPRFSingle`.
Zero, subnormal, infinity and NaN results still use `Common::ClassifyFloat`.
It changes no arithmetic, FPSCR rounding, NI handling or exception dispatch.
The intent is to remove one separate classifier call on common results;
compiler inlining and real gameplay benefit are not yet established.

The builder requires isolated output and an exact reverse patch check, and
records PowerPC source and patch hashes. Candidate selection and the native
arithmetic runner reject mismatched patch provenance. Runtime-selection tests
pass with missing/tampered hash coverage. Configuration session 29061 passed;
build session 25794 compiled PowerPC.cpp and is linking the isolated
`work/double-dash-normal-fprf-core` output. Log:
`/tmp/controlla-normal-fprf-build.log`. Native 3744 arithmetic and 1536
status/exception comparisons, four-port ABI and browser validation remain
required. Existing binaries and shared-stage defaults are preserved.

### Inline FPRF candidate qualification

Build 25794 completed successfully. Exact WASM:
`0b6b80d30684e4a5ce4cf7487cff1dafcd8c7c0dd71d3b02a43b625c18911065`.
Native checks passed 3744 arithmetic and 1536 Rc/status/exception comparisons
with profiling disabled and enabled; all four controller ports passed, and
invalid ports were rejected. Logs: `/tmp/controlla-normal-fprf-{arithmetic,abi}.log`.

Because native reference arithmetic also uses `UpdateFPRFSingle`, those tests
alone cannot independently qualify its changed classification implementation.
`node scripts/mario-kart/check-fprf-classifier.mjs` extracts the actual patched
method into a host C++ wrapper and compares it against the original compiled
`Common::ClassifyFloat`. It passed 1052672 patterns: every exponent/sign class
with eight mantissa boundary patterns, plus 1048576 deterministic additional
patterns. The wrapper uses the same five-bit FPRF field. This is a host
classification check, not exhaustive float coverage or a WASM substitute.
PowerPC source SHA256: `29d3e3a33b35afcca610b0f1f3e574a159c5dcfe845c6ccc46397bb67f3e1fac`;
reference source: `e7bcd6a48701a361a84a9c0dfbf2ddb0c5c5219a1370838c05f99a5e8dff9dbb`.

The candidate booted and restored the saved `4630560c` Luigi Circuit race.
Checkpoint generation remained 1. Profiling and GPU caches were disabled.
In 43.965290 seconds it presented 1507 frames: 34.2770 FPS and 57.2159%
native speed. FP timing counters stayed zero; no browser errors were reported.
Evidence: `work/double-dash-normal-fprf-race-{a,b}.json` and PNG. The race is
paused, original saved checkpoint untouched, server session 90140 on 8082.
The preceding timing-core sample was 34.1763 FPS, so this single comparison
does not establish a meaningful throughput improvement. Keep the candidate
isolated; shared-stage defaults remain unchanged and full-speed play unfinished.

### Guarded generated-WASM paired add/sub experiment (pending)

Patch `0030-guarded-inline-paired-add-sub.patch` adds a generated-WASM path
for non-Rc paired add/sub. It requires MSR.FP, RN/NI zero, no pending program
or DSI exception and four finite operands. Both lane results are computed and
rounded to single precision before any destination write. Only two normal
single results use the inline stores and lane-zero FPRF update; all other
cases call the existing reference helper. Rc instructions retain their existing
dispatch. This targets helper boundaries rather than changing arithmetic.
Generated locals 4/5 hold the result bits; lane-zero sign is retained in local
7 through the classification check. No new WASM imports or exports are added.
Helper-call/opcode counts will exclude successful inline operations and must
not be interpreted as total FP instruction counts for this candidate.

Builder guards require isolated output and exact reverse patch verification;
candidate selection and arithmetic verification check the new patch hash.
Patch 0021 still reverse-checks after the new emitter is added, preserving
reference fallback evidence. Runtime-selection tests pass, including missing
and tampered patch-0030 records. Configure session 67801 passed; native build
55070 is running for `work/double-dash-inline-paired-core`, with log
`/tmp/controlla-inline-paired-build.log`. Arithmetic/status and four-port ABI
checks plus browser race performance remain pending. Existing binaries,
saved checkpoint and shared-stage defaults are preserved. The paused prior
candidate remains in browser tab 39, served by session 90140 on 8082.

### Inline-emitter native checks and exception-offset correction

Build 55070 finished, producing
`c9766596a28675085a0e2f3a0cc7e51b456040f4ebc080e8d02ebe1d2d05d317`.
It passed all 3744 native arithmetic comparisons and 1536 Rc/status/exception
comparisons with profiling off and on. Controller ABI checks passed all four
ports and rejected invalid ports. Logs:
`/tmp/controlla-inline-paired-{arithmetic,abi}.log`. No game has been booted
with this binary, and the assertions do not yet establish which normal cases
avoided the helper or cover every possible pending-exception state.

The compiler warned that `offsetof(PowerPCState, Exceptions)` used a
non-standard-layout type. Patch 0030 now derives the member offset from
the actual core state object during code generation, following the other
state-address calculations. The accessor does not execute per emulated FP
instruction. Configuration 21069 passed; corrected build 32099 is running
in `work/double-dash-inline-paired-offset-core`, log
`/tmp/controlla-inline-paired-offset-build.log`. Preserve the first binary as
native-check evidence, but its old patch hash no longer matches the current
candidate-selection policy. The corrected binary requires fresh native and
browser qualification before use. Provenance tests still pass. The shared
game runtime, saved checkpoint and paused browser baseline remain unchanged.

### Corrected inline-emitter race qualification

Build 32099 completed, exact WASM
`2a550eef6372619eeee5f8159601ebc374911efb08dbcd085313758f3166799b`.
Fresh native checks passed 3744 arithmetic and 1536 Rc/status/exception
comparisons with profiling off/on/off, plus four-port ABI and invalid-port
rejection. Logs: `/tmp/controlla-inline-paired-offset-{arithmetic,abi}.log`.
The invalid `offsetof` warning is gone. In separate cold native processes,
the same passing arithmetic smoke reported 5284 FP helper calls for the
prior `0b6b80d3` core, and 5269 for both inline-emitter binaries. Reports must
be read after the smoke first: reading before and after returned a cached
zero report because the smoke did not change its diagnostic cache key.
The fresh reports support limited inline activation, not gameplay coverage.

The corrected core booted and restored the saved Luigi Circuit checkpoint
(generation 1). Profiling and GPU caches were off. In 43.997485 seconds it
presented 1496 frames: 34.0019 FPS, at 56.7476% native speed. No browser
errors were reported; FP timing counters stayed zero. Evidence is local in
`work/double-dash-inline-paired-race-{a,b}.json` and PNG. The race is paused
in tab 40; server session 22725 uses 8082; source checkpoint unchanged.

FP helper calls were 3335490/s versus 3334876/s in the prior `0b6b80d3` race
sample, whose FPS was 34.2770. The sequential windows do not prove identical
scene progression, but show no material helper reduction or throughput gain.
Do not promote this candidate. Next investigate eligibility coverage, including
the restrictive RN/NI guard, before widening any arithmetic path. FPSCR
runtime values have not been measured here, so guard exclusion is a hypothesis.

### NI-safe inline eligibility experiment (pending)

Patch 0030 now permits NI while still requiring RN=nearest. Before either
destination write, it retains both rounded results and checks each unrounded
double magnitude against `0x3810000000000000`, the original `ForceSingle`
smallest-normal-single threshold. Both converted results must still be normal.
This conservatively falls back even with NI off when a raw result lies below
the threshold. With NI on, it specifically excludes raw subnormal results
that would round up to normal but which the reference conversion flushes.
Finite operands, MSR.FP, pending-exception and non-Rc requirements remain.
This is a reference-semantics extension, not evidence that NI excluded the
previous live race; its runtime FPSCR state has not been measured.

An independent host C++ check extracted the original `ForceSingle` function
and compared conversion across both signs and NI modes at 8192 adjacent
double encodings on each side of the normal threshold. It passed 32772
eligible reference comparisons, excluding 16384 NI-enabled raw-subnormal
cases whose ordinary cast rounded to normal. Temporary source/binary:
`/tmp/controlla-inline-ni-boundary{.cpp,}`. This checks the conversion guard
boundary, not generated-WASM integration or all arithmetic values.

Configuration 12788 and runtime-selection provenance tests passed. Build
63903 is running for `work/double-dash-inline-paired-ni-core`, log
`/tmp/controlla-inline-paired-ni-build.log`. Fresh native arithmetic/status,
four-port ABI, inline activation and live-race performance checks remain
required. Prior binaries and source checkpoint are preserved; changing patch
0030 invalidates their current candidate-selection hash. Shared-stage defaults
are unchanged. The paused previous candidate remains in tab 40, server 22725.

### NI-safe inline candidate qualification

Build 63903 completed successfully. Exact WASM:
`54fb9bc9483f39054a210fb1c407455a3277cde5dd3253cdce301a5f9476a3fe`.
Native arithmetic checks passed 3744 comparisons and 1536 Rc/status/exception
comparisons with profiling off/on/off; all four controller ports and invalid
port rejection passed. Logs: `/tmp/controlla-inline-paired-ni-{arithmetic,abi}.log`.
The verifier now reads FP helper statistics once after the first cold smoke,
avoiding the cached pre-smoke report, and records `firstSmokeFpHelperCalls`
in the exact-binary verification record. This candidate used 5254 calls,
versus 5269 for the prior inline path and 5284 for the pre-inline core. This
establishes increased smoke coverage, not exhaustive guard coverage.

The candidate booted/restored Luigi Circuit (checkpoint generation 1) with
profiling and GPU caches off. It presented 1494 frames in 43.950945 seconds:
33.9924 FPS, 56.7102% native speed. FP timing counters stayed zero; browser
errors were absent. Evidence:
`work/double-dash-inline-paired-ni-race-{a,b}.json` and PNG. Race paused in
tab 41, server 47938 on 8082; original saved checkpoint unchanged.

FP helpers ran at 3252404/wall-second versus the prior inline candidate's
3335490/wall-second. That modest reduction accompanies nearly unchanged
speed (prior 34.0019 FPS); it does not establish a useful throughput gain
from these single sequential windows. Most helper traffic remains. Keep
this candidate isolated and inspect eligibility exclusion before broadening
arithmetic further. Shared-stage defaults and the production runtime remain
unchanged; full-speed gameplay remains unfinished.

### Opt-in remaining-helper eligibility attribution (pending)

Patch `0031-paired-fp-eligibility-attribution.patch` wraps the existing FP
import with profiling-only paired add/sub counters. For remaining helper
calls it records FPSCR low three bits (RN/NI), Rc, and whether both source
second lanes are signed or unsigned zero. It forwards the exact original
arguments and return value; it does not evaluate or change arithmetic.
Counters use relaxed atomics, are cumulative across profile resets, and are
reported as `fpelig:v=1,scope=remaining-helper-calls;mode=...,rc=...,zero1=...,calls=...`.
Mode bits 0/1 are RN, bit 2 NI. This is not a complete FP instruction profile:
successful generated inline operations do not enter the helper. Individual
counter reads do not form a coherent cross-worker snapshot. Use interval
deltas and do not use profiling-enabled FPS to qualify runtime performance.

Both native FP table pointers now use the wrapper; its address-taking retains
the callable function without adding a public core API. All earlier patch
reverse checks are still required by the builder, along with the new isolated
output/hash guard. Candidate selection and arithmetic verification check patch
0031 provenance. Runtime-selection tests pass with missing/tampered evidence
coverage. Configure 92937 passed; build 23153 is running for
`work/double-dash-fp-eligibility-core`, log `/tmp/controlla-fp-eligibility-build.log`.
Native arithmetic/status, controller ABI, counter activation and live race
attribution remain pending. Previous qualified NI binary, saved checkpoint
and shared-stage defaults are preserved. Paused baseline: tab 41, server 47938.

### Remaining-helper eligibility measured in Luigi Circuit

Build 23153 completed; exact WASM
`ca9fcafb9944afb3f579e7561a5faf1c536add66c479c8fd647e31ddb07ec20c`.
Native arithmetic/status checks passed 3744/1536 comparisons with profiling
off/on/off; four ports and invalid-port rejection passed. Logs:
`/tmp/controlla-fp-eligibility-{arithmetic,abi}.log`. Cold smoke helper count
remained 5254, matching the underlying NI-safe arithmetic candidate.

The core booted/restored the saved race (generation 1), with profiling on.
An authoritative 135.746740-second report interval presented 3114 frames
(22.9398 FPS, 38.2710% native speed); this instrumentation-heavy result is
not a performance qualification. No browser errors were reported. Evidence:
`work/double-dash-fp-eligibility-race-{a,b}.json` and PNG. Race paused in
tab 42; server 23697 on 8082; source checkpoint untouched.

Remaining paired add/sub helper deltas were 8398123 calls. Every measured
call had RN=0, NI=1 and Rc=0. Both second operands were zero in 360925 calls
(4.2977%); 8037198 calls (95.7023%) had other second-lane operands. This
rules out non-nearest rounding and Rc as observed exclusions for this window;
it does not identify other output/operand guard failures. Import FP count
increased by 314412293, so paired add/sub was only about 2.67% of remaining
FP helper traffic. Broader zero-lane handling alone cannot remove most helper
traffic. End-report leading keys decode to scalar paired multiply/add forms:
SUBOP10 values 12/76/140 map to SUBOP5=12, 110/46 to 14, and 79/143/15 to 15.
The report prints only leading cumulative keys, not complete per-operation
interval deltas or cost. Next inspect those scalar forms before optimizing
more add/sub edge cases; the original leading add/sub counts included startup.

The race analyzer now reports eligibility deltas and sorted mode/Rc/zero-lane
fractions, rejecting reset counters and changed reporting. Real new reports
pass, older NI reports still yield null eligibility, and a copy with eligibility
counters reset to zero rejects as expected. FP timing extrapolation still
exceeds wall time; it remains unsuitable for exclusive cost attribution.
Shared-stage defaults remain unchanged and full-speed gameplay unfinished.

### Direct scalar paired reference dispatch experiment (pending)

Patch 0031 now also routes scalar paired forms 12/13/14/15 through a direct
state-based handler before the general FP helper. This handler uses the same
`Force25Bit`/`NI_mul` for scalar multiply, and `NI_madd<true>` for scalar fused
multiply/add as `Interpreter_Paired.cpp`. It retains `ForceSingle`, FPRF,
Rc/CR1, FPU availability and program/DSI checks. Both results are computed
before `SetBoth`, preserving destination aliases. The scalar value is captured
before either lane, matching reference evaluation. Reference source files and
arithmetic utilities are unchanged. No multiply-plus-add approximation is used.

The intended savings are the general helper's interpreter lookup, opcode
dispatch and separate interpreter-handler call. This is still a WASM helper
call, not generated inline scalar arithmetic; performance benefit is unknown.
FP aggregate/opcode counts and sampled timing are retained. The eligibility
counters still cover only remaining paired add/sub helper calls. The combined
patch runs scalar dispatch with profiling off and on, while eligibility counters
remain opt-in. Earlier diagnostic-only binaries retain their historical patch
hashes and are no longer selected under the updated patch-0031 hash.

Builder manifests now identify `directScalarPaired` and require combined
patch-0031 evidence; runtime selection and arithmetic verification reject
that flag without patch evidence. Provenance tests pass. Configure 93898
passed; build 65075 is running for `work/double-dash-direct-scalar-paired-core`,
log `/tmp/controlla-direct-scalar-paired-build.log`. Native arithmetic/status,
controller ABI and browser race validation remain required; scalar Rc/exception
coverage must not be inferred from the add/sub-only status matrix. Previous
binaries and shared-stage defaults are preserved. Paused baseline: tab 42,
server 23697 on 8082; source saved checkpoint untouched.


### Scalar paired status qualification checkpoint

The isolated `work/double-dash-direct-scalar-paired-core` build completed and
passed 3,744 paired differential comparisons, the existing 1,536 add/sub
status comparisons, and connection/disconnection checks on all four native
controller ports. Its cold arithmetic smoke retained 5,254 FP helper calls;
this is test coverage evidence, not a gameplay speed measurement. No race
performance claim is established for the scalar candidate.

Patch 0027 now also exercises scalar paired multiply and multiply/add
suboperations 12–15 through both the direct candidate helper and generated
WASM, using the interpreter as reference. Its 3,072 combinations include
destination aliases for all three source registers, Rc, eight FPSCR seeds,
eight special-value rotations and enabled/disabled FP exception delivery.
It compares both result lanes, FPSCR, all CR fields, exceptions, next PC and
halt outcome. The build manifest and candidate selector require matching
scalar status evidence when this matrix is present. Runtime-selection tests
pass, including missing and incomplete scalar case counts.

A fresh isolated build at `work/double-dash-scalar-status-core` is linking.
The expanded native matrix and browser race qualification remain pending.
The ordinary room candidate command remains on the earlier qualified
paired-differential core; this experiment has not been promoted.


### Expanded scalar matrix and first browser interval

The scalar-status build completed successfully. Exact WASM SHA-256:
`ee5bf95f0b84390cd81b126077dc290834f5d76828f47b2f515f883e07130527`;
loader SHA-256:
`35c1ee78cdcc9db33c496716450e7179a0b9de09c7c26d55718d78cc9ba2fe2c`.
The actual native module passed all 3,072 scalar direct-helper/generated
status comparisons, 3,744 paired differential comparisons and 1,536
add/sub status comparisons with profiling off and on. Four controller
ports accept connection/disconnection and reject invalid ports. The cold
smoke now has 11,398 FP helper calls because it executes the added matrix;
it must not be compared to the earlier smaller smoke as a speed metric.

Browser tab 43 loaded the local GM4E01 CISO and restored the unchanged
18:58:43 Luigi Circuit checkpoint on localhost:8082. Native telemetry
confirmed checkpoint generation 1. Profiling was disabled, timing samples
and eligibility deltas were zero, and renderer caches were off. The
41.964775-second interval presented 986 frames: 23.495896 FPS and
39.194643% native speed. No browser errors were observed. This single
interval is slower than earlier ~34 FPS candidates, but host load and exact
scene progression are not controlled; it establishes neither a reliable
regression nor an improvement. The direct scalar experiment is not promoted.

Ignored local evidence: `work/double-dash-direct-scalar-race-a.json`,
`work/double-dash-direct-scalar-race-b.json` and
`work/double-dash-direct-scalar-race.png`. Tab 43 remains paused and server
94579 serves this verified binary on 8082. Full-speed racing, original
visual/audio fidelity and physical phone motion qualification remain open.


### Scalar candidate repeat interval

A second checkpoint restore completed, but the immediate telemetry capture
retained the previous generation. The race analyzer rejected that interval
(`loadedCheckpointGeneration` mismatch); those reports are not performance
evidence. After allowing telemetry to refresh, a new interval on generation
2 measured 1,134 presented frames in 45.696895 seconds: 24.815690 FPS and
41.369640% native speed. Profiling and all renderer cache flags remained
off, with zero FP timing samples. Evidence is preserved locally as
`work/double-dash-direct-scalar-repeat2-{a,b}.json` and
`work/double-dash-direct-scalar-repeat2.png`. The same browser remains paused.

Both valid scalar intervals are around 24 FPS. This does not isolate scalar
dispatch from wrapper/diagnostic code or host load, and no optimization
benefit is established. A same-source control with scalar dispatch disabled
is the next performance experiment; preserve all other diagnostics, test
coverage and runtime options to narrow the cause. Full-speed goal remains
incomplete and no room-default promotion was made.


### Matched scalar dispatch control

Patch 0031 now retains the direct scalar helper but gates its dispatch with
`DOLPHIN_WEB_DIRECT_SCALAR_PAIRED` (default 1). macOS configuration accepts
only 0 or 1 and writes the definition into compiler flags. The builder
requires this explicit definition and records `directScalarPairedDispatch`
from the actual CMake cache, separately from helper presence. Both control
and enabled builds keep the same scalar helper and status test matrix.
No arithmetic simplification is introduced. Runtime-selection tests and
JavaScript syntax checks pass.

A disabled control was configured successfully at
`work/double-dash-scalar-control-core`; native build session 85005 is active.
Its arithmetic/ABI and race checks remain pending. Changing compiler flags
requires recompilation; do not restart this build merely because output is
quiet. Existing scalar binary and paused browser tab 43/server 94579 remain
intact. Historical patch-0031 binary manifests preserve their old hashes,
so they cannot be newly selected as current-source candidates after this
patch change without their original checkpoint provenance.


### Build resource observation

Control build 85005 remains live, progressing through the full 1,347-step
recompilation. During the build, process inspection showed the owned
browser renderer PID 48851 consuming about 170% CPU despite the game tab
being paused. Tab 43 was closed after its checkpoint and reports were
preserved; a subsequent process check confirmed that renderer PID exited.
This does not establish which worker consumed the CPU or a game-speed
improvement. It does establish that a paused test tab was still consuming
resources, so close test tabs between builds/comparisons rather than
assuming pause removes host load. Other applications were left untouched.
Server 94579 still serves the earlier scalar binary on 8082; the saved
IndexedDB checkpoint can be reopened after control qualification.


### Scalar-disabled control qualification

Build 85005 completed successfully. Control WASM SHA-256:
`98534e41aecd88d03da712316d1cfec65edbb68995fa80533c14652e464f8e95`;
loader SHA-256:
`35c1ee78cdcc9db33c496716450e7179a0b9de09c7c26d55718d78cc9ba2fe2c`.
The actual build manifest records `directScalarPairedDispatch: false`.
Native checks passed all 3,744 differential, 3,072 scalar direct/generated
status and 1,536 add/sub status cases, profiling off and on, plus four-port
connection/disconnection and invalid-port rejection. Cold smoke helper
count remains 11,398 because the test matrix directly calls the candidate
even when gameplay dispatch is disabled.

Server 97270 on localhost:8082 served this verified control. Browser tab 44
booted local GM4E01, restored the original 18:58:43 race checkpoint and
reported generation 1. Profiling and renderer caches were off, with zero
FP timing samples and zero eligibility deltas. The valid 43.833635-second
interval presented 1,167 frames: 26.623391 FPS and 44.442067% native speed.
No browser errors were observed. This exceeds the enabled experiment's
23.5/24.8 FPS observations, but one control interval with uncontrolled host
load and exact scene progression cannot isolate causality or explain the
remaining full-speed gap. Neither experiment is promoted.

Evidence: ignored `work/double-dash-scalar-control-race-{a,b}.json` and
`work/double-dash-scalar-control-race.png`. Tab 44 was closed after recording
evidence to release worker CPU usage. Saved checkpoint is unchanged.
Full-speed, visual/audio fidelity and physical motion qualification remain
open. Next optimization should isolate a narrower frequent scalar operation
and retain exact rounding/NI/reference fallback semantics.


### Guarded generated scalar multiply experiment

Patch 0032 adds generated-WASM `ps_muls0/ps_muls1` for non-Rc nearest
rounding, with FPU available, no pending program/DSI exception, finite A
lanes and a normal finite selected C lane. It implements normal-input
Force25Bit as exact i64 masks/add (including exponent carry), then f64
multiply and nearest conversion. Both raw results must reach the smallest
normal float threshold and both converted lanes must remain normal.
Otherwise it calls the reference helper before any architectural write.
Both lane results are retained before stores, preserving FA/FC destination
aliases. Success writes the original normal FPRF classification; Rc, other
rounding modes, subnormals, zeros and exceptional results use reference.
Multiply/add remains on reference, preserving fused behavior.

Builder and runtime selection require exact patch-0032 provenance and the
3,072-case scalar status matrix. Runtime-selection tests pass for missing
hash, changed patch and incomplete scalar case evidence. Initial test
exposed an unhelpful missing-file error for absent hash; the guard now
rejects missing evidence before reading the expected patch.

Isolated `work/double-dash-guarded-scalar-mul-core` configuration succeeded
with broad direct scalar dispatch disabled. Build 84749 is linking after
compiling the changed native source, with all prior patch checks passing.
Arithmetic, ABI and browser race qualification remain pending; no default
promotion. Control server 97270 is intact, with no owned browser test tab
left open.


### Generated scalar multiply native/browser qualification

Build 84749 completed. WASM SHA-256:
`45b852883331de295ef9ef7a8def1bc31166afe37298bfc9b470d7f7ade09ecd`;
loader SHA-256:
`35c1ee78cdcc9db33c496716450e7179a0b9de09c7c26d55718d78cc9ba2fe2c`.
Manifest confirms guarded scalar multiply enabled and broad scalar dispatch
disabled. Native checks pass 3,744 differential comparisons, 3,072 scalar
direct/generated status comparisons and 1,536 add/sub status comparisons
with profiling off/on, plus four-port controller ABI checks. Cold smoke
FP helper count is 11,384, 14 fewer than the control's 11,398; that only
proves some arithmetic smoke cases avoided helpers, not gameplay coverage.

Server 40387 served the verified candidate on localhost:8082. Tab 45
loaded local GM4E01 and restored the unchanged 18:58:43 race checkpoint.
Generation 1 was consistent, profiling/caches were off and timing samples
zero. The valid 47.997315-second interval presented 1,291 frames:
26.897338 FPS, 44.933026% native speed. Browser errors: none observed.
Control was 26.623391 FPS; this ~1% difference across single intervals with
uncontrolled host load/scene progression is not a clear speed benefit.
No default promotion. Broader Force25Bit tie/boundary coverage and full
gameplay/visual/audio/physical-motion qualification remain open.

Ignored evidence: `work/double-dash-guarded-scalar-mul-race-{a,b}.json`
and `work/double-dash-guarded-scalar-mul-race.png`. Tab 45 closed after
evidence capture to release workers. Checkpoint remains available.


### Exact-product scalar multiply/add feasibility

`node scripts/mario-kart/check-exact-scalar-madd.mjs` extracts the current
reference Force25Bit function and checks its normal-input bit rounding
against integer masks/add. It constructs two million deterministic vectors
with normal float A/B and normal double C, then compares separate double
multiply/add against `std::fma` with compiler contraction disabled.
Conservative guards require the product within normal float magnitude,
a raw sum at least the smallest normal float, a normal converted sum and
no single-precision even tie (mask 0x1fffffff / value 0x10000000).

1,212,043 eligible vectors matched bit-for-bit both in double and converted
float; 787,957 random vectors were rejected. An additional known reference
tie fixture (50.0, float 0xbc88cc38, float 0x1b1c72a0) was explicitly
rejected by the tie guard. The initial test incorrectly required random
ties despite their rarity; the known fixture now supplies required tie
coverage. This is host feasibility evidence, not native WASM qualification
or an exhaustive proof. It suggests a generated path may safely avoid the
software FMA for exact-product cases while retaining reference on ties,
extended A precision, exceptional inputs and subnormal/overflow products.

No generated multiply/add change has been made yet. Build and room
defaults are unchanged. Next work is to implement conservative guards,
compare the actual generated code to the interpreter including the known
tie and aliases, then measure the race.


### Guarded scalar multiply/add implementation checkpoint

Patch 0033 adds generated `ps_madds0/ps_madds1` for non-Rc nearest
rounding. It retains prior FPU/exception/NI guards and requires both A/B
lanes to have normal float magnitude and at most 24 significant bits.
Selected C must be normal finite and is rounded with exact Force25Bit
integer masks/add. Both products must remain within normal float magnitude,
so their at-most-50-bit significands are exact in f64. It then adds B and
rejects every single-precision even tie using the reference D_MASK and
EVEN_TIE constants. Both raw sums must be above the NI flush threshold and
both conversions normal. All other cases use the fused reference helper
before any architectural write. Both lanes are computed before stores.

Patch 0027 now uses 16 scalar value rotations, doubling scalar status
coverage to 6,144 cases. The known 50.0 / 0x1b1c72a0 / 0xbc88cc38 float
operand triplet appears in both lanes, covering fused tie fallback with
FA/FB/FC destination aliases, Rc, FPSCR seeds and exception modes. Existing
add/sub matrix stays at 1,536 cases. Current evidence guards require the
expanded scalar count and exact patch-0033 hash. Runtime-selection tests
pass for missing hash, changed patch and incomplete scalar coverage.

Isolated `work/double-dash-guarded-scalar-madd-core` configuration succeeded
with broad scalar helper dispatch disabled. Build 63974 is linking, with
all prior patch checks intact. Expanded native arithmetic, controller ABI
and race qualification remain pending. Previous binaries are preserved;
the current patch-0027 hash no longer matches their historical manifests.
Default room runtime remains unchanged. No speed benefit is claimed.


### Guarded multiply/add native and race qualification

Build 63974 completed. WASM SHA-256:
`8e63a4312a30a9016e04b87265224ba90e88f8e959db3101aba0e1c190f98afb`;
loader SHA-256:
`515bc88381490eaa9eeb52265d57787ace9c3a7703fd15b662d99b4e4cce793e`.
Manifest confirms guarded multiply/add enabled and broad direct scalar
dispatch disabled. Native checks pass 6,144 scalar direct/generated status
comparisons (including known fused tie operands), 3,744 differential and
1,536 add/sub status comparisons, profiling off/on. Four-port ABI checks
pass. Cold helper count is 17,160; the larger scalar matrix makes it
incomparable to earlier 11,384/11,398 smoke counts for speed claims.

Server 1609 on localhost:8082 served the verified module. Tab 46 booted
GM4E01 and restored the unchanged 18:58:43 Luigi Circuit checkpoint.
Generation 1 remained consistent, with profiling/caches off and zero
timing samples. The valid 43.980455-second interval presented 1,019
frames: 23.169383 FPS and 38.655733% native speed. No browser errors were
observed. This is below the recent 26.6/26.9 FPS control/multiply-only
observations; one interval cannot isolate host load from guard overhead or
fallback frequency, but it supplies no case for promotion.

Ignored evidence: `work/double-dash-guarded-scalar-madd-race-{a,b}.json`
and `work/double-dash-guarded-scalar-madd-race.png`. Tab 46 closed to release
workers. Server/checkpoint remain available. Remaining work includes guard
coverage/fallback attribution (the current B-normal guard excludes zero B),
controlled repeats and the full-speed/visual/audio/physical-motion goal.
Source comment calling rounded C 25 significant bits is imprecise: the
mask retains 25 fraction bits plus the hidden bit; the product bound is
at most 50 significant bits, still exactly representable in f64. The
documented bound is 50; arithmetic uses the exact reference mask.


### Signed-zero addend coverage experiment

Host feasibility now includes signed-zero B for one quarter of two million
random vectors. 1,212,061 eligible cases match double fused arithmetic and
converted float bit-for-bit; 787,939 are rejected, plus the explicit tie
fixture stays outside the fast path. This remains host evidence only.

Patch 0033 now admits signed zero B while retaining normal-float A, exact
product bounds, selected-C rounding, non-tie and normal-result guards. It
uses float equality with zero to accept either sign and preserves both
results before destination writes. The precision comment is corrected to
25 fraction bits plus the implicit bit, at most 50 product bits.

Patch 0027 expands scalar rotations to 24 and therefore 9,216 scalar
status cases. New triplets (A=2, B=+0/-0, C=3) place signed-zero addends
with normal products/results in both lanes, including destination aliases
and NI/Rc/exception modes. Current evidence guards require 9,216 cases.
Runtime-selection tests pass. A new isolated configuration at
`work/double-dash-zero-addend-madd-core` succeeded and native build 36640
is active. Arithmetic, four-port ABI and race qualification remain pending.
The previous slower candidate and current room default are preserved; no
performance improvement is claimed. Server 1609 still serves the previous
verified binary on 8082, with no test browser tab open.


### Signed-zero native and browser qualification

Build 36640 completed. WASM SHA-256:
`71ac2dde6701b0df99f92b9a067fb64b6833053e06bb7006d37194ad429a1e69`;
loader SHA-256:
`3929f79a28cfef92a90f707fdfca916ea03086444fb1fe913ba650d86d3724b7`.
Native checks pass all 9,216 scalar direct/generated status comparisons,
3,744 differential and 1,536 add/sub status comparisons, profiling off/on,
plus the four-port ABI checks. Cold helper count is 22,854; matrix growth
means it is not a speed comparison with earlier smaller smoke runs.

Server 85939 on localhost:8082 served the verified module. Tab 47 booted
GM4E01 and restored the unchanged 18:58:43 checkpoint. Generation 1 was
consistent, with profiling/caches off and no timing samples. The valid
44.012690-second interval presented 1,022 frames: 23.220576 FPS and
38.737257% native speed. No browser errors were observed. The prior guarded
madd interval was 23.169383 FPS; these measurements do not demonstrate a
performance improvement from admitting zero addends. No default promotion.

Ignored evidence: `work/double-dash-zero-addend-madd-race-{a,b}.json` and
`work/double-dash-zero-addend-madd-race.png`. Tab 47 closed after capture
to release workers. Server and original checkpoint remain available.
Next performance work should inspect fallback frequency and reduce guard
cost only where exact-product/fused arithmetic equivalence is established;
full-speed, visual/audio and physical motion qualification remain open.


### Finite-double addend guard experiment

Host exact-product qualification now includes full finite-double B values
for one quarter of the two million vectors, signed zeros for another
quarter, and normal float addends otherwise. 1,077,521 eligible cases
matched separate double multiply/add against fused double arithmetic and
converted float bit-for-bit; 169,748 accepted cases used finite-double
addends. 922,479 vectors were excluded and the known tie fixture rejected.
This is host feasibility evidence, not generated-WASM qualification.

Patch 0033 now checks B only for finiteness, removing its float-precision
and magnitude restrictions. A still must be normal float precision, the
rounded-C product stays in normal float range and therefore is exact in
f64, and tie/raw-NI/normal-result/exception guards remain unchanged.
Finite B may be zero, subnormal or extended precision. The original fused
helper handles all excluded cases.

Scalar matrix now has 32 rotations (12,288 cases), adding A=2, C=3 with
B=1+2^-30 and the smallest double subnormal in separate lane triplets,
while preserving signed-zero and tie fixtures, aliases and status modes.
Runtime-selection tests pass with the updated required count. Isolated
configuration at `work/double-dash-finite-addend-madd-core` succeeded and
build 67780 is active. Native arithmetic/ABI and race qualification remain
pending. The earlier signed-zero binary and room default are preserved.
Server 85939 still serves the earlier verified binary on 8082; no test
browser tab remains open. No speed improvement is claimed.


### Finite-addend native and race qualification

Build 67780 completed. WASM SHA-256:
`9834ed2cfbaa06b38bfb8b48b2e89cbceafc87f26d572b1dc5babc906297b7f0`;
loader SHA-256:
`5f7faaba316c8cc904e7b5a3f21b3ca40e7e2511c16ff8dc8e8bfe6fe9d3106c`.
Native checks pass 12,288 scalar direct/generated status comparisons,
3,744 differential and 1,536 add/sub status comparisons, profiling off/on,
plus four-port ABI checks. Cold helper count 28,452 reflects the expanded
matrix and is not comparable as a speed metric to smaller smoke runs.

Server 51574 served the verified module on localhost:8082. Tab 48 booted
GM4E01 and restored the original 18:58:43 checkpoint. Generation 1 was
consistent, profiling/caches off, with zero timing samples. The valid
46.082485-second interval presented 717 frames: 15.559057 FPS and
25.924450% native speed. No browser errors were observed. This is below
the earlier 23.2 FPS guarded-madd intervals and supplies no performance
case for promotion. A single interval does not isolate host load or
compiled-code effects. The next comparison should build a current-source
control with generated madd disabled and the same 12,288-case matrix.

Ignored evidence: `work/double-dash-finite-addend-madd-race-{a,b}.json` and
`work/double-dash-finite-addend-madd-race.png`. Tab 48 closed to release
workers. Server/checkpoint remain available; default room runtime stays
on the earlier qualified candidate. Full-speed and fidelity goal remains
incomplete.


### Current-source generated-madd control build

The qualified finite-addend experiment is preserved at commit 178ec00 and
its isolated binary. Patch 0033 was reverse-applied only to the ignored
native checkout to disable generated multiply/add while retaining guarded
scalar multiply and the current 12,288-case status matrix. All tracked
patches remain available for recovery; this is an explicit control build,
not deletion of the experiment. Configuration succeeded at
`work/double-dash-current-madd-control-core`, broad scalar dispatch off.
Build 16024 is active. Native arithmetic/ABI and browser qualification
remain pending. Server 51574 still serves the previous verified candidate
on 8082 with no owned browser tab open.

A separate source observation: FifoManager's GPU loop returns immediately
when emulation is paused, before reaching the existing empty-FIFO
AllowSleep call. This may explain earlier paused-tab CPU consumption; no
behavioral fix or causal qualification has been made. Inspect BlockingLoop
wake/sleep semantics before changing pause handling, and keep that
experiment separate from the current performance control.

### Current-source control native qualification

Build 16024 completed successfully. Current control WASM SHA-256 is
494e5d7ea150f3f692851154caefb046f3eaa01047d046c6c178204b0aa62472;
loader SHA-256 is
5f7faaba316c8cc904e7b5a3f21b3ca40e7e2511c16ff8dc8e8bfe6fe9d3106c.
Manifest confirms guarded scalar multiply/add and broad scalar dispatch
are disabled. Arithmetic qualification passed 3,744 paired differential,
12,288 scalar status/exception and 1,536 paired status/exception cases,
with profiling disabled and enabled. The native ABI check passed all four
controller ports and rejected invalid ports. Cold smoke recorded 29,066
FP helper calls; that is test execution rather than gameplay evidence.
Browser race comparison remains pending. No runtime promotion was made.

The shared picker integration was also rechecked: all 22 integration,
renderer, catalog and round tests passed. Double Dash remains a registered
game using the ordinary room stage and phone controls.

### Current-source control browser race comparison

The qualified 494e5d7 control restored GM4E01's original 18:58:43 race
checkpoint on localhost:8082. Generation 1 remained consistent across a
44.062115-second interval: 1,041 presented frames, 23.625738 FPS and
39.414159% native speed. Profiling and all diagnostic caches were disabled;
no browser errors were observed. This is above the finite-addend madd
experiment's 15.559057 FPS, but one interval does not isolate host load or
scene progression. Neither result is sufficient for full-speed promotion.
Preserved ignored evidence: work/double-dash-current-madd-control-race-
{a,b}.json and .png. Tab 49 was paused then closed to release workers.
Owned server 36855 now serves the control on 8082. The ordinary room's
default candidate remains unchanged. Next work should address the paused
GPU loop separately and continue measuring the running performance gap.
