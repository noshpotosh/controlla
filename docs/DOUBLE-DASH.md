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
