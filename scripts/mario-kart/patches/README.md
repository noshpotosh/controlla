# Four-controller core work

`0001-four-controller-state.patch` applies to wasm-dolphin commit
`7e38409ace3dda709c178312ff63fd92a3653cc7`. It adds four independently locked
controller snapshots and `SetControllerInputState(port, connected, mask,
stick_x, stick_y, c_stick_x, c_stick_y, trigger_left, trigger_right, analog_a,
analog_b, generation)`. Ports are zero-based. Disconnect resets buttons,
triggers, and sticks; invalid ports return 0 without changing state. The
existing `SetInputState`/SharedArrayBuffer path continues to address port 0.

The patch has passed `git apply --check` against the pinned checkout. The added
native setter was extracted from the patch and compiled with macOS clang++ in
a small harness using the upstream snapshot struct. Assertions passed for
port isolation, analog clamping, invalid-port rejection, and disconnect release.
This is a unit check of the setter, not a Dolphin build or multiplayer test.

Implemented in the isolated candidate build:

1. Prepare a separate build checkout and apply the patch. Leave the working
   single-controller prebuilt runtime intact until replacement validation passes.
2. Add `_SetControllerInputState` to the final generated Emscripten export list.
3. Configure four emulated GameCube serial-interface controller devices at boot;
   returning a pad status alone does not configure those devices.
4. Add a port-aware worker message and native `ccall`, preserving separate input
   generations per controller. Do not share port 0's deduplication signature
   or SAB generation counters between ports.
5. Add port-aware Controlla input delivery, connection ownership, and input release
   on disconnect, page suspension, and room shutdown.
6. Build and verify the resulting WASM ABI before replacing the prebuilt core.

Remaining: verify two through four independent controller ports in the actual
game's character selection and split-screen racing; test cooperative rider controls.

The upstream toolchain lock requires `win32-x64`. A separate Apple Silicon
configuration now exists in `../configure-macos.mjs`, using project-local
Emscripten 5.0.7, CMake 3.31.6, Ninja 1.11.1, and Rust nightly with rust-src.
It records actual macOS executable hashes and versions in the build checkout's
`controlla-macos-toolchain.json`; it does not claim Windows hash equivalence.
The pinned Naga dependency library and full emulator compiled successfully.
The actual WASM ABI accepts connection/disconnection on all four ports and rejects
invalid ports. Binary and loader hashes are recorded in `controlla-core-build.json`.
Browser gameplay and physical phone motion remain unverified.

## Worker transport patch

`0002-controller-worker-transport.patch` adds a port-aware adapter request and
native ABI binding. Copy `../controller-input.mjs` into the staged runtime as
`src/controlla-controllers.js` before applying it. The handler refuses cores
that lack the new export. It validates packets and keeps four independent
sequence spaces, including wraparound handling, before writing native state.
Disconnect packets clear all held input. Requests are acknowledged so a missing
native ABI can be surfaced to the caller.

The pure packet/generation tests pass. Both patches apply cleanly to the pinned
source; this is still staging work, not active multiplayer. The existing port-0
SAB input and new port-0 requests must not concurrently own the same controller.
A frontend ownership switch must disable legacy input while a phone owns port 0.

## Preparing the staged build

After fetching the pinned Dolphin sources and applying upstream's verified patch
series in `work/double-dash-build`, run:

```sh
node scripts/mario-kart/prepare-core.mjs
node scripts/mario-kart/configure-macos.mjs
```

Preparation applies all seven Controlla patches idempotently, copies the shared
packet validator into the runtime, and adds the port-aware setter to the full Core Emscripten export list. The third patch configures four emulated
GameCube controller devices. These changes affect only the isolated build
checkout, not the current prebuilt runtime.

## Restore confirmation

`0004-confirm-state-restore.patch` waits for the core's after-load checkpoint
generation to change before reporting a successful restore. A native load
return value of 1 only means the request was queued. Rejection or an eight-second
timeout now returns `loaded: false`. This is a worker-only change; it needs no
native rebuild. The actual compiled core passed `npm run mario-kart:check-state`:
a 10,245,299-byte Double Dash state was serialized, copied into a new virtual
file, loaded, and confirmed by generation advancing from 0 to 1 with the core
still Running. Browser WebGPU restoration remains unverified. IndexedDB was
checked separately with a synthetic snapshot and a close/reopen cycle in the
Codex in-app browser; that does not prove the complete emulator restore path.

## Explicit renderer selection

`0005-preserve-renderer-selection.patch` keeps every renderer selection in the
settings URL, including Software. Upstream removed the default Software value
when applying settings, allowing the automatic GM4E01 profile to replace it
with WebGPU hardware at the next mount. All four renderer choices now survive
the settings URL round trip. This is a JavaScript-only patch.

## Renderer evidence

`0006-renderer-diagnostic-evidence.patch` adds draw, presentation, missing-resource,
shader compilation, and pipeline counters to the worker diagnostic report. It
also records shader compilation errors in the bounded error history, alongside
existing GPU validation errors. It changes observation only and needs no native
rebuild. Add `rendererdiagnostics=1` to the standalone diagnostic URL to capture
the report in the hidden `controlla-renderer-diagnostics` DOM element. Optional
`probeinputs=1` adds 30-game-frame menu input probes, 300-frame acceleration,
and 90-frame analog steering with acceleration. Each probe releases when its
target game frame is reached. These controls are absent from the normal room
and game presentation.

