# BL-001: Latency and netcode architecture review

- **Depends on:** none
- **Branch:** _set when work starts_
- **Areas:** engine, transport, runtime, server, docs

## Goal

Players feel lag in three places. The cursor trails the hand, hits register
late, and a second screen runs visibly behind. Find out where every millisecond
goes. Then judge whether moving to a live-service style architecture would fix
it: a server-authoritative simulation, rollback or prediction, tick-numbered
input, and edge hosting. The result is a review with findings and
recommendations that the user can choose from, plus the follow-up backlog items
to carry them out.

## Context

The current design is deliberate and documented. Start with
[`spec.md`](../../spec.md) §1.3–1.5 (venues and host-browser authority), §3
(latency budgets A and B, clock sync, delay equalization), §4 (transport and the
input frame), §5.10 (local cursor prediction), §7.5 (snapshots, and the promise
that game authors need no determinism) and §8.5 (host loss). Then read
[`docs/ADR-001.md`](../ADR-001.md), which names server authority as the upgrade
path, and the ownership records in [`docs/architecture/`](../architecture/).

How input and state move today, on `develop`:

- **Phone to screen.** In
  [`controller-input.ts`](../../src/client/runtime/controller-input/controller-input.ts),
  the phone sends motion as a 47-byte binary `InputFrame`
  ([`protocol.ts`](../../src/client/engine/protocol.ts)). It carries a u16
  `seq`, a u32 microsecond timestamp on the synced clock, a config generation,
  x/y/vx/vy, button bits, and four edge counters with edge times. Frames go on
  an unreliable, unordered WebRTC channel (`maxRetransmits: 0`). Touch widget
  values (aim pad, stick and so on) are throttled and sent separately as
  reliable, ordered JSON `WidgetValueMessage`s. Presses also go into a reliable
  journal ([`reliable-input.ts`](../../src/client/engine/reliable-input.ts)).
  Frames carry timestamps, not tick numbers.
- **Screen to host.** The venue screen relays input to the host browser
  ([`session-router.ts`](../../src/client/runtime/session-routing/session-router.ts)).
  A single venue's host is the same tab. Transport is in
  [`network.ts`](../../src/client/transport/network.ts): WebRTC data channels,
  with JSON for anything that isn't a binary frame, and a WebSocket relay
  through the Node server as the fallback.
- **Simulation.** The host browser is the authority
  ([`session.ts`](../../src/client/engine/session.ts)). `runtime.ts` drives it
  from a 120 Hz `setInterval`
  ([`runtime.ts`](../../src/client/runtime/runtime.ts)), and the session ticks
  at most every 1000/60 ms. Continuous input passes through a jitter buffer of
  up to 20 ms with up to 30 ms of extrapolation (`ContinuousBuffer` in
  [`timing.ts`](../../src/client/engine/timing.ts)). Presses mature 200 ms after
  their action time before they are judged in time order
  ([`arbitration.ts`](../../src/client/engine/arbitration.ts)). Rounds settle
  for 200 ms after the timer ends ([`round.ts`](../../src/client/engine/round.ts)).
- **Host to screens.** Snapshots go out every 40 ms (25 Hz) from `session.ts`,
  encoded per peer by [`replication.ts`](../../src/client/engine/replication.ts)
  and [`snapshots.ts`](../../src/client/engine/snapshots.ts). With more than one
  venue, every screen renders at a shared delay `D`. `D` is the worst venue's
  p95 one-way delay plus 2 × 40 ms plus 10 ms, ramped at 50 ms per second
  (`Equalizer` in `timing.ts`). With one venue, `D` is 0.
- **Screen rendering.**
  [`display-playback.ts`](../../src/client/runtime/playback/display-playback.ts)
  samples the snapshot timeline. A screen's own phones skip that buffer.
  [`cursor-playback.ts`](../../src/client/runtime/playback/cursor-playback.ts)
  draws them as frames arrive and carries them on for up to 40 ms.
- **Server.** [`server/index.ts`](../../server/index.ts) and
  [`server/rooms.ts`](../../server/rooms.ts) are a Node `ws` process. It handles
  room identity, signaling and the fallback relay. ICE servers come from
  `ICE_SERVERS`, which defaults to Google STUN only, so there is no TURN.
- **Clock sync.** The runtime probes the clock every 1.5 s.

Tools that already exist:

