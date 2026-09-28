# Honey Hustle redesign plan

Status: proposed implementation plan, September 28, 2026. This document and the two copied reference images are planning deliverables; the game has not been changed.

## Direction

Rename the player-facing game to **Honey Hustle** and give the shared game screen and phone controller one sunny garden identity: friendly striped bees, glossy amber honey, sculpted wooden frames, leafy green controls, daisies, and soft warm lighting.

Use the supplied images as the visual targets:

- [Game reference](game-reference.jpg): garden arena, bee players, wooden wave/time plaques, and bottom score cards.
- [Controller reference](controller-reference.jpg): bee identity card, dominant honeycomb Pulse, and separate green Recenter.

The existing [Honey Hustle concept](../../output/imagegen/bee-rebrand/02-honey-hustle.png) and [controller concepts](../../output/imagegen/honey-hustle-controller-2026-09-28/README.md) are supporting material. The two supplied references above take precedence.

Recommended implementation: **pre-rendered artwork and animated sprites in the existing Canvas 2D game, with real HTML controls on the phone**. This can reproduce the sculpted, 3D-looking materials without changing the game to a 3D engine. Judge the first integrated scene against the references before producing the full asset set.

## Scope and defaults

- Preserve the existing 45-second round, one Standard mode, and 1–8 players.
- Preserve motion aim, absolute touch aim fallback, pickup scoring, chains, mine behavior, Pulse range/cooldown, disconnect behavior, and session awards.
- Rebrand the game selection, instructions, active game, controller, countdown, results, and current documentation. Keep the surrounding Controlla room/join tools functional and visually secondary.
- Rename the public title first. Keep the internal `neon-harvest` identifier and source folder during this visual release to avoid unnecessary changes to snapshot lookup, round records, and imports. Record this as an intentional legacy identifier; a later source/ID migration is optional and separate.
- Use actual player names, assigned identities, scores, wave numbers, and remaining time. NOVA, REN, MIKA, CASS, 110, and WAVE 11 are sample content in the references.
- Treat this as an art and interface update. Audio, new abilities, new enemies, a different camera model, and gameplay rebalance are separate scope.

## Game art and layout

### Composition

Keep the existing 1600×900 logical scene. Paint a garden with a calm, open grass center; concentrate rocks, fence, clover, mushrooms, hive details, and large flowers at the perimeter. Use soft background depth and clear silhouettes for gameplay objects. Foreground flowers must not cover pickups, hazards, bees, or text.

Place the Honey Hustle logo at top left, a compact WAVE plaque at top center, and a countdown plaque at top right. Remove the current opaque sci-fi header and persistent instructional sentences from the active arena; put the rules in the pre-round view.

Use wood-framed score cards with a bee portrait, player name, score, and Pulse state. Preserve chain/multiplier feedback with a small readable badge and show stun/disconnection explicitly. Highlight the final ten seconds with a restrained “2× HONEY RUSH” treatment so the existing scoring change remains understandable.

- 1–4 players: one centered bottom row, with capped card widths so a solo card does not stretch across the display.
- 5–8 players: two compact rows of four maximum, with stable roster order. Reduce ornamental framing before reducing essential type size.
- Establish HUD-safe bounds against actual spawning, drift, bee size, trails, and Pulse radius. The current second HUD row starts at logical y=718, close to the lower play area; do not simply enlarge those cards in place.
- Keep nameplates readable at TV viewing distance; fit or truncate long names without moving scores or Pulse labels.

### Visual translation of existing rules

- Player ship/cursor → golden bee with dark stripes, translucent wings, colored scarf, short pollen trail, and a small ground marker.
- Common `spark` pickup → golden honey drop, still worth 10 base points.
- Premium `gold` pickup → rarer blue dew orb, still worth 30 base points. This proposed mapping matches the reference's many honey drops and fewer blue orbs; make the two values explicit in instructions.
- `mine` → red thorny seedpod hazard with a clear silhouette and face. Keep its existing analytic drift and 1.1-second warning, with an emerging/pale warning state before it becomes dangerous.
- Pulse → broad amber pollen ring and restrained sparkles. It still collects nearby pickups and clears hazards, with a six-second cooldown and 170-logical-pixel range.
- Mine hit → brief bee daze and visible score/chain feedback, preserving the one-second stun and up-to-50-point penalty.
- Chain and double-score feedback → small honey-colored number bursts and an unobtrusive multiplier cue.

