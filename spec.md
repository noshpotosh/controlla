# Phone-as-Controller Party Game Framework — Technical Specification

**Status:** Draft v0.1
**Date:** 2026-09-24

---

## 1. Hypothesis & Scope

### 1.1 Primary technical hypothesis

> **Can 4–8 people join an online room with their phones and have those phones
> reliably become low-latency, dynamically configured game controllers for a
> shared fullscreen game?**

Everything in this document exists to make that question answerable. Where a
design choice is made for reasons other than testing the hypothesis, it is
called out as such.

### 1.2 Product shape

A web-based multiplayer party game framework in the Mario Party mold: a
fullscreen game runs on a shared display, and each player's phone — in a plain
mobile browser, no app install — becomes their controller. Players may be in one
living room or scattered across the country; §1.3 explains why that distinction
costs almost nothing.

The phone is the interesting part. Unlike a gamepad, it can offer gyro,
accelerometer, touch, multi-touch, swipe, freehand drawing, on-screen buttons,
sliders, dials, and absolute pointing. Different minigames want radically
different subsets of these. The framework's central job is therefore
**dynamic controller reconfiguration**: telling each phone, per minigame, what
UI to render and which sensors to stream.

### 1.3 Topology: geography-independent, built from venues

**Where players are physically located must not matter.** Eight people in one
living room, eight people in eight cities, or any mix, must all work. This is a
core requirement, not a later phase.

The abstraction that makes this tractable is the **venue**:

> A **venue** is one `Display` plus the one-or-more `Controller` phones
> physically co-located with it.

| Configuration | Venues | Controllers |
|---|---|---|
| Everyone in one living room | 1 | 8 |
| Eight friends, eight cities | 8 | 1 each |
| Three households | 3 | 8 total |

Same-room play is not a separate mode; it is the single-venue case of the general
design. Nothing special-cases it.

**The key consequence, and the reason this works across a continent:** a phone
and the screen its owner aims at are *always in the same room*, by definition of
a venue. The pointer path — phone → local Display → local render — never leaves
the LAN, whatever the session's geographic spread. What crosses the internet is
game *state*, not pointer feedback. §3 splits the latency budget along exactly
this line.

**Each venue requires a screen.** A phone cannot be both the pointer and the
target it aims at, so a participant with only a phone and no second screen
cannot play. The join flow therefore starts on a screen — open the room code on a
laptop, TV, or tablet — and phones then join *that venue*. A phone that tries to
join without a venue receives a specific instruction to open a screen first, not
a generic failure.

### 1.4 Displays render locally from state snapshots — not video

Remote venues render the game themselves from authoritative state snapshots and
interpolate between them. The host does **not** encode and stream video.

Rationale:

- No encoder or decoder latency in the visual path
- No SFU or media-relay infrastructure, and no per-viewer bandwidth problem — the
  host's upstream carries a few KB/s per venue instead of megabits
- Crisp rendering at each Display's native resolution and refresh rate
- Local crosshair prediction (§5.10) becomes natural rather than a workaround

This is **not** deterministic lockstep. Displays do not simulate; they render
interpolated authoritative state. That distinction matters because lockstep would
require every minigame to be a fixed-timestep, seeded-PRNG, rollback-safe
simulation with no cross-device float drift — an enormous per-minigame tax.
Snapshot replication asks only that game state be serializable and
interpolatable (§7.5), which is a real but modest requirement.

### 1.5 Authority: the host's browser

The room creator's browser runs the simulation and is authoritative. No server is
required beyond signaling and TURN. Accepted consequences, spec'd rather than
hidden: host disconnect ends the session (§8.5), and the host's connection
quality is a floor on everyone's (§3.6). Server-authoritative operation is the
documented upgrade path if either becomes painful.

Because host-authoritative play creates real fairness asymmetries, §3.5
specifies **presentation delay equalization** as a required countermeasure.

### 1.6 Non-goals

Explicitly out of scope, listed so they do not creep in:

- **Video streaming** of the host display — superseded by §1.4
- Phone-only participants with no second screen (§1.3)
- Server-authoritative simulation (documented upgrade path, not MVP)
- Authority migration when the host drops (§8.5)
- Matchmaking, lobbies beyond a single room code, or public game discovery
- User accounts or any persistence beyond the lifetime of one session
- Spectators
- Anti-cheat
- Native mobile apps
- More than 8 concurrent players
- Cross-session leaderboards or progression

### 1.7 Technology commitments

**None.** This document specifies roles, protocol, message schemas, contracts,
and measurable budgets. Language, framework, rendering library, signaling server
implementation, and hosting are deliberately left to a separate decision record
written after the first spike. Any stack-specific reference in this document is
a bug.

---

## 2. Roles

Three roles, defined by responsibility rather than by where they run. Keeping
them strictly separate — even when co-located in one browser tab — is what makes
geography irrelevant.

### 2.1 Session

The source of truth. Owns:

- Room lifecycle and the room code
- The player roster: identity, seat assignment, display name, color
- Authority over game state and scoring
- Game sequencing: which minigame is loading, running, or finished
- Controller configuration resolution (§6)
- Clock synchronization with every client (§3.4)
- Running the authoritative simulation (§1.5)
- Computing the equalization delay `D` (§3.5)

### 2.2 Display

Renders the game fullscreen for one venue. Two distinct responsibilities:

**As a renderer** — consumes a **state snapshot stream** and nothing else. It
holds no authority and makes no decisions about shared game state. The
constraint that matters: **the Display must never reach into Session
internals**, even when it is in the same tab as the Session. It reads snapshots,
buffered by `D`. This single rule is what keeps the host from having a fresher
view than everyone else (§3.5) and is the reason remote venues work at all.

**As a venue aggregator** — it is the network entry point for its co-located
phones. Controllers connect to their local Display over the LAN; the Display
relays their input upstream to the Session and renders their locally-predicted
crosshairs immediately (§5.10).

Consequences of the aggregator role:

- The host holds **one connection per venue**, not one per phone. A single-venue
  session means one upstream peer regardless of whether 2 or 8 phones are playing.
- Input gets a LAN hop before leaving the venue (~2–5 ms), which local prediction
  makes imperceptible.
- Snapshots arrive once per venue and are shared by everyone there.

### 2.3 Controller

A phone in a mobile browser. Renders a controller UI described to it by the
Session, runs local sensor fusion and pointer transformation (§5), and emits
input frames to its **local Display**.

A Controller belongs to exactly one venue for the duration of a session.

### 2.4 Topology

Same structure at any geographic spread. The single-venue case collapses to one
browser tab with a LAN full of phones.