- **Save session report.** The host screen downloads a JSON report with timing
  percentiles, loss, transport paths, fallbacks and snapshot statistics
  ([`diagnostics.ts`](../../src/client/runtime/diagnostics/diagnostics.ts)).
- `npm run benchmark` ([`tests/benchmark.ts`](../../tests/benchmark.ts))
  measures structured-clone cost.
- `npm run replay` ([`tests/replay.ts`](../../tests/replay.ts)) replays recorded
  iPhone motion traces from `tests/fixtures/motion/`.
- The transport is injectable. Existing runtime and socket tests in `tests/`
  show how to drive a session headlessly.

Related past work:

- `521832f` cut about 47 ms of cursor lag by removing a double low-pass on
  screens.
- `6eafbc7` and `b5cc6ec` cut Whack-a-Mole delay.
- The production games are Neon Harvest and Whack-a-Mole
  (`src/client/minigames/`).
- The unmerged branch `feature/one-link-join` changes the server's room and
  screen joining.

## Scope

In:

- A map of every latency stage, measured where possible.
- An explanation of each reported symptom.
- A comparison against the spec's budgets.
- Findings.
- Options and recommendations.
- A proposed ADR.
- Follow-up backlog items.
- A headless harness that simulates network conditions and produces the
  measured numbers.

Out:

- Any change to production behavior under `src/` or `server/`.
- Any change to the wire protocol or games.
- Hosting accounts or deployments.
- Building any recommendation.

## Decisions

- **This is a review, not a rebuild.** Don't change files under `src/` or
  `server/`. Measurement code goes in `tests/` or `scripts/`, with an `npm run`
  entry if it's a script. If a number can't be measured without changing
  production code, estimate it from the code, label it _estimated_, and make the
  missing instrumentation a recommendation.
- **Baseline.** Use `origin/develop` at branch time. If `feature/one-link-join`
  has merged by then, it's included. If not, read its diff and note anything
  that changes a finding.
- **Symptoms to explain.** The user has seen all three: the cursor lagging the
  hand, hits landing late, and a second screen running behind. Each needs a
  millisecond breakdown by stage (measured or estimated) and at least one
  recommendation.
- **Options to evaluate.** For each, say what it fixes in milliseconds, what it
  costs to build, the per-game cost for authors, the hosting cost, the risks,
  and a verdict: adopt now, adopt later, or reject.
  - **Server-authoritative simulation**, in at least two placements: a single
    small server and an edge or regional platform such as Cloudflare Durable
    Objects or Fly.io. Note that local-only cleanup `f2e199c` removed the old
    Cloudflare tooling on purpose, so bringing a provider back is a decision for
    the user.
  - **Rollback**, compared with client-side prediction plus reconciliation, and
    with today's timestamp judging and 200 ms maturation.
  - **Tick-numbered input frames**, compared with today's timestamped frames plus
    reliable JSON widget values and press journal.
  - **Edge computing** for authority, relay and TURN placement, including what
    the phones can actually use (WebRTC, WebSocket, WebTransport on iOS Safari).
  - **Anything else the review finds.** Likely candidates: browser timer
    throttling of the host tab, simulation and rendering sharing the host's main
    thread, JSON snapshot size, the 25 Hz snapshot rate, and the tunnel route.
- **Offline same-room play is the review's call.** Recommend whether same-room
  play should keep working with no hosted server, and justify it.
- **Budget.** The recommended target must cost at most about $10 a month at
  hobby scale: up to 3 rooms at once, 8 players each, a few sessions a week. If
  nothing fits, say why and give the cheapest option. Also give a reference cost
  at 100 concurrent rooms. Date the prices and link their sources.
- **Game authors.** Spec §7.5 promises authors don't need determinism. Any option
  that breaks that promise must say what it would cost to retrofit Neon Harvest
  and Whack-a-Mole, and what it means for the ideas in
  [`MINIGAMES.md`](../MINIGAMES.md).
- **Devices.** Controllers are iOS Safari on an iPhone 13. Screens are laptop
  browsers. Android is untested.
- **Yardstick.** Use the spec §3.2 targets unless the review argues for changing
  them.
- **Deliverables:**
  - `docs/architecture/LATENCY-REVIEW.md`, opening with a one-screen summary.
  - `docs/ADR-002.md`, status _Proposed_, recording the recommended target
    architecture.
  - Follow-up backlog items.
  - The harness.
