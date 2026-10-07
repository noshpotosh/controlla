# Milestone 1 shared-contract proposal

Status: proposed, not implemented or approved. Owner and shared-contract reviewer:
requesting user (`@noshpotosh`). This proposal is the checkpoint 0 review artifact.
All signatures below describe the target APIs; existing imports retain their
ownership. Runtime changes must follow approval and test-discovery repair.

## Current inventory and extension boundaries

| Contract | Current owner / entry point | Proposed change |
| --- | --- | --- |
| Game author API | `src/client/api/index.ts`; both game descriptors | timing, seed, fixed roles, tick results, declarative sound |
| Controller semantics / layouts | `src/client/controls/api.ts`, `registry.ts`, `resolve.ts`, `value.ts` | pure motion registration, impulse validation, retired widget rejection |
| Sensor permission / epochs | `controls/motion/provider.ts`, `processor.ts`, `contracts.ts` | retain lifecycle; expose detached validated linear acceleration |
| Phone emission | `runtime/controller-input/controller-input.ts` | generic registered processors and controls-owned commands |
| Authority ingress | `engine/session.ts` input/control/press; `engine/round.ts` | role requirements, enabled state, cutoff admission |
| Routing / phone admission | `runtime/session-routing/session-router.ts` | authenticated feedback and protocol admission |
| Identity / clock | `engine/progress.ts`, `engine/session.ts`, `engine/timing.ts` | injected deterministic defaults and fixtures |
| Snapshots / display | `engine/snapshots.ts`, `replication.ts`, screen adapters | timing policy and fixed roles; existing JSON budgets |
| Playback | `runtime/browser/sounds.ts`, browser resources and display playback | game-owned cues, shared synthesis and disposal |
| Harness | `devtools/game-harness/harness.ts`, `controller.ts`, colocated tests | detached authority view, replay inputs, public scenarios |

Existing semantic channels: button is a bare press; shake/chop are value-bearing
presses; pointer/tilt and touch controls carry values; swipe/hold-meter carry
atomic activation values. Binary transport remains one motion coordinate pair
and four timestamped press slots. Signed touch vectors become normalized aim
only at the existing adapter boundary; sticks neutralize, aim-pad retains.

Provider clocks are local monotonic milliseconds. `MotionSnapshot.at` dates the
sample, `epoch` retires integration history, and `sequence` prevents repeated
sample consumption. Freshness is 500 ms; availability expires at 2000 ms;
initial sample wait is 1800 ms. Action/value wire times use the authority clock,
with existing 100 ms future allowance and 2000 ms age bound. Preserve sequence
windows, per-action ordering, config generations, suspension and stale-callback
guards. Runtime owns routing, not sensor interpretation or UI calibration.

## 1. Pure motion registration

Types below belong to controls, with no React/runtime/game imports. `Point`,
`Rotation`, `Capabilities`, `Channel`, `OutputKind`, `ControlValue` and
`MotionSnapshot` retain their current owners. Add `impulse` to OutputKind and
JoltOutput to ControlValue. Retire slider, dial, text and draw-canvas from the
supported widget union and reject saved layouts naming them with an explicit
migration error. Do not silently reinterpret obsolete controls.