```
 SINGLE VENUE (same room)          MULTI-VENUE (anywhere)

 ┌────────────────────────┐        ┌─────────────────────────┐
 │ Host tab               │        │ Host tab                │
 │ ┌─────────┐ snapshots  │        │ ┌─────────┐             │
 │ │ Session │──(D=0)──▶  │        │ │ Session │ authority   │
 │ │  +auth  │   Display  │        │ │  +auth  │             │
 │ └─────────┘            │        │ └──┬───▲──┘             │
 └──────▲─────────────────┘        │    │   │  ┌──────────┐  │
        │ LAN                      │    │   │  │ Display  │  │
   ┌────┴─────┐                    │    │   └──│ (venue 0)│  │
   │  phones  │ ×2–8                └────┼───┼──└────▲─────┘  │
   └──────────┘                          │   │       │ LAN
                                snapshots│   │input  └─phones
                                         ▼   │
                                    ┌────────┴────┐
                                    │  Display    │  venue 1..N
                                    │  (remote)   │  each with
                                    └──────▲──────┘  its own phones
                                           │ LAN
                                      ┌────┴─────┐
                                      │  phones  │
                                      └──────────┘
```

Note that venue 0 — the host's own — subscribes to snapshots through the **same
buffered path** as every remote venue. That is deliberate (§3.5).

---

## 3. Latency: Budget and the Consistency Mechanism

The hypothesis asks for latency that is both **low** and **consistent**. These
are partly in tension, so this section names the budgets, then names the price
paid for consistency and for fairness.

### 3.0 Two budgets, not one

Making geography irrelevant depends on recognizing that two different delays get
conflated under the word "latency," and only one of them is affected by distance.

| | Path | Affected by distance? | Governs |
|---|---|---|---|
| **A. Motion-to-photon** | phone → local Display → local render | **No** — always LAN | How the controller *feels*: aiming, tracking, responsiveness |
| **B. Action-to-authority** | phone → local Display → Session → back | **Yes** — internet RTT | When shared outcomes resolve and when others see you |

Budget **A** is the hypothesis. It stays local by construction (§1.3) and must
meet the targets in §3.2 whether the session spans one room or one continent.

Budget **B** is unavoidable physics and is handled by fairness mechanisms (§3.3,
§3.5) rather than by trying to eliminate it.

### 3.1 Per-stage budget

The only way to argue productively about latency is to know where it goes.

**Path A — motion-to-photon (local, the feel path):**

| Stage | Typical | Notes |
|---|---|---|
| Sensor sample + fusion | 5–15 ms | Device- and OS-dependent; throttled in iOS Low Power Mode |
| Phone JS event dispatch | 1–5 ms | Worse under GC or heavy controller UI |
| Serialize + send | < 1 ms | Binary frames, §4.4 |
| Phone → local Display (LAN) | 2–10 ms | Always LAN, by definition of a venue |
| Display receive + jitter buffer | 0–20 ms | Tunable; see §3.3 |
| Local prediction + render | 8–16 ms | Own crosshair drawn locally, §5.10 |
| Render + compositor | 8–16 ms | |
| Display panel — monitor, Game Mode | 5–15 ms | |
| **Display panel — TV, no Game Mode** | **30–120 ms** | **Frequently the single largest contributor** |

**Path B — action-to-authority (crosses the internet):**

| Stage | Typical | Notes |
|---|---|---|
| Path A up to venue egress | 8–25 ms | |
| Venue → Session, P2P one-way | 5–40 ms | Same metro to cross-country |
| Venue → Session via TURN relay | +20–60 ms | Measure how often this happens |
| Simulation tick | 8–16 ms | One frame at 60 Hz |
| Snapshot → venue, one-way | 5–40 ms | |
| **Equalization delay `D`** | **0–140 ms** | **Deliberately added; §3.5. Zero at one venue** |
| Interpolation buffer | ~2 snapshot intervals | Smooths remote motion |

### 3.2 Targets

Path A — the hypothesis, and **independent of session geography**:

- **Motion-to-photon p95 < 80 ms** on a desktop monitor
- **Motion-to-photon p95 < 120 ms** on a television
- **Jitter (p99 − p50) < 15 ms**
- Input frame loss < 1% on LAN

Path B — shared-state consistency:

- **Action-to-authority p95 < 120 ms** for same-continent venues
- **Presentation-time spread across venues < 20 ms** after equalization (§3.5)
- Snapshot delivery loss < 2%, fully masked by interpolation

**The television row deserves emphasis.** A TV outside Game Mode can contribute
more latency than the entire network path combined. Enabling Game Mode (or
equivalent low-latency picture mode) is a **documented setup requirement**, and
the diagnostics HUD (§10) must make display latency visible so that panel lag is
never misdiagnosed as a networking bug. Teams routinely lose days to this.

### 3.3 Consistency is bought deliberately, per input class

A stable 45 ms feels better than a 20–90 ms range for anything requiring aim or
rhythm. Consistency is therefore purchased on purpose — but only where it helps,
because buying it uniformly would make everything sluggish.

**Continuous streams** (pointer, tilt, stick, drawing):

- A small **adaptive jitter buffer**, sized to the observed p95 one-way delay.
- **Host-side extrapolation** from the angular/linear velocity included in each
  frame, to hide the buffer's cost. Extrapolation is clamped to a maximum
  horizon to prevent overshoot when a player whips the phone.
- Net effect: the buffer removes jitter, extrapolation removes the buffer's
  added latency, and the player perceives neither.

**Discrete events** (button presses, taps, shakes):

- **Never buffered for feel.** A press is applied as soon as it is known.
- **Judged by client timestamp against the synced clock (§3.4), not by arrival
  time.** This is the important half. If judgment used arrival time, a player on
  a worse connection would be systematically penalized in exactly the reaction
  and rhythm minigames where it is most visible. With timestamp judging, the
  host accepts an event into its judgment window based on when the player
  actually acted.
- A late-arriving event outside the acceptance window is applied immediately
  rather than retroactively; minigames that need retroactive application declare
  it in their manifest.

**Contested events are arbitrated by timestamp, never by arrival order.** When
two players grab the same item or hit the same target, the winner is whoever has
the earlier client timestamp — not whoever's packet reached the Session first.
Arrival-order arbitration would hand every tie to the host's venue, which has
zero upstream delay. This rule is what makes "who got there first" mean the same
thing in every venue.

### 3.4 Clock synchronization

Everything timestamp-based depends on this, so it is established before the
protocol that carries it.

- NTP-style offset estimation over the reliable channel.
- ~10 probe exchanges on join; retain the sample with the **minimum RTT**, as it
  is the least contaminated by queueing.
- Thereafter, slow continuous correction with a low-pass filter, to track drift
  without introducing jumps.
- Offset and estimated error are exposed per player in the HUD (§10).
- Controllers sync to the **Session's** clock, not their Display's, so that all
  timestamps across all venues live in one frame of reference. The Display relays
  probes transparently.

### 3.5 Presentation delay equalization

Host-authoritative simulation creates two fairness asymmetries. Timestamp judging
(§3.3) fixes one of them. The other requires this mechanism, and without it a
host-authoritative session is measurably unfair.

**The asymmetry that timestamp judging fixes — upstream.** A remote player's
press takes longer to reach authority. Judging by synced client timestamp rather
than arrival time removes the penalty entirely.

**The asymmetry it does not fix — downstream.** The host's Display could render
authoritative state the instant it exists; a remote venue sees that state one
one-way trip plus an interpolation buffer later. Work through a reaction test
where a target appears at authoritative time `T`, and both players have identical
human reaction time `R`:

