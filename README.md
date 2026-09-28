# Controlla

A browser-authoritative party-game framework. Each venue has a screen and its own phone controllers. Phones send local input to their venue; screens relay input to the host and render snapshots of its simulation. No video streaming.

**Status: Neon Harvest is the sole game; controller, shell, shared-contract, browser-engine, motion-provider, display-playback, controller-input and session-routing boundaries are implemented. Validation results and desktop observations are recorded in the validation ledger. Hardware/multi-household acceptance remains unverified.** The acceptance budgets in the specification are targets, not measured claims. See [validation](docs/VALIDATION.md) and [design decisions](docs/ADR-001.md).

## Run locally

Install Node.js 24 LTS (Node 22.13+ is supported; development used Node 25) and npm, then clone the project and install its locked dependencies:

```sh
git clone https://github.com/noshpotosh/controlla.git
cd controlla
npm ci
```

Both processes must stay running. From the project directory:

**Terminal 1 — room signaling and relay service (port 8787):**

```sh
npm run signal
```

**Terminal 2 — browser application (port 3000):**

```sh
npm run dev
```

Stop each process with Ctrl+C when finished. Stopping the signaling service ends its active sessions. No database, account setup, or environment file is needed for local desktop testing.

Open http://localhost:3000. Create a room on a screen. Connect one to eight phones using **Copy phone link**, or the five-character room code and four-character screen code. A second screen uses only the room code, then gets its own phone link. Select Neon Harvest: a 45-second collection round with motion aim or absolute touch aim and a separate pulse button.

On a single computer, separate browser tabs can act as phones using touch/mouse fallback. Choose **Join as a new device** in connection settings to avoid resuming another tab's saved identity. This is a functional test, not a latency measurement.

## Real phones need HTTPS

The frontend listens on the computer's LAN addresses as well as localhost. Phones must open that LAN address; `localhost` on a phone points to the phone itself. Plain LAN HTTP supports touch testing, but motion and wake lock need a secure context.

For trusted HTTPS on iPhones, follow the [local device setup](docs/acceptance/LOCAL-IPHONE.md). Its temporary Caddy proxy and certificate preflight live under `scripts/local-testing/`; they need no public hosting account, tunnel or deployment.

For a quick HTTPS preview, `HTTPS=1 npm run dev` enables a self-signed certificate. A browser warning bypass is not a substitute for trusted HTTPS when accepting real-device motion behavior. In a separate terminal, allow the exact frontend origin (replace the example with your computer's LAN address and actual port):

```sh
ALLOWED_ORIGINS=https://192.168.1.20:3000 npm run signal
```

The frontend proxies `/signal` to the local signaling process on port 8787. To change that port, set the same `SIGNAL_PORT` in both terminals. Development fails if the selected frontend port is occupied instead of silently changing the phone URL. Open the host screen through the LAN HTTPS address before copying its phone link.

Keep phones on the same network as their own screen, use Game Mode on televisions, and keep every screen visible. Direct P2P is not proof of LAN reachability: inspect candidate types and measure the path. A guest Wi-Fi network may isolate clients. The controller identifies direct-to-host fallback as degraded aiming.

## Troubleshooting

- **“Cannot reach the room service”:** check that both terminals are running. The local frontend forwards `/signal` to port 8787.
- **Phone link contains `localhost`:** that address refers to the phone itself. Open the host screen through the shared HTTPS address before copying its phone link.
- **Connection rejected from a phone or local proxy:** set `ALLOWED_ORIGINS` to the exact frontend origin, including its scheme and non-default port, then restart signaling. Multiple origins are comma-separated.
- **Motion unavailable:** use HTTPS, tap **Enable motion**, and check the browser’s site permissions. Touch fallback lets you continue without motion.
- **A second tab resumes the same player:** choose **Join as a new device** under connection settings.
- **Protocol version mismatch:** update the browser application and signaling service together, then reload every screen and phone. Mixed versions cannot join or resume a room; retries stop until you reconnect with matching versions.

The signaling process reads variables from its environment. `.env.example` documents them, but `npm run signal` does not automatically load a `.env` file; export the variables or prefix the command as shown above.

## Development and build validation

This project currently supports local development on computers and phones. Hosting and deployment are deferred. There is no deployment command or hosted-service configuration.

Vite/Vinext runs the frontend in Node; a separate Node `ws` process handles room signaling and relay traffic. `npm run build` compiles the app locally and checks that developer tools stay out of the normal application bundle. CI runs checks and builds, without publishing anything.

Signaling keeps rooms in memory. Restarting it ends existing sessions; host loss also ends a session. The default STUN configuration does not guarantee connectivity across households. `ICE_SERVERS` remains available for connection testing and is sent to room participants; do not put administrative secrets in it.

Generated `.next/`, `.vinext/`, and `dist/` directories are ignored by Git and can be regenerated after stopping development processes. `node_modules/` contains installed dependencies. Preserve `.worktrees/` (separate Git checkouts), `output/` (design source artifacts), and any useful playtest evidence under `outputs/`.

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
- [`src/client/runtime/playback`](src/client/runtime/playback): snapshot/progress playback, local cursors, presentation cues and acknowledgments; see the [playback ownership record](docs/architecture/DISPLAY-PLAYBACK.md).
- [`src/client/runtime/controller-input`](src/client/runtime/controller-input): phone input lifetimes, values/presses, motion processing and frame scheduling; see the [input ownership record](docs/architecture/CONTROLLER-INPUT.md).
- [`src/client/runtime/session-routing`](src/client/runtime/session-routing): role-based messages, controller relays and fallback selection; see the [routing ownership record](docs/architecture/SESSION-ROUTING.md).
- `src/client/runtime/runtime.ts`: session composition and lifecycle coordination; browser resources and observational diagnostics have separate runtime owners. See the [runtime composition record](docs/architecture/RUNTIME-COMPOSITION.md).
- `src/client/transport`: injectable peer transport; existing WebRTC, reconnect, relay and queue algorithms are preserved.
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