```ts
export type MotionInput = 'pointer' | 'tilt' | 'shake' | 'chop' | 'jolt';
export type Vec3 = readonly [number, number, number];
export type Availability =
  | { available: true }
  | { available: false; reason: string };
export type Validated<T> =
  | { ok: true; value: T }
  | { ok: false; reason: string };

export interface MotionClocks {
  localTime(): number;
  authorityTime(localAt: number): number;
}
export interface ValidatedMotionSample extends MotionSnapshot {
  // Null unless the gravity-removed device vector is finite and fresh.
  readonly linearAcceleration: Vec3 | null; // m/s², device axes
}
export interface AimLockPolicy {
  rate: number;
  calmMs: number;
  maxMs: number;
  lookbackMs: number;
}
export type MotionCommand =
  | { type: 'press'; down: boolean; at: number }
  | { type: 'cancel'; at: number }
  | { type: 'recenter'; at: number }
  | { type: 'sensitivity'; value: number; at: number }
  | { type: 'aim-lock'; at: number; policy: AimLockPolicy }
  | { type: 'aim-release'; at: number; immediate?: true };
export type MotionOutput =
  | { type: 'value'; value: ControlValue; at: number; confidence?: number }
  | {
      type: 'activation';
      value?: ControlValue;
      at: number;
      capture?: 'locked-aim';
    }
  | {
      type: 'aim-lock';
      captureAt: number;
      policy: AimLockPolicy;
    }
  | { type: 'aim-release'; at: number; immediate?: true }
  | { type: 'held'; down: boolean }
  | { type: 'haptic'; ms: number };
export interface MotionInputProcessor<P extends object> {
  configure(config: Readonly<P>): void;
  process(sample: ValidatedMotionSample): readonly MotionOutput[];
  command(command: MotionCommand): readonly MotionOutput[];
  reset(reason: 'epoch' | 'inactive' | 'configuration' | 'cancel'): void;
  dispose(): void;
}
export interface MotionDefinition<P extends object> {
  type: MotionInput;
  channel: Channel;
  kind: OutputKind;
  throttle: boolean;
  transport: { motionVector: boolean; pressSlots: 0 | 1 };
  availability(capabilities: Readonly<Capabilities>): Availability;
  validateConfig(value: unknown): Validated<P>;
  parseValue(value: unknown): ControlValue | undefined;
  parseActivation(value: unknown): ControlValue | undefined;
  create(clocks: MotionClocks): MotionInputProcessor<P>;
}
```

`at` on processor outputs is local sample/command time; the adapter converts it
once through `authorityTime(at)` and captures a detached value and aim. Clock
dependencies never read browser globals. Processors reject duplicate/reordered
sequence/time within an epoch, reset on a new epoch or reconfiguration, and are
permanently inert after dispose. Runtime enumerates registration metadata for
resolution, processing, semantic validation and capacity; adding jolt requires
only its definition/processor, registration and tests.

`aim-lock` and `aim-release` express a generic cross-control command routed by
controls-owned composition to the registered aim source. Chop preserves its
100 ms touch lookback, 600 ms pointer history, 150 ms release grace, onset dating,
400 ms max backdate and existing CHOP refractory/rebound constants. Cancel
releases capture and discards pending gestures without activation. Keep the
current immediate slow aim after release and rebound suppression; the old
ownership doc's settling description is not a license to change the code.

Implementation refinement (2026-10-07): aim outputs now carry the capture/rebound
policy as data, and registered aim processors receive equivalent generic commands.
Value outputs carry optional sensor confidence for generic binary projection.
Held state and haptic requests are semantic outputs; activation can request the
previous locked aim after release. This preserves chop behavior without requiring
a chop branch in composition or transport. Cancellation requests immediate release
with no release grace. The existing raw sensor MotionProcessor keeps its name;
the new semantic interface is MotionInputProcessor. Authority and UI import the
metadata-only registry (MotionMetadata = Omit<MotionDefinition, 'create'>); live
controls composition imports the processor registry. Metadata and constructor
registrations are checked for parity, preserving authority/shell boundaries.

UI registration belongs separately in controls presentation (React is allowed
there). Its concrete signatures use React ComponentType and existing ControlPort:

```ts
export interface MotionSurfaceProps {
  action: string;
  port: ControlPort;
  command(command: MotionCommand): void;
  enabled: boolean;
}
export interface MotionSettingsProps {
  action: string;
  command(command: MotionCommand): void;
  status: Readonly<Record<string, string | number | boolean | null>>;
}
export interface MotionPresentation {
  type: MotionInput;
  Surface?: React.ComponentType<MotionSurfaceProps>;
  Settings?: React.ComponentType<MotionSettingsProps>;
}
```

Controls own surfaces, calibration and settings. The shell receives a generic
controls surface/settings slot and a bounded phone feedback view, never chopCount
or holdAim. Captured ports/commands retire with config and input epochs.

Replace per-input ControllerConfig.sensors flags with the generic registered
settings map `motion: Partial<Record<MotionInput, Record<string, unknown>>>` in
ControllerConfig schema 2. A present entry enables that registered input; absent
means disabled. Each definition validates its entry and produces its own defaults.
No compatibility projection for old sensor flags is required. Keep non-motion
config fields and binary transport unchanged. Saved layout schema 2 remains a
local authoring format: missing motion.jolt normalizes to false. Reject obsolete
widget layouts clearly. No per-input runtime/shell branches are admitted.