| | Sees target at | Presses at | Judged score |
|---|---|---|---|
| Host venue | `T` | `T + R` | `R` |
| Remote venue | `T + d` | `T + d + R` | `R + d` |

The remote player loses by the full downstream delay `d`, and no amount of
timestamp correction recovers it — they reacted to a staler world. In a reaction
or aim minigame this is decisive.

**The mechanism.** Every Display, *including the host's own venue 0*, renders
from a snapshot buffer delayed by a common equalization delay:

```
D = max(one-way snapshot delay) over all venues, plus a small safety margin
```

All venues then present the same authoritative state at the same wall-clock
instant, so every player reacts to an equally fresh world and §3.3's timestamp
judging becomes sufficient.

**What it costs, and what it does not.** `D` adds absolute latency to the
**shared world view only**. It does *not* touch:

- A player's **own crosshair**, which is locally predicted at their Display
  (§5.10) and therefore still meets Path A's budget.
- Controller UI responsiveness, button feedback, or haptics — all local.

So the host trades some freshness of the shared world for fairness, while losing
nothing in how their own controller feels. That is the right trade, and it is the
reason §2.2 forbids the Display from reading Session internals even when
co-located: the buffered path must be the *only* path.

**`D` is recomputed** as venues join, leave, or their conditions change, and it is
ramped rather than stepped to avoid a visible jolt. **With a single venue `D` = 0**,
so same-room play is completely unaffected by this section.

### 3.6 Residual asymmetries, stated rather than hidden

Two advantages of hosting cannot be fully erased in a host-authoritative design:

1. **The host suffers no packet loss or jitter to itself.** Remote venues do, and
   the jitter buffer mitigates but does not eliminate it.
2. **The host's connection quality is a floor on everyone's.** A host on poor
   upstream degrades every venue; no remote venue can be better than the path
   through the host.

Both are accepted for the MVP and both are removed by server-authoritative
operation, which §1.5 names as the upgrade path. Neither should be discovered by
players — the HUD (§10.1) exposes per-venue delay and `D` so asymmetry is visible
rather than mysterious.

---

## 4. Transport & Wire Protocol

### 4.1 Transport choice

**WebRTC data channels, with a WebSocket relay as fallback.** A signaling server
is used only for SDP/ICE exchange during setup; TURN relays traffic when P2P
negotiation fails, at the documented latency penalty.

WebSocket-only relay was rejected because every input would take a cloud
round-trip and TCP retransmission would spike exactly the jitter the hypothesis
cares about. WebTransport was rejected because it is client-to-server only and
its Safari support is the weak link — and iOS is roughly half the controllers.

### 4.2 Two connection tiers

The venue model (§1.3) gives a two-tier graph rather than a flat one:

| Tier | Link | Path | Notes |
|---|---|---|---|
| **Intra-venue** | Controller ↔ local Display | LAN | Carries all input; ~2–10 ms; where Path A lives |
| **Inter-venue** | Display ↔ Session | Internet | Carries relayed input up, snapshots down; one connection per venue |

This is why §2.2 makes the Display an aggregator. The host maintains one peer
connection per **venue**, so an eight-player single-venue session needs one
upstream peer rather than eight — and mDNS/local ICE candidates usually let
intra-venue links stay on the LAN without touching TURN at all.

**Intra-venue fallback.** If a Controller cannot reach its local Display (captive
portal, client isolation on the Wi-Fi, mismatched networks), it may connect
directly to the Session as a degraded path. It loses local crosshair prediction
and drops from Path A to Path B latency. The HUD must show this clearly, because
the symptom — "my aiming feels bad and nobody else's does" — is otherwise
baffling.

### 4.3 Channels

Intra-venue, per Controller:

| Channel | Mode | Carries |
|---|---|---|
| `ctrl` | Reliable, ordered | Join, capability report, controller config, clock sync, lifecycle, results |
| `input` | **Unreliable, unordered** (`maxRetransmits: 0`) | Continuous input frames |

Inter-venue, per Display:

| Channel | Mode | Carries |
|---|---|---|
| `venue-ctrl` | Reliable, ordered | Venue join, roster, config distribution, lifecycle, results, clock probes |
| `venue-input` | **Unreliable, unordered** | Aggregated input frames from all co-located Controllers |
| `snapshot` | **Unreliable, unordered** | Authoritative state snapshots (§7.5) |
| `events` | Reliable, ordered | Discrete game events for audio/VFX that must not be dropped (§7.6) |

The unreliable channels never retransmit. A late input frame or snapshot is
worthless — newer state has already superseded it — so dropping it is strictly
better than delaying the stream behind it. The `events` channel exists precisely
because a *sound cue* is not superseded by newer state and must not be lost.

### 4.4 Input frame format

Binary, target **under 60 bytes**:

```
[u8  frameType]
[u16 seq]              monotonic, wraps; used for ordering and loss detection
[u32 clientTimeMicros] against the synced clock (§3.4)
[payload]              per frameType, see below
```

- Default send rate **60 Hz**; **120 Hz** opt-in for pointer streams on capable
  devices.
- Multiple inputs occurring within one frame interval are **coalesced** into a
  single frame rather than sent separately.
- The host tracks `seq` gaps to compute loss rate per player for the HUD.

### 4.5 Loss-tolerant discrete input

This is the one protocol detail worth being insistent about.

Button state is carried as a **bitfield in every continuous input frame**,
alongside a **per-button monotonic edge counter**. The host derives presses from
counter *deltas*, not from observing a transition.

Two properties follow:

1. **A dropped packet cannot swallow a button press.** If frame *N* is lost, the
   counter in frame *N+1* still reports that the press happened, and the host
   recovers it.
2. **No press ever waits on a retransmit.** Presses ride the unreliable channel,
   so they are never queued behind TCP-style reliability machinery.

The `ctrl` channel is thereby reserved for genuinely stateful messages, which is
what reliability is actually good for.

Edge counters are sized to tolerate wrap (u8 per button is sufficient at any
humanly achievable press rate given a 60 Hz frame rate) and are reset on
controller reconfiguration.

### 4.6 Room codes

- 4–6 characters from **Crockford base32 with ambiguous glyphs removed**
  (no `I`, `L`, `O`, `U`, `0`, `1`) — these are read aloud and typed on phones.
- Case-insensitive on entry.
- **Rate-limited** against enumeration, per source and globally.
- Expire with the session; never reused while a session is live.

---

## 5. Pointer Calibration

This section carries the most design risk in the document, so the math is worked
out concretely rather than gestured at.

### 5.1 Goal

Give the phone Wii-remote-style absolute pointing: aim at a spot on the shared
display and have a cursor appear there. Calibrate once per player per session;
recover from drift with a single tap and **no recalibration**.

Each Controller calibrates against **its own venue's Display** (§1.3) — the
screen physically in front of its owner. Because output is normalized (§5.6) and
every venue renders the same canonical viewport (§5.7), a pointer calibrated
against a 55" TV in one city and one calibrated against a laptop in another mean
the same thing in game space.

### 5.2 Orientation source, and a deliberate omission

