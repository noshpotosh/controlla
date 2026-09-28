# Shared room and protocol contracts

Implemented on `codex/shared-contracts-0928` from combined architecture checkpoint `371050d`. Implementation and enforcement checkpoint: `70378ad`. This slice extracts the actual browser/signaling overlap; it does not relocate or decompose the browser runtime.

## Ownership and compatibility

- `src/shared/room.ts` owns `Role`, `Player`, `Venue`, `Roster`, `Identity`, and the unchanged player color palette. `src/shared/app-protocol.ts` owns protocol version 4 and the existing mismatch code/reload message.
- Signaling consumes these modules directly. Browser, tooling and test consumers use the new owners; the former protocol file and extracted core exports have no compatibility forwards.
- The game-author API still exports `Player` and `Point`. The unused optional `Player.capabilities` field is removed by explicit scope agreement. Capability messages, negotiation, and the authority's separate capability map are unchanged; no roster producer emitted that field.
- Remaining `core/types.ts` declarations are browser-owned: geometry, input/press data, snapshot envelopes, generic messages and math/time helpers. They are not shared merely because tests or replay scripts run in Node.
- Protocol 4, layout schema 2, resolved configuration schema 1, binary input, host-browser authority, game behavior, and launch commands remain unchanged. No migration or coordinated version bump is required for this extraction.

## Enforcement and evidence

The existing TypeScript-resolved architecture walker checks backend and shared dependencies including type-only edges, import types, aliases, reexports, literal dynamic imports and CommonJS requires. Opaque dynamic imports and unresolved imports fail. Backend project dependencies stay within `server` and `shared`; Node built-ins and the existing `ws` package remain permitted. Shared contracts import only other shared contracts, never client/server implementations or packages.

Negative fixtures cover direct leaks, backend-helper leaks and leaks through shared contracts. A separate compiler check uses only ECMAScript libraries with no Node ambient types; injected DOM and Node references must fail. Existing shell allowlists admit the room contract explicitly, preserving all previous game/control/screen/tool checks.

The unchanged baseline passed 241 tests. The completed implementation passes **244 tests**, typecheck, project lint and production build/bundle audit. Current browser observations are recorded in the [validation ledger](../VALIDATION.md). Physical phones, TVs, motion sensors and multi-household latency remain unverified.

## Core inventory after browser-engine relocation

The subsequent [engine slice](ENGINE-OWNERSHIP.md), checkpoint `ec3344e` from `8d03840`, implements the bounded browser-engine move identified by this record.

| Former core modules | Current owner |
| --- | --- |
| `session.ts` | `client/engine/session.ts`: unchanged host-browser authority. |
| `protocol.ts`, `reliable-input.ts` | Client engine input transport and its colocated frame/press contracts. |
| `timing.ts`, `arbitration.ts` | Client engine timing/lifecycle; `now` lives in timing. |
| `snapshots.ts` | `client/engine/replication.ts`: generic encoder/timeline/envelopes. Existing engine `snapshots.ts` retains game policy. |
| Engine declarations formerly in `types.ts` | Corresponding engine modules; generic `Message` lives in type-only `engine/messages.ts`. |
| Remaining `pointer.ts`, `calibration.ts`, `motion/trace.ts`, `types.ts` | Controller-motion migration remains deferred. Types now contain only `Point`, `Quaternion`, and `clamp`, with no imports. |

Runtime and network remain in their existing client locations. Provider lifecycle, runtime decomposition, controller-motion relocation and backend directory renaming remain separate work. Shared contracts and backend launch paths are unchanged.

## Recovery and integration

Keep the source integration branch and all existing worktrees. Implementation checkpoints are pushed to the explicit topic branch; the draft PR targets `codex/architecture-integration-0928`. No merge into the integration branch or `main`, release, or deployment is included. Revert the extraction commit to restore the earlier import ownership; there is no data conversion to reverse.