Maintain matching identity across bee, nameplate, score card, and phone. Start the art proof with the reference's green/blue/gold/purple accessories, but build the production system for all eight assigned identities. Preserve the shared roster color relationship; use names and accessory/marker differences in addition to color. Do not silently substitute a four-color roster.

### Geometry and animation

Keep logical coordinates and collision math unchanged. Create depth through painted scenery, contact shadows, sprite orientation, and subtle bobbing. Do not introduce a perspective transform solely in rendering: it would separate the visible bee, calibrated pointer, pickups, and collision distances.

Align each sprite's gameplay anchor with its shadow/collector point. Wings, hover offsets, and outlines are decorative. Use directional poses or horizontal flips with gentle banking; freely rotating an oblique bee sprite like the current ship would break the lighting and perspective. The oval garden border is scenery, not a new collision boundary: aim still spans the full normalized rectangle, so avoid suggesting impassable walls or clipping bees against invisible edges.

Retain immediate local cursor presentation and the existing delayed snapshot path. Animate with the renderer's supplied time; do not read wall-clock time inside artwork helpers.

Reduced motion should retain moving gameplay positions and essential warnings while removing bee bobbing, long trails, idle glints, and expanding decorative particles.

## Phone controller

### Motion mode

Recreate the hierarchy inside the actual browser viewport, without the reference's illustrated phone bezel:

1. Compact Honey Hustle wooden logo.
2. Bee portrait and player strip with name and live **round score**.
3. “Move your phone to aim.”
4. Large amber hexagonal **PULSE** button, with its status inside the same fixed footprint.
5. Separate large green **RECENTER** button with crosshair icon.
6. “Hold comfortably, then tap Recenter.”

Keep the background softly detailed and quiet behind labels. Flowers and leaves frame the edges, never the touch targets. Preserve a small accessible connection/settings menu without competing with the two play controls.

For a roughly 390×844 viewport, start with a 300–330 CSS-pixel Pulse surface, a 64–80-pixel-high Recenter button, and 16–24 pixels between them. These are layout targets, not final fixed dimensions. Make the header shrink first on short phones; keep the two actions visible together above browser and device safe areas. Validate at 320×568 as well as modern tall phones. Use dynamic viewport sizing and a compact landscape arrangement rather than relying on orientation lock.

### States

- **Ready:** bright honey face, ripple icon, “PULSE / READY.”
- **Pressed:** immediate tactile depression and existing optional haptic feedback.
- **Cooling down:** same shape and location, quieter honey fill, visible remaining seconds and refill cue.
- **Stunned:** distinct short “STUNNED” state driven by the game.
- **Countdown / waiting:** clear readiness or starting message; Pulse cannot appear usable before play.
- **Reconnecting / stale feedback:** visible connection state; do not invent a current score or claim Pulse is ready.
- **Round complete:** final round score and waiting-for-next-round message; no active Pulse.
- **Recenter:** brief confirmation, independently usable during Pulse cooldown.

Recenter calls the existing local pointer recalibration. It does not restart the round, reset scores, clear cooldown, or consume a game action slot. Retain keyboard activation, pointer cancellation, and release-on-unmount behavior when styling Pulse.

### Touch fallback

When motion is unavailable or permission is denied, show a clearly labeled absolute aim pad and a separate Pulse button. Use the same art family with smaller branding. Keep the pad rectangular, covering the full normalized aim range, and retain position when released.

Do not overlay Pulse on the aiming surface or require a hidden gesture. Explain “Drag to aim.” Show the Recenter control as unavailable with a short “Motion aiming only” explanation in this mode, or omit it if space is constrained. Offer enabling motion through the existing permission/settings flow.

## Artwork production

Create reusable components rather than putting either full screenshot behind live controls. Dynamic labels must be real text; only the fixed Honey Hustle logo may have lettering baked into its art.

First asset proof:

- One empty landscape garden plate, with no HUD, players, pickups, or hazards.
- One bee at actual gameplay scale, one portrait, and an accessory color mask.
- One honey drop, blue dew orb, warning/active seedpod pair, and pollen texture.
- One wooden plaque, one blank hexagonal honey button, and one blank green Recenter button.

After the proof meets the references, finish:

- Landscape background plus optional separate foreground corners; portrait controller background with short-phone cropping rules.
- Approved logo; reusable horizontal wooden frames and portrait medallion frames.
- Bee directional poses/short wing animation, with compatible lighting and anchors; portrait variants for all eight identities.
- Pulse normal, pressed, cooldown, and unavailable faces; Recenter normal and pressed faces. Prefer overlays/masks where possible to avoid duplicating large images.
- Optimized pickup/hazard sprite atlas; a small reusable effects atlas.
- One rounded, legible, appropriately licensed font, with a tested fallback.

