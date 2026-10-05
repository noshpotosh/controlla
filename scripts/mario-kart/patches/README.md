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

Preparation applies all six Controlla patches idempotently, copies the shared
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
