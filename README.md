# Controlla

A browser-authoritative party-game framework. Each venue has a screen and its own phone controllers. Phones send local input to their venue; screens relay input to the host and render snapshots of its simulation. No video streaming.

**Status: Neon Harvest is the sole game; controller, shell, shared-contract, browser-engine, motion-provider, display-playback and controller-input boundaries are implemented. Validation results and desktop observations are recorded in the validation ledger. Hardware/multi-household acceptance remains unverified.** The acceptance budgets in the specification are targets, not measured claims. See [validation](docs/VALIDATION.md) and [design decisions](docs/ADR-001.md).

## Run locally

Install Node.js 24 LTS (Node 22.13+ is supported; development used Node 25) and npm, then clone the project and install its locked dependencies:

```sh
git clone https://github.com/noshpotosh/controlla.git
cd controlla
npm ci
```

On Linux installations where Sharp detects an incompatible global libvips, use `SHARP_IGNORE_GLOBAL_LIBVIPS=1 npm ci`.

Both processes must stay running. From the project directory:

**Terminal 1 — room signaling and relay service (port 8787):**

```sh
npm run signal
```

**Terminal 2 — browser application (port 3000):**

```sh
npm run dev -- --host 0.0.0.0
```

Stop each process with Ctrl+C when finished. Stopping the signaling service ends its active sessions. No database, account setup, or environment file is needed for local desktop testing.

Open http://localhost:3000. Create a room on a screen. Connect one to eight phones using **Copy phone link**, or the five-character room code and four-character screen code. A second screen uses only the room code, then gets its own phone link. Select Neon Harvest: a 45-second collection round with motion aim or absolute touch aim and a separate pulse button.

On a single computer, separate browser tabs can act as phones using touch/mouse fallback. Choose **Join as a new device** in connection settings to avoid resuming another tab's saved identity. This is a functional test, not a latency measurement.

## Real phones need HTTPS

`localhost` is special: an ordinary `http://192.168.…` phone connection is **not** a secure context and will not expose motion or wake-lock APIs. Use a trusted HTTPS reverse proxy or development tunnel. Configure the signaling service's exact frontend origin:

```sh
ALLOWED_ORIGINS=https://play.example.com npm run signal
```

Proxy `/signal` with WebSocket upgrade support to port 8787 and all other paths to the frontend. See [deploy/Caddyfile](deploy/Caddyfile.example). The local Vite server already proxies `/signal`. Never expose the Vite development server as a production deployment.

Keep phones on the same network as their own screen, use Game Mode on televisions, and keep every screen visible. Direct P2P is not proof of LAN reachability: inspect candidate types and measure the path. A guest Wi-Fi network may isolate clients. The controller identifies direct-to-host fallback as degraded aiming.

## Troubleshooting

- **“Cannot reach the room service”:** check that both terminals are running. The local frontend forwards `/signal` to port 8787.
- **Phone link contains `localhost`:** that address refers to the phone itself. Open the host screen through the shared HTTPS address before copying its phone link.
- **Connection rejected through a proxy or tunnel:** set `ALLOWED_ORIGINS` to the exact frontend origin, including its scheme and non-default port, then restart signaling. Multiple origins are comma-separated.
- **Motion unavailable:** use HTTPS, tap **Enable motion**, and check the browser’s site permissions. Touch fallback lets you continue without motion.
- **A second tab resumes the same player:** choose **Join as a new device** under connection settings.
- **Protocol version mismatch:** update the browser application and signaling service together, then reload every screen and phone. Mixed versions cannot join or resume a room; retries stop until you reconnect with matching versions.

The signaling process reads variables from its environment. `.env.example` documents them, but `npm run signal` does not automatically load a `.env` file; export the variables or prefix the command as shown below.

## Production topology

The frontend builds as a Cloudflare-compatible Worker through the Sites/Vinext scaffold. The Node signaling service is a separate, long-lived process; it is **not** contained in the frontend Worker. No public deployment is configured in this checkout.

For a production release, deploy the signaling service behind WSS, route `/signal` to it (or enter its WSS URL in connection settings), restrict `ALLOWED_ORIGINS`, and supply TURN servers through `ICE_SERVERS`. Cross-household success cannot be assumed with the default STUN-only configuration.

```sh
SIGNAL_PORT=8787 \
ALLOWED_ORIGINS=https://play.example.com \
ICE_SERVERS='[{"urls":"stun:stun.example.com:3478"},{"urls":"turns:turn.example.com:5349","username":"short-lived-user","credential":"short-lived-credential"}]' \
npm run signal
```

`ICE_SERVERS` is sent to room participants, as WebRTC requires. Use scoped, short-lived TURN credentials; do not put administrative secrets in it. Signaling keeps only live rooms and uses an ephemeral HMAC key. Restarting it ends existing sessions. Host loss also ends a session; there is no migration or persistence service.

## Validation commands

```sh
npm test
npm run typecheck
npm run lint
npm run benchmark
npm run build
npm audit
```