- **Gyroscope** integration provides angular rate.
- **Accelerometer** gravity vector provides absolute pitch and roll correction.
- **Gyro bias is estimated while the device is stationary** and subtracted.
- **No magnetometer.** Web compass data (`webkitCompassHeading`, absolute
  `deviceorientation`) is inconsistent and unreliable across iOS and Android,
  and a wrong heading is worse than no heading.

The consequence must be stated plainly because it drives the rest of the design:

> **Pitch and roll are drift-free. Yaw drifts.**

Yaw has no absolute reference, so integrated gyro error accumulates. This is
exactly why the recenter affordance (§5.8) is **load-bearing** rather than a
convenience feature.

### 5.3 Calibration procedure

The player is prompted to:

1. Hold the phone aimed at the **center of the display**, and tap. → `q_center`
2. Aim at each of the **four corners** in turn, tapping each.
   → `q_TL`, `q_TR`, `q_BR`, `q_BL`

Five samples, five taps, a few seconds.

### 5.4 Calibration produces two *separable* artifacts

This separation is the crux of the whole design — it is what makes one-tap
recenter possible.

1. **Reference orientation `q_ref`** — from the center tap. *Where the player is
   pointing when they mean "center."*
2. **Shape mapping `H`** — from the four corner taps. *How much rotation
   corresponds to how much screen.*

### 5.5 The mapping: a homography, not per-axis gains

For a sample orientation `q`:

1. Compute the **relative rotation** `r = q_ref⁻¹ · q`.
2. Take `r`'s forward vector `v`.
3. Project to **tangent-plane coordinates** `(tan(yaw), tan(pitch))`, derived
   from `v`.
4. Apply the homography `H` to obtain normalized screen coordinates.

`H` is a 2D homography fit from the four corner samples to the unit square
(8 degrees of freedom, 4 point correspondences — exactly determined).

**Why a homography rather than independent per-axis gains.** Gnomonic projection
followed by a homography *is* a pinhole camera viewing a rectangle off-axis. It
is not an approximation; it is the correct model. With 4–8 players seated around
one television, most of them are meaningfully off-axis, and independent per-axis
gains produce visible keystone error for them — the cursor drifts toward one
side of the screen as they aim across it. A homography handles off-axis seating
for free, at the cost of a 3×3 matrix instead of two scalars.

### 5.6 Output space: normalized, never pixels

Pointer output is **normalized `(0,0)`–`(1,1)`**, with `(0.5, 0.5)` at screen
center. Never device pixels.

This makes behavior identical across a 1080p television, a high-DPI laptop, and
(later) a remote streamed view at any resolution, and it means the calibration
artifacts survive a display change without refitting.

### 5.7 Canonical viewport: normalized space must mean one thing

Normalized coordinates only unify venues if `(0.9, 0.9)` denotes the *same game
position* everywhere. Venues will not agree on aspect ratio — a 16:9 television,
a 16:10 laptop, an iPad at 4:3 — so this requires an explicit rule.

**The Session defines a canonical viewport aspect ratio** (16:9) as part of the
session, and every Display renders that viewport **letterboxed or pillarboxed**
to fit its physical screen. Normalized `(0,0)`–`(1,1)` addresses the *canonical
viewport*, never the physical panel.

Two consequences that must be honored:

1. **Calibration corner taps target the canonical viewport's corners** — the
   corners of the letterboxed game area, not the corners of the physical screen.
   The calibration UI must draw the letterbox bars so the player aims at the right
   place; otherwise `H` is fit to the wrong rectangle and every subsequent aim is
   scaled slightly wrong.
2. **Gameplay-relevant content never enters the letterbox bars.** They are inert.

Without this rule, a player aiming at "top-right" hits a different game position
depending on the shape of their television, which would silently break
cross-venue aiming in a way that looks like a calibration bug.

### 5.8 Recenter

`H` is defined on the tangent plane of the **relative** rotation `r`. Re-zeroing
that frame therefore leaves `H` valid.

**Recenter rewrites only `q_ref`** — setting it so that the current device pose
maps to screen center — and **does not touch `H` at all.** The player taps one
button, the cursor snaps to center, and the previously-calibrated screen
dimensions still apply. No corner re-taps.

Because yaw is the axis that drifts (§5.2) and recenter's dominant effect is to
re-zero yaw, this addresses the actual failure mode rather than a hypothetical
one.

**One caveat to surface in the UI:** if the player's **roll** has changed
substantially since calibration — they have rotated the phone in their hand, or
moved to a different seat — `H` degrades, because the shape fit assumed a
particular roll. Recenter cannot fix that. A secondary "recalibrate" escape
hatch must remain reachable at all times, and the pointer confidence metric
(§10) should hint when recalibration would help.

### 5.9 Where the transform runs: on the phone

The phone computes normalized pointer coordinates and sends those, not raw
orientation. Rationale:

- The sensor fusion already lives on the phone; splitting it would duplicate
  state.
- Calibration stays local to the device that produced it.
- The phone can draw a **local preview crosshair at zero latency**, which is
  valuable feedback during calibration and essential if a remote-Display mode is
  ever added.
- It shrinks the packet.

Each pointer frame carries:

| Field | Purpose |
|---|---|
| Normalized `(x, y)` | The pointer position |
| Angular velocity | Host-side extrapolation (§3.3) |
| Confidence / staleness | Drift and fusion-quality hint |

The raw quaternion is additionally sendable behind a **debug flag**, so that
host-side re-derivation is possible when diagnosing calibration problems.

### 5.10 Local crosshair prediction

This is what makes pointing feel identical whether the session spans a couch or a
continent.

**A Display renders its own venue's crosshairs from local input, immediately** —
not from authoritative snapshots. The phone is on the same LAN (§4.2), so the
round trip is Path A, and the cursor tracks the hand with no internet delay in the
loop. Crosshairs belonging to *other* venues' players are drawn from snapshot
state like any other game object.

The split, stated as a rule:

> **Your cursor is local. Your outcomes are authoritative.**

- The cursor a player sees is their own device's opinion, at Path A latency.
- Whether they *hit* anything is decided by the Session from the timestamped input
  (§3.3), at Path B latency.

A hit therefore resolves slightly after the trigger pull, which is normal and
imperceptible, while aiming itself never lags. Getting this backwards — drawing
your own cursor from authoritative snapshots — would put a full internet round
trip between hand and cursor and make remote pointing unusable. That failure mode
is the single most likely way to get this architecture wrong.

**Reconciliation.** When the authoritative position of a player's own cursor
disagrees with the local prediction, the **local value wins for rendering** to
that player. No snapping or rubber-banding of one's own cursor: it is
proprioceptive, and correcting it visibly feels like a malfunction. Divergence is
bounded in practice because the phone is the sole source of pointer data — the
Session is not simulating the cursor, merely relaying and arbitrating against it.

**Recenter is local too**, taking effect on the player's own Display immediately
while propagating upstream at Path B latency.

### 5.11 Failure and edge cases

- **Motion permission denied** (§9) → pointer unavailable; the framework must
  resolve a fallback controller config (§6.4).
- **Calibration taps too close together** (player did not actually move) →
  degenerate homography; detect via conditioning and re-prompt.
