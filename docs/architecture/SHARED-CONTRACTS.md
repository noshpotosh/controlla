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

## Remaining core inventory

| Current modules                                   | Actual consumers                                                        | Future owner; deferred work                                                                                                               |
| ------------------------------------------------- | ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `session.ts`                                      | Browser runtime and tests                                               | Client engine/session authority; no backend consumer.                                                                                     |
| `protocol.ts`, `reliable-input.ts`                | Browser runtime/session and tests                                       | Client engine input transport; preserve frame format and freshness/ACK behavior.                                                          |
| `timing.ts`, `arbitration.ts`                     | Runtime/session/round runner and tests                                  | Client engine timing/lifecycle.                                                                                                           |
| `snapshots.ts`                                    | Runtime/session, harness and engine snapshot policy                     | Client engine replication. Existing `engine/snapshots.ts` already owns catalog policy, so select a distinct destination during that plan. |
| `pointer.ts`, `calibration.ts`, `motion/trace.ts` | Browser motion/runtime/screen/shell observation, tools and replay tests | Controller motion algorithms/contracts. Node replay usage does not make these backend-shared.                                             |
| Remaining `types.ts`                              | Browser domains and tests                                               | Split by the corresponding engine/controller owner during those migrations.                                                               |

Next, plan a bounded browser-engine ownership relocation against this inventory. Keep provider lifecycle changes, runtime decomposition, controller motion relocation and backend directory renaming separately scoped. The `server/` name and launch paths remain useful and unchanged.

## Recovery and integration

Keep the source integration branch and all existing worktrees. Implementation checkpoints are pushed to the explicit topic branch; the draft PR targets `codex/architecture-integration-0928`. No merge into the integration branch or `main`, release, or deployment is included. Revert the extraction commit to restore the earlier import ownership; there is no data conversion to reverse.