The benchmark reports Node structured-clone and MessageChannel timing. It does not decide browser iframe performance. The UI uses same-page modules provisionally and passes cloneable snapshots across its boundaries.

## Layout

The proposed reorganization and API planning process is documented in the [architecture meta plan](docs/ARCHITECTURE-META-PLAN.md). It is a planning draft; the current layout is described below.

The [independent game-authoring walkthrough](docs/architecture/AUTHORING.md) runs with `npm run game:dev` at `/dev/game-harness`, without signaling or phones. The harness and live rooms share one catalog and round runner for Neon Harvest, the sole production descriptor (`standard` mode, 1–8 players). The harness includes simulated host/remote displays, mode selection, a controller probe, and session points. Run `npm run game:test` for its checks. See the [evidence and remaining acceptance work](docs/architecture/DECISIONS-EXPERIMENTS.md) before treating these repository-local APIs as a stable public SDK.

Frontend and signaling must both use application protocol **4**. Reload existing screens and phones after upgrading; the binary input frame is unchanged.

The gallery, designer, phone preview, Motion Lab and game harness are development-only. Production builds assert that their modules and styles are excluded. Calibration, connection diagnostics and session reports remain available in production. Rounds hold a 200 ms settling period after the timer ends before showing final results.

- [`src/client/shell`](src/client/shell): composition, join/room/phone views, diagnostics and read-only runtime ports. See the [shell boundary and acceptance](docs/architecture/NEXT-SHELL-BOUNDARY.md).
- `src/client/controls/motion`: sensor lifecycle, pure processing, calibration, pointer algorithms and trace contracts. See the [motion-provider boundary](docs/architecture/MOTION-PROVIDER.md).
- `src/shared`: platform-independent room/identity/roster contracts, player colors, and application protocol constants; the only project contracts consumed by signaling. See the [shared boundary record](docs/architecture/SHARED-CONTRACTS.md).
- `src/core`: general geometry primitives (`Point`, `clamp`); motion algorithms and `Quaternion` are controller-owned.
- `src/client/engine`: session authority, input transport, clocks/buffers, arbitration, generic replication, game snapshot policy, round runner and progress/history. See the [engine ownership record](docs/architecture/ENGINE-OWNERSHIP.md).
- [`src/client/playback`](src/client/playback): snapshot playback, presentation cues, acknowledgments and diagnostics; see the [playback ownership record](docs/architecture/DISPLAY-PLAYBACK.md).
- [`src/client/controller-input`](src/client/controller-input): phone input lifetimes, values/presses, motion processing and frame scheduling; see the [input ownership record](docs/architecture/CONTROLLER-INPUT.md).
- `src/client/runtime.ts`, `network.ts`: session composition, routing, browser resources and peer transport; further decomposition remains deferred.
- `src/client/controls`: controller contracts, validated resolution, reusable controls and saved layouts (`layouts/`).
- `src/client/devtools`: development entry, controller designer/gallery/preview, Motion Lab and isolated game harness.
- `src/client/api`, `game-screen`, `minigames`: author contracts, read-only presentation, and the production game catalog.
- `src/client/minigames/neon-harvest`: independent rules, state, renderer and colocated tests. Lab, Tilt Rally, Target Practice and their combined legacy adapters/state are retired; cross-game guarantees use test-only descriptors.
- `server`: signed identity/resume tokens, room codes, source/global join limits, authorized signaling and relay routes, heartbeat-based host termination.
- `tests`: protocol/math/lifecycle tests, room security/reconnect tests, a live WebSocket integration test, and clone benchmark.

Neon Harvest reconstructs the accepted earlier simple design from surviving type/app references and a later stash; an intact early rules/renderer implementation was not recovered. It uses seeded spark/gold waves, chains, warming mines and a cooldown pulse. Enemies, autofire, powers, sectors, core and combat metrics are excluded. The reusable `aim-pad` control fills its rectangular range and holds position on release/cancel; `aim-and-pulse` pairs it with an independent button. See the [provenance and current acceptance gate](docs/architecture/DECISIONS-EXPERIMENTS.md).

The host Display receives serialized snapshots through the same decoder/buffer as remote Displays. Own-venue cursors bypass that buffer. No Display reads the authoritative game's mutable state.

## Session reports

**Save session report** downloads JSON containing software timing percentiles, packet loss, transport paths, fallbacks, snapshot information, disconnects, and completed results with round IDs, game statistics, placement awards and totals. The ledger retains all participant totals and the latest 50 reports; reliable revisioned batches hydrate reports separately from gameplay snapshots. Record camera-derived motion-to-photon timing in diagnostics. This manual value is not a detected panel delay or a software estimate of Game Mode.

Neon Harvest uses a freeze policy when a player disconnects and continues to bounded results. Calibration matrices are saved per room and venue. Motion yaw cannot be recovered while a page is suspended; after a reload, use Recenter if needed without repeating the corner fit.
