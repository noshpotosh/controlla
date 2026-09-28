# Browser-engine ownership

Implemented on `codex/browser-engine-ownership-0928` in `.worktrees/browser-engine-ownership-0928`, from integration checkpoint `8d03840`. Implementation and boundary enforcement: `ec3344e`. This is an ownership migration with unchanged gameplay and wire behavior.

## Owners and interfaces

The former core `session.ts`, `protocol.ts`, `reliable-input.ts`, `timing.ts` and `arbitration.ts` retain their names under `src/client/engine`. Generic core snapshots move to `engine/replication.ts`, preserving the existing `engine/snapshots.ts` game validation/interpolation policy. The session still consumes the existing catalog; this slice does not introduce catalog injection or runtime decomposition.

| Contract | Engine owner |
| --- | --- |
| `InputFrame` | `protocol.ts` |
| `Press`, existing `WidgetValueMessage` | `reliable-input.ts` |
| `Snapshot`, `WireSnapshot`, `SnapshotPolicy` | `replication.ts` |
| `Message` | `messages.ts`, declarations only |
| `now` | `timing.ts` |

Runtime, network, harness and tests import these owners directly. Old modules and moved core exports have no forwards; there is no engine barrel. Author APIs are unchanged and do not depend on engine internals. The game API still exports `Point` from core and `Player` from shared.

At this checkpoint, remaining core files were `pointer.ts`, `calibration.ts`, `motion/trace.ts` and `types.ts`. Types now contain only `Point`, `Quaternion` and `clamp`, with no imports. Their controller-motion ownership migration is deferred, along with provider lifecycle changes. `src/client/runtime.ts`, `network.ts` and `motion.ts` retain their current locations and implementations apart from necessary import updates.

The subsequent [motion-provider slice](MOTION-PROVIDER.md) moves those motion algorithms under controls, leaving only general `Point`/`clamp` in core. Runtime and network ownership remain deferred.

## Enforcement and evidence

TypeScript-resolved dependency checks include erased types, aliases, import queries, reexports, literal dynamic imports and CommonJS requires. Engine graphs cannot reach shell, screen, concrete browser orchestration/network/motion, developer tools or backend. Opaque and unresolved dependencies fail. The existing controller definition's erased `IconName` reference may reach its icon vocabulary for type inspection; a separate runtime graph rejects executing that UI or external packages. No React-free claim is made for the complete erased type graph.

Negative fixtures cover direct and indirect engine escapes, shell/screen access to the relocated authority, and backend/shared access to engine contracts. Required graph entries must exist. Production-bundle positive controls identify the relocated session, and the indirect developer-tool fixture now routes through engine timing rather than a deleted core path. Existing headless harness, protocol, lifecycle, snapshot, input, reconnect and teardown checks remain in the full suite.

The baseline passed 244 tests, typecheck, lint and production build. Implementation passes **248 tests**, typecheck, lint and production build/bundle assertions for client, SSR and RSC. The [validation ledger](../VALIDATION.md) records desktop acceptance and remaining physical-device work.

## Compatibility and recovery

Host-browser authority, protocol 4, the 47-byte binary frame, layout schema 2, resolved controller schema 1, 200 ms settling, report shapes and launch commands are unchanged. There is no data migration, dependency change, deployment, backend rename or new game.

The topic branch is pushed to `origin`; its draft PR targets `codex/architecture-integration-0928`. Existing worktrees and source branches are preserved. Reverting `ec3344e` restores the previous module ownership without data conversion. Merging, releasing and deployment remain outside this slice.