- **Follow-up items.** Rewrite [BL-002](BL-002-netcode-rebuild.md) into the first
  concrete item, and add further items with new IDs. Keep quick wins that fit
  the current architecture separate from the larger moves. Order them so the
  worst measured symptom is addressed first. Each item follows the template.
  Its only open questions are choices the user has to make, each with options
  and a recommendation. They stay Drafts until the user answers.

## Acceptance criteria

- [ ] `(test)` A headless harness runs the real engine, routing and playback
      code over a simulated transport with configurable one-way delay, jitter
      and loss. It reports latency per stage for the local cursor, press to
      judged outcome, press to outcome shown on each screen, and snapshot to a
      remote screen. It runs with the existing test suite or as an `npm run`
      script, and the review's measured tables come from it.
- [ ] `(doc)` The review's latency map lists every stage from the phone's sensor
      to each screen's pixels, for the cursor, press and remote-screen paths.
      Each stage names its owning file and its rate, buffer or delay constant.
- [ ] `(doc)` Each of the three symptoms has a breakdown by stage, labeled
      measured or estimated, and links to the findings behind it.
- [ ] `(doc)` A table compares each spec §3.2 target, and the spec's §4 and §7.5
      design claims, with what the code actually does or measures.
- [ ] `(doc)` Findings are numbered `F-01…`, and each has its evidence (code link
      or measurement), its impact in milliseconds or as a visible symptom, and a
      severity.
- [ ] `(doc)` Every option listed under Decisions has its gain, build cost,
      author cost, hosting cost, risks and verdict. Recommendations are numbered
      `R-01…` and cite the findings they address.
- [ ] `(doc)` The review recommends a position on offline same-room play and
      explains it.
- [ ] `(doc)` The recommended target fits the budget, or the review explains why
      not.
- [ ] `(doc)` `docs/ADR-002.md` exists with status _Proposed_.
- [ ] `(doc)` BL-002 is rewritten and any further items are added and listed in
      `docs/BACKLOG.md` under Draft, ordered as decided above.
- [ ] `(test)` `git diff origin/develop -- src server` is empty, and the usual
      checks pass.
- [ ] `(device)` On-device session reports from a LAN session and a tunnel
      session are folded into the review's measured tables before the item
      closes.

## Implementation notes

- Read before measuring. The spec and ADR-001 already argue for many of today's
  choices, such as timestamps over ticks, the 200 ms arbitration window, and the
  equalization delay `D`. The review should say plainly when those arguments
  still hold and when the measurements say otherwise.
- The "hits land late" symptom may be mostly designed-in delay rather than
  network delay: 200 ms maturation, plus `D`, plus the snapshot interval. The
  breakdown should separate them.
- Background tabs throttle `setInterval`, and the host simulation runs on one.
  Check what happens when the host screen isn't the focused tab.
- One phone limits device testing, so multi-phone effects come from the
  harness.
- Cite external sources (MDN, provider pricing, browser support tables) with
  links and access dates.

## Human test plan

This item's "test" is reading the review and capturing real numbers. You need
the item's branch checked out and the iPhone on the same Wi-Fi as the laptop.

1. Read the summary at the top of `docs/architecture/LATENCY-REVIEW.md`.
   **Expect:** for each of your three symptoms, you can tell what causes it,
   roughly how many milliseconds each cause adds, and what the recommended fix
   is.
2. Run `npm run dev:lan`. Open the printed URL on the laptop, create a room and
   join with the iPhone. Play one round of Whack-a-Mole and one of Neon Harvest,
   then click **Save session report** on the laptop. **Expect:** a JSON report
   downloads.
3. Stop the server, run `npm run dev:phone` (the tunnel) and repeat step 2.
   **Expect:** a second report downloads.
4. Optional, for the remote-screen symptom: with the tunnel running, open the
   room on a second screen (another browser or device) using the room code, join
   the iPhone to that second screen and play one round. Save a report from the
   host. **Expect:** a third report downloads.
5. Tell the agent where the reports are. **Expect:** the agent updates the
   measured tables and any finding whose conclusion changes, and says what
   changed.
6. Read ADR-002 and the drafted follow-up items, and answer their open
   questions. **Expect:** every question has options and a recommendation, and
   none of them needs a code-level answer.

## Open questions

- None.

## Handoff

_Filled in by the agent that builds this._

- **Branch / last commit:**
- **Checks:**
- **Not verified:**
- **Decisions made while building:**

## Test results

_Filled in after on-device testing: date, device, outcome of each step, and any
follow-ups._