Store source exports and optimized runtime assets separately. Runtime assets belong with the game and need a manifest containing dimensions, pivots, atlas frames, and source/provenance notes. Use transparent exports for sprites and frames. Verify edges against light and dark surfaces and inspect every sprite at its actual on-screen size.

Load and decode art once per display, cache static composites, reuse atlases, and bound particles by the existing limits of 70 nodes and 96 effects. Add a minimal renderer preparation/loading path and explicit fallback behavior. Keep image loading and fonts out of authoritative game `load()` and out of wire snapshots. A missing cosmetic asset must not change game state or stop input.

## Engineering work

### Game presentation

The current renderer already separates `backdrop`, `node`, `effect`, `hud`, `panel`, and `ship`. Replace those layers in [renderer.ts](../../src/client/minigames/neon-harvest/renderer.ts), with game-local asset/theme helpers. Preserve [model.ts](../../src/client/minigames/neon-harvest/model.ts) and [game.ts](../../src/client/minigames/neon-harvest/game.ts) behavior. Update title and instructions in [index.ts](../../src/client/minigames/neon-harvest/index.ts).

Countdown and results currently bypass the game renderer and use generic dark styling in [game-screen/screen.ts](../../src/client/game-screen/screen.ts). Add a small optional declarative presentation theme to the public descriptor so those phases can share Honey Hustle art without a game-name branch in the shared screen. Keep results, errors, scoring, and phase ownership in the framework; preserve a readable generic fallback. [presenter.ts](../../src/client/game-screen/presenter.ts) owns renderer lifetime and failure handling and is the place to coordinate renderer preparation.

### Controller presentation and feedback

The current [ControllerScreen.tsx](../../src/client/shell/ControllerScreen.tsx) renders generic widgets through [ControllerSurface.tsx](../../src/client/controls/ControllerSurface.tsx). The current [aim-and-pulse layout](../../src/client/controls/layouts/aim-and-pulse.json) reserves most of the screen for the fallback aim pad; it cannot reproduce the motion-only reference by changing colors.

Add a small, optional, declarative controller presentation contract: skin/assets, layout variants, semantic status fields, and action slots. Keep game-specific Honey Hustle configuration/assets inside the game folder and register it through the catalog. The shared controller renderer consumes this contract and narrow input ports; it must not import the game or inspect its state shape. Keep the author API React-free and preserve the catalog-only game import boundary. The existing `AppExtensions.controllerPanel` is for motion diagnostics and should retain that purpose.

Choose the motion layout from resolved `config.sensors.pointer.enabled`, not merely a local permission flag. The current resolver retains the aim-pad rectangle when replacing it with a pointer widget, leaving a large pointer preview; the new motion layout must explicitly reclaim that space. Reflect layout variants in the development previews as well as live controllers.

Reuse the existing widget input semantics for Pulse and aim. Expose Recenter through a separate narrow shell action, retaining [Runtime.recenter()](../../src/client/runtime/runtime.ts). Update input ports or shared button presentation only as needed to supply the custom face; preserve their pointer and keyboard lifecycle guarantees, including aim stabilization during a Pulse press. Feedback renders must not remount controls or change their `configId:generation:inputEpoch` lifetime key.

**New feedback is required:** phones currently receive config, phase, and session progress, but do not receive the live state containing round score and `pulseReadyAt`. Add a generic per-player controller-feedback channel rather than sending the arena snapshot to every phone.

- Let the descriptor project its state into a small validated, read-only player view: round score, primary-action ready time/duration, stun-until, and relevant status.
- Include player identity, game ID, round ID, configuration generation, monotonic sequence, and authority timestamp. Reject stale/wrong-round/wrong-generation updates, enforce player isolation, bound payload size, and clear feedback on role, round, or config changes.
- Send updates through existing host-to-player routing, including venue relay and direct-to-session fallback; refresh on reconnect and round/phase changes. Coalesce periodic state and avoid reliable-channel backlog.
- Render countdowns from authority timestamps using the existing synchronized clock. The host remains authoritative for action acceptance; a locally pressed button alone must not establish a six-second cooldown or award points. Phone readiness follows usable authority time; the TV follows its existing delayed presentation time. Test that expected difference rather than mixing clock domains.
- Preserve the distinction between current game score and the session points ledger. Do not display session totals as the reference's live score.
- Version and validate the wire change with the existing application protocol gate; test mixed-version reload behavior.