### Jolt output and deterministic tuning

```ts
export type JoltOutput = { strength: number } & (
  | { kind: 'translation'; direction: 'left' | 'right' | 'up' | 'down' | 'forward' | 'back' }
  | { kind: 'rotation'; axis: 'x' | 'y' | 'z'; sign: -1 | 1 }
);
export interface JoltConfig {
  rotation: Rotation;
  triggerG: number;       // default 0.9, permitted [0.1, 4]
  rearmG: number;         // default 0.35, >0 and <triggerG
  fullG: number;          // default 2.5, >=triggerG and <=8
  triggerRate: number;    // default 3 rad/s, permitted [0.1, 20]
  rearmRate: number;      // default 1.2 rad/s, >0 and <triggerRate
  fullRate: number;       // default 10 rad/s, >=triggerRate and <=40
  refractoryMs: number;   // default 250, integer [100, 1000]
  calmMs: number;         // default 60, integer [20, 250]
}
```

Jolt requires granted fresh acceleration and gyro capability; missing either
returns explicit unavailable. It has channel both, kind impulse, one press slot
and no binary motion vector. Only reliable atomic presses carry direction; a
binary recovery edge cannot reconstruct it and must not synthesize a jolt.
Timestamp is the trigger sample's authority time, supplied by Action.time; no
second timestamp in the payload. Strength is finite in [0,1]. No button fallback
is declared in its proof fixture.

Controller frame uses +x right, +y down, +z toward the screen face/player;
forward is -z (away from player), back is +z. Map device vector (dx,dy,dz) to
(dx,-dy,dz), then clockwise screen quarter-turn by rotation. For rate, rotate
(alpha,beta,gamma) from their documented device X/Y/Z axes using the same frame
matrix with axial-vector determinant correction (the Y reflection flips
handedness); signs follow the controller frame's right-hand convention.
Synthetic traces must cover all axes and rotations.

Use fresh finite browser `acceleration` when supplied. Otherwise use a separate
gravity estimate initialized from 200 ms of calm samples with magnitude within
0.5 m/s² of 9.81 and rate below rearmRate. Low-pass gravity with
alpha=1-exp(-dt/500 ms) only while calm; freeze it during impulses. Until gravity
is established, translation cannot trigger. Do not use MotionProcessor.gravity
as a gravity-only estimate: current code stores accelerationIncludingGravity.

Compare largest absolute linear-acceleration component divided by (9.81*triggerG)
against largest absolute rate component/triggerRate. Trigger at >=1. Largest
normalized candidate wins; exact ties choose translation before rotation, then
X before Y before Z. Sign selects direction; clip strength using winning raw
component/(9.81*fullG) for translation or component/fullRate for rotation. Fire once, then require refractoryMs and consecutive
calmMs with every component below its corresponding rearm threshold. Gaps >500
ms, epoch changes and invalid samples reset gravity and require calm rearming;
never trigger on the first recovery sample. These are deterministic defaults,
not physical-device tuning evidence.

## 2. Timing, completion and fixed roles

Replace durationMs in the author API; keep endAt a finite authoritative cutoff.
Tick returns an object, replacing the event-array result. Existing games use no
feedback/completion, one default role and their existing duration/arbitration.

```ts
export type RoundTiming =
  | { kind: 'timed'; durationMs: number }
  | { kind: 'untimed'; safetyDurationMs: number };
export interface RoundSetupContext {
  readonly mode: string;
  readonly players: ReadonlyDeep<Player[]>; // frozen ordered roster
  readonly seed: number;                   // uint32
}
export interface ParticipantAssignment {
  playerId: string;
  role: string;                            // nonempty, <=64 characters
  controls: ControllerRequirements;
}
export interface GameContext extends RoundSetupContext {
  readonly assignments: ReadonlyDeep<ParticipantAssignment[]>;
  readonly startAt: number;
  readonly endAt: number;
}
export interface GameTickResult {
  events: readonly PresentationEvent[];
  feedback?: readonly PlayerFeedback[];
  complete?: true;
}
// Changes to existing interfaces:
// GameInstance<S>.tick(input: GameInput): GameTickResult
// GameDescriptor<S>.timing: RoundTiming
// GameDescriptor<S>.setup?(context: RoundSetupContext): readonly ParticipantAssignment[]
// GameDescriptor<S>.presentation: { cursors: boolean; phoneFeedback?: boolean }
// GameDescriptor<S>.sounds?: Readonly<Record<string, readonly SoundLayer[]>>
```