## Candidate console depth conversion

`0007-restore-console-depth-conversion.patch` restores depth conversion in the
specialized and uber pixel shader generators when the backend cannot reverse
its depth range. Fog receives console depth; per-pixel depth writes convert it
back to host depth. The pinned WebGPU source had exempted the Vulkan shader
dialect from both conversions despite declaring no reversed-depth-range support.
This candidate requires a native rebuild and browser comparison; it is not
verified merely by applying the patch or compiling it.

For isolated candidate artifacts, set `DOLPHIN_WASM_OUTPUT_DIR` to the same
absolute directory for both `configure-macos.mjs` and `build-macos.mjs`. The
builder checks the configured directory and writes its build manifest beside
the candidate core. Default builds retain the existing output and manifest
locations. This preserves the current core during renderer experiments.

Experimental patch `0008-emulate-destination-alpha.patch` is not yet included
in `prepare-core.mjs`. It creates a real-alpha fragment variant for specialized
shaders that write `alphaRef.a`, then uses separate RGB and destination-alpha
pipelines for blended RGBA draws. Both indexed and non-indexed draw paths
repeat the same geometry; the alpha pass disables depth writes and uses equal
testing when the first pass writes depth. This prototype needs runtime/fidelity
validation, handling audit for ubershaders and shader/pipeline failures, and
manifest integration before becoming part of the prepared runtime.

`0009-observe-fifo-drain-gates.patch` is an experimental diagnostic candidate.
It adds atomic CP FIFO gate observations to the existing PPC helper report,
including queue distance, read/link enables, pending interrupt, breakpoint,
and read/write pointers. The observations refresh even when JIT counters
are unchanged, and are explicitly not a coherent snapshot. It does not
change FIFO behavior. Patch application and reverse checks passed. The builder requires an isolated
output, records this patch and the native CPU source hash, and rejects the
default output. The isolated candidate compiled successfully with 179 exports, and all four
controller ports passed native ABI checks. Browser gate reporting remains
unverified until the candidate is booted and its report inspected.

`0010-opt-in-classifier-readbacks.patch` separates command classification
from its EFB/backbuffer/XFB diagnostic readbacks. `wgpuclassify=1` collects
counters without those captures; add `wgpuclassifyreadback=1` to explicitly
request them. The renderer report exposes `wgpuClassifierReadbacksEnabled`.
Classification without captures cannot establish pixel/readback evidence.
Deep and input-latency diagnostic captures retain their separate opt-ins.
This JS-only patch is included in preparation and requires no native rebuild.

`0011-sleep-empty-wasm-fifo.patch` is an experimental native candidate,
excluded from automatic preparation. It grants the existing BlockingLoop
sleep permission after the nondeterministic GPU FIFO payload finds queue
distance zero. New GP bursts and async requests retain their Wakeup path.
The builder requires isolated output, verifies the reverse patch, and records
the FIFO source hash and candidate flag. A host-side 10,000-wakeup stress
check passed; native WASM compilation and browser validation remain pending.

`0020-report-texture-fallbacks.patch` exposes worker-lifetime missing-texture
and unsupported-format dummy substitutions in `commandReplay.textureFallbacks`.
It copies the ID/format sets into the report and leaves replay behavior unchanged.
It is a JS-only preparation patch; scene attribution requires counter deltas.

`0021-reference-paired-arithmetic.patch` is an isolated native fidelity candidate.
It routes paired arithmetic through the reference interpreter to preserve scalar
aliasing, FPSCR/FPRF, operand rounding, and fused operations. It retains existing
sign/merge paths and is excluded from preparation. Performance is unverified.

`0022-test-paired-arithmetic-aliases.patch` extends the native generated-WASM
arithmetic smoke with four scalar-source alias cases and FPRF checks. It is
experimental and excluded from preparation; executing it requires a fresh build.

`0023-direct-reference-paired-dispatch.patch` is an isolated performance candidate
that directly invokes the existing paired arithmetic handlers instead of table
lookup/indirect dispatch. It adds no approximate arithmetic. Native regression
and browser performance validation are required; preparation excludes it.

`0024-differential-paired-arithmetic.patch` extends the native arithmetic smoke
with 3744 generated-WASM/reference comparisons across operations, destination
aliases, FPSCR modes and edge operands. Preparation excludes this experiment.

`0034-sleep-paused-wasm-fifo.patch` is an isolated pause-loop candidate.
The Emscripten paused payload renews AllowSleep after a late Wakeup; ordinary
running FIFO work and resume Wakeup are unchanged. Preparation excludes it.
Builder requires exact patch provenance and isolated output. Browser pause CPU,
repeated resume and race behavior must be qualified before promotion.

`0035-direct-wasm-block-dispatch.patch` enables the existing Emscripten direct
RunWasmBlock callback branch and its inlining attribute in this translation
unit. It overrides the baseline compiler definition only for this experiment.
Preparation excludes it; builder requires exact patch provenance and isolated
output. Native regressions and matched browser throughput are pending.