- **Aiming off-screen** → coordinates outside `(0,0)`–`(1,1)` are reported
  truthfully and clamped by the consumer, not by the transform, so minigames can
  choose their own edge behavior.

---

## 6. Controller Configuration Schema

### 6.1 Shape

Declarative JSON, **versioned**. A minigame declares what it needs; the
framework resolves a concrete configuration per player and sends it over `ctrl`.
The phone is a renderer of configurations, not a repository of per-game code —
adding a minigame must never require shipping new controller code.

```jsonc
{
  "schemaVersion": 1,
  "configId": "shooter-v1",
  "orientation": "portrait",        // portrait | landscape | any
  "sensors": {
    "pointer":   { "enabled": true,  "rateHz": 120 },
    "tilt":      { "enabled": false },
    "shake":     { "enabled": true,  "thresholdG": 1.8 },
    "accel":     { "enabled": false }
  },
  "haptics": { "enabled": true },
  "widgets": [
    {
      "id": "fire",
      "type": "button",
      "rect": [0.60, 0.70, 0.35, 0.20],   // normalized x, y, w, h
      "label": "FIRE",
      "style": "primary",
      "action": "fire"                     // semantic binding
    },
    {
      "id": "reload",
      "type": "hold-meter",
      "rect": [0.05, 0.70, 0.35, 0.20],
      "label": "RELOAD",
      "holdMs": 800,
      "action": "reload"
    }
  ]
}
```

### 6.2 Widget primitives

The phone implements a fixed vocabulary. Minigames compose from it; they do not
extend it.

| Widget | Emits |
|---|---|
| `button` | Discrete press/release + edge counter (§4.5) |
| `dpad` | 4- or 8-way direction state |
| `stick` | Continuous 2D vector, normalized, with deadzone |
| `swipe-pad` | Swipe vectors: direction, distance, velocity |
| `draw-canvas` | Point stream with pressure/radius where available |
| `slider` | Continuous scalar |
| `dial` | Continuous angle, unwrapped |
| `hold-meter` | Progress 0–1 plus completion event |
| `tilt` | Device pitch/roll as a 2D vector |
| `shake` | Discrete shake events above a threshold |
| `pointer` | Normalized `(x, y)` + angular velocity (§5.9) |
| `text` | Short string, submitted |

Each widget carries an `id`, a **normalized `rect`**, presentation
(`label`, `style`), and a **semantic `action` binding** so the minigame reasons
about `"fire"` rather than about which rectangle was touched.

### 6.3 Capability negotiation is bidirectional

The framework telling the phone what UI to render is only half of the exchange.
**The phone must first report what it actually has.** On join, over `ctrl`:

```jsonc
{
  "type": "capabilityReport",
  "sensors": {
    "gyro":  { "present": true,  "permission": "granted" },
    "accel": { "present": true,  "permission": "granted" }
  },
  "maxTouchPoints": 5,
  "vibration": false,               // iOS Safari: commonly false
  "refreshRateHz": 120,
  "devicePixelRatio": 3,
  "safeAreaInsets": { "top": 47, "bottom": 34, "left": 0, "right": 0 },
  "viewport": { "w": 393, "h": 852 }
}
```

`permission` is a first-class field, distinct from `present`. A phone that *has*
a gyroscope but whose owner **declined the motion prompt** is functionally
identical to one without a gyroscope, and the framework must treat it that way.
Without this distinction, a denied iOS permission presents to the player as an
unexplained dead controller — a failure mode that is easy to ship and hard to
diagnose.

### 6.4 Resolution and fallbacks

A minigame manifest declares inputs as **required** or **optional**, and every
input declares a **fallback**:

```jsonc
{
  "inputs": {
    "aim":  { "required": true,  "prefer": "pointer", "fallback": "stick" },
    "fire": { "required": true,  "prefer": "button" },
    "taunt":{ "required": false, "prefer": "shake",   "fallback": null }
  }
}
```

Resolution algorithm, per player:

1. Intersect the minigame's preferred inputs with the player's reported
   capabilities.
2. For each unsatisfiable input, substitute its declared fallback.
3. If a **required** input has no satisfiable fallback, the player cannot
   participate: the Session surfaces a specific, actionable reason
   ("Motion access is off — tap to enable") rather than a generic error.
4. Emit the resolved config; record the substitutions in telemetry so that
   fallback frequency is measurable.

Resolution is **per player**, so a session can mix an iPhone using pointer aim
with an older Android using stick aim in the same minigame.

---

## 7. Minigame Lifecycle Contract

### 7.1 Manifest

```jsonc
{
  "id": "target-range",
  "name": "Target Range",
  "players": { "min": 2, "max": 8 },
  "inputs": { /* §6.4 */ },
  "controllerConfigs": { "default": "shooter-v1" },  // optionally per-role
  "expectedDurationSec": 60,
  "scoring": "points",              // points | rank | time | elimination
  "onPlayerDropped": "substitute",  // pause | substitute | freeze
  "retroactiveInput": false         // §3.3
}
```

### 7.2 Lifecycle

```
load ──▶ ready ──▶ configure(players) ──▶ countdown ──▶ start
                                                          │
                                        ┌─────────────────┘
                                        ▼
                              frame(inputSnapshot, dt) ──▶ … ──▶ end ──▶ results
```

| Phase | Responsibility |
|---|---|
| `load` | Fetch assets; no session state touched |
| `ready` | Declare loaded; framework may hold here |
| `configure(players)` | Receive resolved roster + per-player resolved input map |
| `countdown` | Framework-owned; controllers show "get ready" |
| `start` | Simulation begins |
| `frame(inputSnapshot, dt)` | One tick; the only place input is read |
| `end` | Simulation stops; no further input consumed |
| `results` | Return per-player score, rank, and stats to the Session |

### 7.3 Division of responsibility

**The framework owns:** fullscreen, the audio bus, the player roster, identity,
the scoreboard, transitions between minigames, controller configuration, the
diagnostics HUD, and all networking.

**The minigame owns:** its own simulation, its own rendering within the surface
it is given, and its scoring.

A minigame never opens a connection, never learns a player's transport details,
and never renders framework chrome.

### 7.4 The mechanism is deliberately deferred — and one constraint keeps it open

Whether minigames run in a **sandboxed iframe** (crash isolation, independent
authoring, `postMessage` serialization cost) or as **same-page ES modules**
(zero serialization, no isolation) is left to be decided after measuring
`postMessage` overhead at 8 players × 120 Hz.

To keep that decision genuinely open, one binding constraint applies now:

> **The input snapshot passed to `frame()` must be structured-clone-able, with no
> shared object references and no functions.**

Honor it and the identical contract works across `postMessage` *or* as a direct
call. Violate it — by handing the minigame a live reference into Session state —
and the iframe option silently disappears, turning a measurement into a
guess already made.

The same constraint applies to `results` and `configure` payloads.

### 7.5 Required: snapshot-serializable, interpolatable state

Because remote venues render locally from authoritative state (§1.4), every
minigame must expose its state as snapshots. This is the one genuine tax the
geography-independence requirement imposes on minigame authors, and it is worth
stating plainly rather than discovering later.