Timing durations are positive finite safe integers <=24 hours. Untimed UI hides
countdown-to-end but retains the start countdown. RoundSnapshot schema 2 requires
`timing: RoundTiming` and fixed `assignments: ParticipantAssignment[]`; validate
both and include them in the same 47 KiB envelope budget. Configuration messages
add `roundId: string | null` and `role: string | null` outside the config object
for fixed-round presentation and feedback admission (null in lobby). No old
snapshot/configuration schema support is required.

Completion is accepted only from a running authoritative tick, after successful
result/state validation. Its effective cutoff is min(tick.time, original
endAt); game code cannot backdate it. Filter queued actions to time <cutoff,
clear held values and latch settling immediately. Reject continuous gameplay
updates captured at/after cutoff. Accept delayed discrete actions in
[startAt, cutoff) received strictly before cutoff+200 ms, drain in stable
timestamp order at dt=0, then validate/finalize/award exactly once. Repeated
completion during settling is ignored and cannot extend any deadline. Safety
timeout uses the same path. Abort/error/load failure award no points.

Call setup once before replacing previous round/configs, using the reserved
round seed and fixed candidate roster. Validate exactly one assignment for each
candidate, no extra IDs, role bounds, requirements, layout and resolved capacity.
Omitted setup derives role 'default' and descriptor.controls for each player.
Copy/freeze assignments for the lifetime. Freeze candidate roster at preparation;
late arrivals wait for the next round. A missing candidate or capability blocks
preparation until recovered or the existing 15-second timeout; do not silently
shrink roles/roster. Capability changes resolve substitute implementations from
frozen semantic requirements only. Reconnect retains role and requires current
config-generation ACK. Configuration changes clear stale held/queued input and
retire ports. Host config failure must retire prior config readiness so an obsolete
config cannot continue admitting input. Turn order remains game state.

## 3. Feedback and authenticated delivery

```ts
export interface PlayerFeedback {
  playerId: string;
  status?: string;  // <=120 Unicode code points; no markup
  enabled?: boolean;
  hapticMs?: number; // positive finite integer <=100
}
export interface FeedbackMessage {
  type: 'feedback';
  roundId: string;
  generation: number; // current uint16 config generation
  revision: number;   // positive safe integer, monotonic per player per round
  status: string;     // complete current state
  enabled: boolean;
  hapticMs?: number;
}
```

Descriptor presentation.phoneFeedback declares feedback use before preparation.
Feedback from an undeclared game is invalid. Absent fields preserve current
status/enabled;
initial state is empty/true. Validate game-produced feedback before applying it;
unknown players, invalid types/bounds or oversized tick feedback fail the round
without awards. At most one update per participant per tick (max eight).

Authority stores status/enabled independent of transport rate limits. Disable
applies immediately at every binary, widget and reliable-press ingress, clears
held values and unsubmitted gestures, and cancels phone gesture capture without
synthesizing presses. Previously accepted actions at/before disable remain
eligible; later disabled input is rejected. Local controls honor enabled too.
Feedback ticks during settling cannot reenable gameplay past cutoff.

Coalesce state and send at most one feedback message per player per 100 ms;
cap haptics to one per 100 ms, dropping excess pulses rather than queueing them.
Send full state so coalescing cannot lose an enabled/status transition. Coalesced
state increments revision on transmission; authority enforcement is immediate.
Use injected authority time for limits. Always cap pulse duration at 100 ms;
unsupported vibration ignores the pulse while preserving state.