Expected shared touchpoints: [api/index.ts](../../src/client/api/index.ts), [core/types.ts](../../src/core/types.ts), [core/session.ts](../../src/core/session.ts), [runtime.ts](../../src/client/runtime/runtime.ts), [core/config.ts](../../src/core/config.ts), [controller.css](../../src/client/controller.css), controller layout resolution, and [core/app-protocol.ts](../../src/core/app-protocol.ts). Exact contract names should be settled in the first implementation slice.

## Delivery sequence

1. **Brand and art proof.** Finalize pickup vocabulary, identity treatment, asset pivots, HUD-safe regions, and compact phone proportions. Produce one representative game scene and one working controller composition from the first asset set. Exit: the appearance is close enough to the supplied references to justify scaling production.
2. **Presentation contracts and data.** Add the optional theme/controller metadata, renderer asset preparation, and bounded per-player feedback. Prove correct score, cooldown, Recenter, and fallback behavior with simple temporary faces. Exit: live values and actions work across host, remote display, and phone routes without violating game boundaries.
3. **Shared game screen.** Integrate final garden, bee/pickup/hazard sprites, Pulse effects, readable 1–8-player HUD, and matching countdown/results. Exit: the complete game round reads as Honey Hustle and collision/aim behavior is unchanged.
4. **Phone controller.** Integrate the honeycomb Pulse and green Recenter, all states, mobile safe areas, and motion/touch layouts. Exit: both main actions remain usable on short and tall phones and feedback matches accepted game state.
5. **Finish and verify.** Complete the title/copy sweep, optimize assets, test real devices and multi-screen play, update current docs, and capture acceptance screenshots. Exit: measured visual and functional checks pass; record any remaining hardware limitations explicitly.

Art production can proceed in parallel with step 2 after the initial proof. Do not start a broad runtime or rules rewrite for this redesign.

## Acceptance checks

Visual review:

- Compare running-game and portrait-controller captures directly with the supplied references: materials, bee silhouettes, grass/foliage balance, wooden HUD, Pulse dominance, and Recenter separation.
- Capture solo, four-player, and eight-player game layouts at 1280×720 and 1920×1080; include longest supported names, large scores, cooldown, stun, disconnect, and final-ten-second states.
- Capture controllers at 320×568, 390×844, and a taller device, plus landscape and browser-chrome changes. No required action should be clipped or require scrolling during normal play.
- Verify reduced motion, contrast, readable state labels, keyboard access, and non-color identity cues. Controls remain semantic buttons over decorative art.

Functional regression:

- Existing pickup values, chain reset/multiplier, warning and stun timing, Pulse radius/cooldown, scoring cutoff, settling, rematches, and session awards remain unchanged.
- Pulse fires once per accepted press; cancellation, release, remount, and simultaneous aiming do not leave a held action or create duplicates.
- Live phone score/cooldown are correct through delayed packets, rejected presses, rapid repeated taps, reconnect, config changes, and new rounds. An old round never updates the next controller.
- Recenter changes only local aim and remains available during cooldown. Test motion permission denial and the full rectangular touch fallback.
- Asset load failures, decode delays, dispose/remount, and a missing font produce a usable fallback. Art never enters game snapshots or input packets.
- Keep import-boundary and production-bundle checks meaningful when adding assets and presentation metadata; retain generic fixture coverage.

Run `npm run game:test`, `npm test`, `npm run typecheck`, `npm run lint`, and `npm run build` after implementation. Extend the existing presentation, game-screen, runtime, input-boundary, and layout tests for the new behavior rather than testing decorative CSS details. Then exercise iOS Safari/Android Chrome motion permissions, touch cancellation, wake/reconnect, and two-screen play on physical devices.

Measure frame time and initial asset load on representative hardware with eight players and dense effects; use smooth 60 Hz presentation as a target, not a claim. Record asset transfer/decoded memory and avoid adding per-frame image decoding, large blur passes, or full React-tree updates. The reference images demonstrate appearance, not runtime performance.

## First implementation milestone

A playable four-bee Honey Hustle round with the approved garden, one finished wooden HUD style, and a phone controller whose honeycomb Pulse, green Recenter, live score, and cooldown all work. Once that integrated slice matches the references, complete the eight-player layouts, remaining states, and broader device checks.