Each minigame must provide:

| Obligation | Detail |
|---|---|
| `snapshot()` | Serialize render-relevant state to a structured-clone-able value |
| `applySnapshot(s)` | Reconstruct render state on a non-authoritative Display |
| **Interpolatable fields** | Positions, rotations, and scales declared so the Display can smooth between snapshots |
| **Discrete fields** | Values that must *not* be interpolated (scores, lives, phase, text) declared explicitly |

Rules:

- Snapshots are emitted at **20–30 Hz**, not per frame, and are **delta-compressed**
  against the last acknowledged snapshot.
- Displays render at full refresh rate by **interpolating** between the two most
  recent snapshots, which is why the interpolated/discrete distinction is
  mandatory: interpolating a score produces visible nonsense.
- Snapshots carry only what is needed to *render*. Internal simulation state stays
  on the host.
- State must be bounded — no unbounded growth over a round, or snapshot size drifts
  upward mid-game.

**What this is not.** Minigames do **not** need to be deterministic, use seeded
PRNGs, avoid float drift, or support rollback. They are not simulated remotely,
only rendered. This is a far lighter obligation than lockstep (§1.4), and for
small party minigames it typically amounts to a handful of arrays of positions.

### 7.6 Game events

Rendering from interpolated state cannot express things that *happen*. A sound
cue, a screen shake, a particle burst, or a score-popup is an instant, not a
state, and a snapshot that arrives after it would miss it entirely.

Minigames therefore also emit **discrete game events**, delivered over the
reliable `events` channel (§4.3) and timestamped so each Display can fire them at
its equalized presentation time (§3.5). Events are for presentation only; they
never carry authoritative state, so a duplicate is harmless and a reordering is
correctable by timestamp.

Audio is played **locally at each venue** from this event stream — never streamed
from the host.

---

## 8. Identity, Disconnect, and Reconnect

### 8.1 Identity

On first join the Session issues:

- a `playerId` (opaque, unique within the session), and
- a **signed resume token**, persisted in `localStorage`.

Seat, display name, and color are bound to the `playerId` and persist for the
whole session, across minigames.

**Venues also have identity.** A `venueId` is issued when a Display joins, and
each `playerId` records its venue. Displays get their own resume token, so a
reloaded or briefly-dropped Display rejoins as the same venue with its phones
still attached rather than orphaning them.

### 8.2 Reconnect

Presenting a valid resume token restores **the same seat, name, and color** —
the player returns as themselves, not as a new participant. Token signature is
verified so a seat cannot be hijacked by guessing a `playerId`.

A **60-second grace period** applies: within it the seat is reserved and the
roster shows the player as disconnected rather than removing them.

### 8.3 In-game policy is the minigame's to choose

The framework raises `onPlayerDropped` and `onPlayerReturned`; it does not decide
what they mean. The manifest (§7.1) declares one of:

- `pause` — halt the minigame until the player returns or the grace period ends
- `substitute` — an AI takes over the avatar
- `freeze` — the avatar remains, inert

A framework-level default would be wrong for some genre in every case, which is
why this is delegated rather than centralized.

### 8.4 What must not happen

Per the MVP criteria, a disconnect/reconnect must not destroy the session. The
specific guarantees:

- The Session survives any Controller disconnecting, including all of them.
- A minigame in progress either continues under its declared policy or ends
  cleanly with partial results — it never hangs.
- A reconnecting player receives current controller configuration
  automatically, without needing to re-tap through a join flow.
- **Pointer calibration survives reconnect** (cached on the phone, keyed by
  session *and venue*), so a player who briefly drops does not recalibrate.

### 8.5 Venue and host failure

The venue model introduces two failure modes beyond a single phone dropping.

**A non-host Display drops.** Its co-located Controllers lose their aggregator and
therefore their screen. Required behavior:

- Those players are marked disconnected; the rest of the session continues
  normally under each minigame's declared policy (§8.3).
- Their phones show "reconnecting — your screen went away," not a generic error,
  since the actionable fix is on the other device.
- On Display return, its phones reattach automatically with calibration intact.
- `D` is recomputed (§3.5) when a venue leaves or returns.

**The host drops.** Because authority lives in the host's browser (§1.5), this
**ends the session.** Required behavior is honesty and damage limitation, not
recovery:

- Every venue is told the session ended and why — not left staring at a frozen
  frame.
- Results from completed minigames are surfaced before teardown, so a session that
  dies in game four still shows what happened in games one through three.
- The host is warned before actions that would end a live session (tab close,
  navigation) via `beforeunload`.

Authority migration is explicitly out of scope (§1.6). Server-authoritative
operation removes this failure mode entirely and is the upgrade path if hosting
turns out to be too fragile in practice — risk #3 in §12.

---

## 9. Mobile Browser Reality Check

These are the failure modes that reliably break phone-as-controller projects.
They are listed as requirements so they are designed for rather than discovered
during a playtest.

### 9.1 iOS motion permission requires a user gesture

`DeviceOrientationEvent.requestPermission()` **must be called from a user
gesture** and cannot be invoked silently. The join flow therefore requires an
explicit **"Enable motion"** tap, with copy explaining why, and a visible
recovery path if the player declines — since a denial is permanent for the origin
until the browser's site settings are changed. This interacts directly with
§6.3's `permission` field and §6.4's fallback resolution.

### 9.2 Screen sleep

A phone held as a controller with infrequent touches **will sleep**. Acquire a
**Screen Wake Lock** where available, note that support is uneven, and provide a
fallback nudge. A sleeping controller is indistinguishable from a broken one to
the player.

### 9.3 Backgrounding

Switching apps or receiving a call tears down sensors and can drop the
connection. Required behavior: detect via visibility/pagehide events, show an
unambiguous "reconnecting" state, and **recover automatically** on return —
including re-requesting sensor streams, which do not always resume on their own.

### 9.4 Audio

Audio output requires a user gesture to unlock. If controllers produce sound or
haptic-substitute feedback, unlock during the join tap, not at first use.

### 9.5 Viewport and touch

- Lock the viewport against zoom, scroll, bounce, and pull-to-refresh — all of
  which are catastrophic on a controller surface.
- Register touch listeners **non-passive** with `preventDefault`, since passive
  listeners cannot suppress scrolling.
- Respect `safeAreaInsets` (§6.3): widget rects must not land under a notch or a
  home indicator.
- Suppress double-tap-to-zoom and long-press selection/callouts.

### 9.6 Timing variability

- **ProMotion 120 Hz vs. 60 Hz** displays change both input sampling
  opportunities and perceived latency.
- **Android sensor rates vary widely** by device and vendor; requested rates are
  advisory.
- **iOS Low Power Mode throttles sensor delivery** and animation frames — a
  plausible cause of a player reporting lag that reproduces nowhere else. The HUD
  should expose observed per-player input rate (§10) so this is visible.

### 9.7 Display client requirements

The Display is a different browser on a different class of device, with its own
constraints.

- **Fullscreen** requires a user gesture, and a TV-connected laptop may report
  odd available dimensions. Render the canonical viewport (§5.7) and letterbox.