Route only from authenticated current host to the addressed phone. Envelope
player identity comes from routing, not a trusted payload. Validate bound round,
ACKed config generation and strictly newer revision before applying. Reject
spoofed sources, malformed envelopes, stale/duplicate revisions and unacknowledged
configs. On reconnect/config change, send current status/enabled after ACK using
a fresh revision; never retain/replay haptics. Clear both authority and phone
state and rate-limit timers at round termination or disposal. New generations
must preserve monotonic round revision and reset phone admission safely.

## 4. Deterministic dependencies and game-owned sound

```ts
export interface SessionDependencies {
  now(): number;
  sessionId(): string;
  seed(): number; // uint32 reserved once per attempted round
}
// SessionAuthority(hostId: string, ports: SessionPorts,
//                  dependencies?: SessionDependencies)
// SessionProgress(options?: { sessionId: string })
// RoundRunner(descriptor, progress, mode?, options?: { seed: number;
//   assignments?: readonly ParticipantAssignment[] })

export type SoundLayer = {
  from: number; to?: number; at?: number; length: number; gain: number;
} & (
  | { wave: 'sine' | 'square' | 'sawtooth' | 'triangle' }
  | { noise: true; filter: 'lowpass' | 'highpass' | 'bandpass' }
);
```

Production supplies monotonic now, current session-ID generation and one random
uint32 seed per attempted round, reserved before setup/configuration. Existing
games keep their RNG algorithms and XOR constants; scoring, timing and
distributions remain unchanged. Individual random schedules no longer depend on
startAt. A legacy-equivalence fixture supplies floor(startAt) as its explicit
seed. A replay supplies all three dependencies and the fixed roster. Reject
invalid identity/seed/clock dependencies before emitting configs or opening a
round. All session time reads use the injected dependency, including expiry,
ingress, boot/config, telemetry, load readiness and feedback limits.

Neon Harvest owns hit; Whack-a-Mole owns pop/bonk/gold/boom/whiff in game-folder
sound files, preserving current layers. Shared prompt/end remain framework cues.
Game declarations override only game event kinds, never framework prompt/end.
Shared browser playback validates a maximum eight layers per cue, start offset
[0,2] seconds, length (0,2] seconds, gain [0,1], frequencies [20,20000] Hz and
known waves/filters. Reject invalid descriptor declarations before preparation.
AudioContext, buffers, scheduling, mute, hydration deduplication and disposal
remain browser-owned. Noise audio randomness is presentation-only and excluded
from authoritative replay equality.

## 5. Supported replay and conformance interface

These types live exclusively under developer tools/test infrastructure:

```ts
export interface ReplayOptions {
  startTime: number;
  seed: number;
  sessionId: string;
  players: readonly Player[];
  capabilities: Readonly<Record<string, Capabilities>>;
  mode?: string;
  presentationDelay?: number;
  remoteDelay?: number;
}
export type ScheduledInput = { receivedAt: number } & (
  | { type: 'value'; playerId: string; action: string; time: number; value: ControlValue }
  | { type: 'press'; playerId: string; action: string; time: number; aim: Point; value?: ControlValue }
);
// GameHarness public additions:
// authoritySnapshot(): RoundSnapshot<S> | null  // detached clone
// schedule(inputs: readonly ScheduledInput[]): void
// start(): Promise<void>                        // load alias with explicit intent
// disconnect(id: string): void
// reconnect(id: string): void
// abort(): void
// finish(): void // advances safety/effective cutoff plus settling; never private mutation
```

Existing load/advance/setValue/press/display remain supported. Stable input ties
follow schedule insertion order; bounded scheduling rejects invalid inputs.
Separate fake-clock production-authority fixtures exercise ingress/routing and
ACKs; direct harness injection is not transport evidence. Completion scenarios
use game-owned/test-only descriptors returning complete, not a fixture that
changes private phase/endAt. Session identity and round counter make equal
replays yield equal IDs, events, authoritative snapshots and outcomes.

Conformance enumerates each catalog game/mode/player count, validates detached
JSON and both 40 KiB state / 47 KiB full envelope budgets, including representative
peak eight-player states. Exact scoring remains game-owned. Dynamic catalog
checks must have independent positive expectations for Neon Harvest and
Whack-a-Mole and negative fixtures for omitted games/leaked tools.

## 6. Coordinated development protocol migration

**Proposed decision: application protocol 5, binary frame version 1 (47 bytes),
ControllerConfig schema 2 and RoundSnapshot schema 2. No older-client support.**