- **Game Mode on televisions** is a documented setup step (§3.2). The Display
  should show measured display latency prominently during setup so a mispicked
  picture mode is caught before anyone blames the network.
- **Screen savers and display sleep** must be suppressed for the session duration.
- **Background throttling**: a backgrounded or minimized Display gets throttled
  animation frames. For the host this degrades everyone, so warn explicitly if the
  host's tab loses visibility.
- **Local network reachability** is required for intra-venue links. Guest networks
  with client isolation break phone→Display connections; detect this and surface
  the degraded direct-to-Session path (§4.2) rather than failing silently.
- **Audio output** lives at the Display, not the phone (§7.6), and needs the usual
  gesture to unlock.

---

## 10. Instrumentation & Validation

The hypothesis is quantitative, so measurement is part of the specification
rather than an afterthought. Three layers, each covering the others' blind spots.

### 10.1 Always-on diagnostics HUD

Per player, toggleable on the Display:

- Clock offset and estimated sync error (§3.4)
- RTT **p50 / p95 / p99**
- Jitter (p99 − p50)
- Input frame loss rate, from `seq` gaps (§4.4)
- Observed input rate in Hz, versus configured rate
- Age of the most recent applied frame
- Jitter-buffer depth and current extrapolation horizon (§3.3)
- Pointer confidence / staleness (§5.9), and calibration age
- Transport path: **direct P2P vs. TURN relay** — because §3.1's penalty makes
  this the first thing to check when one player feels worse than the others
- Fallback substitutions in effect (§6.4)
- **Which path the Controller is on**: intra-venue LAN (Path A) or the degraded
  direct-to-Session fallback (§4.2)

Per venue:

- Action-to-authority RTT p50/p95/p99 (Path B)
- One-way snapshot delay, and the venue's contribution to `D`
- **The current equalization delay `D`**, plus which venue is setting it — so
  "everything feels sluggish" resolves immediately to "someone's on hotel Wi-Fi"
- Snapshot rate, snapshot size, and delta-compression ratio
- Interpolation buffer depth and any snapshot starvation events
- Measured display latency and whether Game Mode appears to be on

Percentiles, not averages: a mean RTT hides exactly the tail that ruins aiming.

**Both budgets are reported separately (§3.0).** Collapsing them into one number
is the fastest way to misdiagnose this system — a session can have excellent Path
A feel and poor Path B fairness, or the reverse, and the fixes are unrelated.

### 10.2 Camera ground truth

Software timers are **structurally blind** to sensor sampling delay and the
display pipeline — frequently 30–60 ms in combination, and on a non-Game-Mode TV
considerably more. In-app numbers alone will therefore be optimistic, and
optimistic in a way that no amount of additional instrumentation can detect.

Procedure, run once per hardware configuration:

1. Film the player's hand and the display together at **240 fps**.
2. Count frames from the onset of physical motion to the first pixel change.
3. Divide by frame rate for true **motion-to-photon** latency.
4. Compare against the HUD's reported figure; the difference is the
   uninstrumentable remainder, and it should be recorded per display.

This anchors every software measurement to physical reality. Without it, §3.2's
targets are unfalsifiable.

### 10.3 "Latency Lab" — the benchmark minigame

Validation is built as a **playable minigame**, so it can be run by anyone, at
any time, on any hardware, and demoed rather than described.

| Mode | Measures |
|---|---|
| **Reaction** | Flash a target, record tap-to-flash interval. Isolates discrete-input latency and exercises timestamp judging (§3.3). |
| **Tracking** | A dot moves; the player follows it with the pointer. Records RMS aim error and phase lag — sensitive to pointer latency, extrapolation quality, and calibration accuracy simultaneously. |
| **Strobe** | Alternates high-contrast full-screen states on a known input, purpose-built to be filmed for §10.2. |
| **Fairness** | Identical reaction prompt fired simultaneously at every venue; compares judged scores across venues. A systematic advantage for any venue means equalization (§3.5) is misconfigured. This is the direct test of whether host-authoritative play is actually fair. |

Latency Lab doubles as the **calibration smoke test** and as the first minigame
built, since it exercises pointer, discrete input, multi-player join, and results
reporting — most of the MVP criteria — before any "real" minigame exists.

### 10.4 Reporting

Each session writes a summary: per-player percentiles, loss, transport path,
fallbacks, calibration count, recenter count, and disconnect events. **Recenter
frequency is the empirical measure of yaw drift** (§5.2) and directly answers
whether the recenter affordance is sufficient or whether drift needs a better
mitigation.

---

## 11. MVP Acceptance Criteria

Each criterion with the mechanism that demonstrates it.

| # | Criterion | Demonstrated by |
|---|---|---|
| 1 | One person creates a session | Host opens the framework; Session created (§2.1) |
| 2 | Host gets a short room code | 4–6 char unambiguous code displayed (§4.6) |
| 3 | 4–8 players join from mobile browsers, **any geography** | Code entry on phones; roster fills across 1..N venues (§1.3, §2.3) |
| 4 | Players get persistent identities | `playerId` + signed resume token; seat/name/color stable across minigames (§8.1) |
| 5 | Host sees all connected players | Roster on Display with per-player connection state (§2.1) |
| 6 | Host can start a game | Framework transitions to `load` (§7.2) |
| 7 | Framework dynamically configures each phone | Resolved config pushed over `ctrl`; phone re-renders from schema (§6) |
| 8 | Phones provide multiple input types | Latency Lab uses pointer + button; second minigame uses tilt + swipe (§6.2) |
| 9 | Input latency is low and consistent | HUD percentiles meet §3.2 targets; camera-anchored (§10.1–10.2) |
| 10 | At least one motion-based input works | Pointer aim in Latency Lab tracking mode (§5) |
| 11 | At least one conventional input works | Button press in Latency Lab reaction mode (§6.2) |
| 12 | Pointer calibration works against the host display | 5-tap procedure; tracking-mode aim error within tolerance (§5.3–5.5) |
| 13 | Pointer re-centering works without recalibration | Recenter rewrites `q_ref` only; `H` unchanged and still correct (§5.8) |
| 14 | Game runs fullscreen on the host display | Framework owns fullscreen (§7.3) |
| 15 | Game can end and return control | `end` → `results` → framework shell (§7.2) |
| 16 | Results reported back to the session | `results` payload recorded in the roster/scoreboard (§7.2) |
| 17 | A second game launches with a *different* controller config | Minigame 2 declares a different config; phones re-render without reload (§6, §7) |
| 18 | Disconnect/reconnect doesn't destroy the session | Kill a phone's connection mid-game; per §8.4 guarantees |

Additional criteria from the geography-independence requirement (§1.3):