User clarification on 2026-10-07: this application is not released and older
clients do not need support. This supersedes the earlier feature-negotiation
proposal. Do not implement feature flags, old-host/new-phone combinations,
old sensor-config projections or old snapshot defaults.

Concrete incompatible changes: a generic motion settings map replaces the
per-input sensor flags; directional jolt introduces a new atomic semantic shape;
phone feedback requires controls cancellation/enabled enforcement; snapshots
require timing/assignment metadata so untimed presentation and fixed roles can
be rendered correctly. Old clients have no jolt/feedback handler and would use
obsolete config/snapshot contracts. A protocol bump coordinates the whole
application rather than supporting those incompatible semantics under version 4.

Implementation migration:

1. Change APP_PROTOCOL_VERSION from 4 to 5 in src/shared/app-protocol.ts and update
   protocol fixtures/docs. Client, signaling service and all participants run
   the same new build. Do not change 47-byte input encoding or frame version 1.
2. Use the existing protocol-mismatch code, reload message and stopped retries;
   mismatch tests verify that stale clients cannot join rooms or establish peers.
   Do not add feature negotiation or automatic old-client substitution.
3. Restart the development frontend and signaling service, reload every screen
   and phone, then create/rejoin a room. Existing in-memory sessions are not
   migrated. No persisted game/session data requires conversion.
4. Browser smoke checks use one current build. Tests reject obsolete config/
   snapshot schemas and validate protocol mismatch guidance without retry loops.
5. Keep supported saved schema 2 authoring layouts readable with optional new
   motion defaults; that is local artifact handling, not older-client support.

The user clarification authorizes dropping old-client compatibility; exact
shared API signatures still require the plan's prerequisite review before
implementation. No protocol source has been changed in this checkpoint.

## Migration examples for review

Both descriptors replace `durationMs` with:

```ts
// Neon Harvest
 timing: { kind: 'timed', durationMs: HARVEST.duration },
// Whack-a-Mole; keep arbitrationMs: 40 and its existing controls/fallbacks.
 timing: { kind: 'timed', durationMs: WHACK.duration },
```

Neither needs setup: default role/descriptor.controls is derived once. Both
replace `return events` in tick with `return { events }`. Start uses
`context.seed ^ 0x7f4a7c15` (Neon) or `context.seed ^ 0x5bd1e995` (Whack), rather
than reading startAt directly; explicit seed=floor(startAt) reproduces legacy
schedules, while production reserves a seed before configuration.
Sound maps import declarations from each game's folder. Renderers retain the
same game drawing; shared timing UI interprets snapshot timing metadata.

Test-only role/turn fixture:

```ts
 timing: { kind: 'untimed', safetyDurationMs: 60_000 },
 presentation: { cursors: false, phoneFeedback: true },
 setup: ({ players }) => players.map((player, index) => ({
   playerId: player.id,
   role: index === 0 ? 'leader' : 'follower',
   controls: index === 0 ? leaderControls : followerControls,
 })),
// Game-owned tick computes the active turn, then returns data:
 return { events: [], feedback: players.map((player) => ({
   playerId: player.id, enabled: player.id === activePlayerId,
   status: player.id === activePlayerId ? 'Your turn' : 'Wait for your turn',
 })), ...(finished ? { complete: true } : {}) };
```

Directional motion proof requirement:

```ts
 controls: { inputs: { move: { required: true, prefer: 'jolt' } } },
```

No fallback: unavailable devices receive a clear preparation error.
Clients with an obsolete protocol are rejected before joining. Role requirements can include this input using the same resolver.
Scaffold output starts with one timed/default role game and its own folder,
renderer, tests and catalog entry; no new production game is added as a proof.

## Review record

Review requested after prerequisite evidence and checkpoint are saved. Approval
must cover the signatures, coordinated protocol 5 migration without older-client
support, jolt coordinate/tuning defaults, lifecycle cutoff, fixed preparation roster, feedback
bounds/enforcement, sound and deterministic fixtures. Amendments are recorded in
`docs/acceptance/MILESTONE-1.md` before implementation. Physical sensors, haptics,
browser and hosted-network evidence remain separate gates.