| # | Criterion | Demonstrated by |
|---|---|---|
| 19 | A session works with all players in one room | 1 venue, 4–8 phones; `D` = 0 (§2.4) |
| 20 | A session works with players in different cities | ≥2 venues, ≥1 phone each; identical minigames playable (§1.3) |
| 21 | A mixed session works | ≥2 venues with uneven phone counts (§1.3) |
| 22 | Pointer feel does not degrade with distance | Path A p95 meets §3.2 at a remote venue, equal to same-room (§5.10) |
| 23 | Remote venues render correctly, not as video | Snapshot-driven local render at native resolution (§1.4, §7.5) |
| 24 | No venue has a scoring advantage | Latency Lab **Fairness** mode shows no systematic bias (§10.3, §3.5) |
| 25 | Aiming means the same thing on differently-shaped screens | Calibrate on 16:9 and 4:3 venues; same game-space result (§5.7) |
| 26 | A venue's Display dropping doesn't kill the session | Close a non-host Display; others continue (§8.5) |

### 11.1 Two minigames are required

Criterion 17 — dynamic reconfiguration between games — is the one that actually
tests the framework's central claim. A single minigame cannot distinguish a
framework from a game. Both are intentionally lightweight and exist only to prove
the concept.

- **Minigame 1 — Latency Lab** (§10.3): pointer + button, plus the Fairness mode
  that validates §3.5.
- **Minigame 2** — deliberately different: tilt-steering or swipe-based, with *no*
  pointer, proving sensors are torn down and reconfigured correctly.

### 11.2 Validation order

Geography-independence is a requirement, but validating it *first* would confound
the hypothesis — if aim feels wrong in a two-city session you cannot tell whether
the cause is the pointer pipeline or the network. So validate in this order, which
is about isolating variables, not about deferring scope:

1. **Single venue** — criteria 1–19. Establishes Path A in isolation: if
   motion-to-photon fails here, distance is irrelevant and the pointer design is
   what needs to change.
2. **Two venues, same city** — criteria 20–26 with low Path B latency. Exercises
   the whole venue/snapshot/equalization machinery without large delays hiding
   bugs in it.
3. **Two venues, cross-country** — the real test. Confirms Path A is genuinely
   unaffected by distance and that equalization holds at 60–80 ms one-way.
4. **Adversarial** — one venue on deliberately bad Wi-Fi; confirm `D` adapts, that
   the bad venue is identifiable in the HUD, and that it degrades the session
   gracefully rather than mysteriously.

---

## 12. Risks & Open Questions

Ranked by how much design they can invalidate, each with its intended probe.

| # | Risk | Probe |
|---|---|---|
| 1 | **Homography stability for steeply off-axis players.** The model is correct for a pinhole viewing a rectangle, but fit quality from only 4 hand-aimed taps is unproven — and hand tremor at a corner has outsized leverage. | Calibrate from several seats including ~60° off-axis; measure tracking-mode aim error vs. angle. Consider requiring a 5th confirmation tap. |
| 2 | **Yaw drift rate in practice.** Determines whether recenter is a per-session or a per-minute annoyance. If the latter, the design needs a better mitigation. | Log recenter frequency (§10.4) across a full multi-game session on several devices. |
| 3 | **Motion-to-photon latency may simply exceed target.** The hypothesis could fail on physics — sensor plus display latency are largely outside our control. | Camera measurement (§10.2) early, before building minigames. This is the go/no-go probe. |
| 4 | **Intra-venue LAN connections may not be reachable.** Guest Wi-Fi client isolation, captive portals, and phones on cellular while the Display is on Wi-Fi all break the phone→Display link that Path A depends on. If this is common, the local-prediction advantage evaporates for those players. | Test across home, guest, and mobile-hotspot networks; measure how often the §4.2 degraded path is used. |
| 5 | **Equalization delay `D` may feel bad even though it is fair.** One venue on poor Wi-Fi drags every venue's presentation latency up. Fair is not the same as fun. | Playtest with a deliberately handicapped venue; consider capping `D` and accepting bounded unfairness beyond the cap. |
| 6 | **Host disconnect ends the session** (§8.5), and the host's upstream is a floor on everyone's (§3.6). A flaky host ruins sessions in a way players will blame on the game. | Measure host-drop frequency in real sessions; if material, promote server-authoritative from upgrade path to requirement. |
| 7 | **Snapshot interpolation quality for fast-moving objects.** At 20–30 Hz, fast motion may visibly stutter or rubber-band on remote venues even with interpolation. | Build minigame 2 with deliberately fast motion; compare remote venue against host venue side by side. |
| 8 | **TURN fallback frequency between venues.** If common rather than rare, the §3.1 penalty becomes the typical case. | Instrument transport path (§10.1) across several household router configurations. |
| 9 | **`postMessage` overhead at 8 players × 120 Hz**, which decides §7.4. | Microbenchmark structured-clone of a realistic input snapshot at target rate before choosing the mechanism. |
| 10 | **iOS motion-permission friction in the join flow.** A permanent denial early in onboarding is unrecoverable without site-settings surgery. | Playtest the cold-start flow with players who have never used the app. |
| 11 | **Clock sync quality across the internet** under load. Timestamp judging (§3.3) and equalization (§3.5) are both only as fair as the sync, and the sync now spans venues rather than a LAN. | Compare estimated offset against a known-good reference while saturating channels, cross-country. |
| 12 | **Snapshot state tax on minigame authoring** (§7.5). Modest in principle, but if it turns out to dominate the cost of writing a minigame, the framework's value proposition weakens. | Write minigame 2 and honestly record how much of the effort was snapshot plumbing. |

### 12.1 Deliberately deferred

- Video streaming of the host display — rejected in favor of snapshot replication (§1.4)
- Server-authoritative simulation and authority migration (§1.5, §8.5)
- Phone-only participants without a second screen (§1.3)
- iframe vs. ES module for minigames (§7.4)
- Stack, framework, and hosting (§1.7)

### 12.2 Recommended first spike

Before building framework surface area, attack risks **1** and **3** together —
they are the two that can invalidate the most design, and both are cheap to test:

1. A bare page that does sensor fusion, 5-tap calibration, homography fit, and
   pointer output with a local crosshair.
2. A minimal host that renders the cursor and nothing else.
3. Camera-measure motion-to-photon on both a monitor and a TV.
4. Measure aim error from three seats, including hard off-axis.

If the pointer feels right and the numbers land inside §3.2, the pointer design is
sound. If it does not, the pointer design — not the framework — is what needs to
change, and finding that out in a day is worth considerably more than a working
lobby.

Note that this spike needs **no networking at all**: phone and Display on one LAN,
no Session, no snapshots. That is a direct consequence of §3.0 — Path A is where
the hypothesis lives, and Path A never leaves the venue.

### 12.3 Second spike: two venues

Only once Path A is proven, validate the part that makes geography irrelevant.
Attack risks **4**, **5**, and **7**:

1. Two venues, one authoritative, exchanging snapshots for a single moving object.
2. Measure Path B one-way delay and verify `D` equalizes presentation across both.
3. Run Latency Lab's **Fairness** mode and confirm no venue wins systematically.
4. Confirm the remote venue's own crosshair still meets Path A — the load-bearing
   claim of the whole design, and the one most likely to be accidentally broken by
   drawing one's own cursor from snapshots (§5.10).
5. Deliberately degrade one venue's network and watch `D`, the HUD, and whether the
   session stays pleasant or merely stays correct.

If step 4 fails, re-read §5.10 before changing anything else; it is almost always
the cause.

