# Controller design guide

How Controlla's phone controls look and behave. The brief: **what a
first-party controller UI would feel like if Apple built one for games.**
Clean and functional, never boring. Every control in
`src/client/controls/` follows this guide, and every value it names is a token in
[tokens.css](../../src/client/controls/tokens.css).

See it live at `/?role=gallery`. The **Design** tab shows the tokens, the type
scale and every shape × appearance, and the **Controls** tab lets you play
with each control against all eight player colours.

## Principles

1. **Material, not plastic.** Controls are graphite panes lit from above: a
   hairline edge, a one-pixel specular highlight along the top, a faint top
   sheen and a soft ambient shadow. No solid drop "lips" and no bevels.
2. **Light shows the press, not travel.** An activation is instant and
   quiet: discrete controls scale to `--ctl-press-scale` (0.95), the accent edge
   and halo appear, and a short haptic fires. Releases spring back with
   `--ctl-ease-spring`. Pads that track a finger never scale, because the
   surface under the thumb must not move.
3. **Colour means you.** The player's roster colour (`--ctl-accent`) is the
   only saturated hue on the phone, so it matches that player's cursor on the
   TV. At rest, controls are neutral graphite. The accent marks what is being
   touched: the active edge, the lit D-pad arm, the knob ring, the reticle and
   the charge ring. `filled` buttons are the one exception, because the
   primary action should be obvious before it is touched.
4. **One family at any size.** Radii, glyphs and numerals scale with the
   control (`cqmin`), so a 1×1 button and a full-width pad read as siblings.
   Chrome gets out of the way as space runs out.
5. **The play area is sacred.** Captions and hints sit at the edges and are
   never part of what you press. Inside the play area there are glyphs, not
   words.

## Colour

| Token                                               | Use                                                      |
| --------------------------------------------------- | -------------------------------------------------------- |
| `--ctl-bg`                                          | The phone behind everything. Near-black graphite.        |
| `--ctl-well`                                        | Recessed fields: aim pad, swipe pad, stick gate.         |
| `--ctl-surface`                                     | The resting control face.                                |
| `--ctl-surface-raised`                              | Parts that stand proud: D-pad cross, hold-meter key.     |
| `--ctl-knob-top/bottom`                             | The stick knob's lit dome.                               |
| `--ctl-line`, `--ctl-line-strong`                   | Hairlines: edges, grids, dead-zone ring.                 |
| `--ctl-specular`, `--ctl-sheen`, `--ctl-sheen-soft` | Light from above: top edge, filled sheen, surface sheen. |
| `--ctl-ink`, `--ctl-ink-muted`, `--ctl-ink-faint`   | Text: active caption, resting caption and glyph, hint.   |
| `--ctl-accent` (+ `-glow`, `-soft`, `-edge`)        | The player. Engaged states only (see principle 3).       |
| `--ctl-neutral`, `--ctl-danger`                     | Button tones for the `neutral` and `danger` variants.    |
| `--ctl-warning`                                     | Designer-only advice (undersized controls).              |

**Contrast.** All eight player colours in `src/shared/room.ts` are light, so
`--ctl-accent-ink` stays near-black on every accent. Adding a dark player colour
would break that assumption; derive the ink per colour first.

## Type

One family, the system face (`-apple-system`, which is SF on Apple devices).
Glyphs and numerals use its rounded cut (`ui-rounded`) for a friendlier, more
game-like voice.

| Role    | Token                     | Style                                                      |
| ------- | ------------------------- | ---------------------------------------------------------- |
| Caption | `--ctl-font-label` (13px) | Semibold, sentence case, muted; ink when active. Top-left. |
| Hint    | `--ctl-font-hint` (12px)  | Regular, faint, centred at the bottom.                     |
| Glyph   | `--ctl-font-glyph`        | Rounded semibold; 44% of the control's shorter side.       |
| Numeral | `--ctl-font-numeral`      | Rounded semibold with tabular figures (hold meter).        |

Icons are lucide at stroke 2 (2.25 for the small D-pad chevrons), close to SF
Symbols' regular weight. Only names in `kit/icons.ts` may be requested by
games.

## Shape

Every control's frame takes one of four silhouettes, chosen per item in the
designer (`props.shape`). A definition lists the shapes that make sense for it;
the first is its default.

| Shape     | Radius                                             | Use it for                                             |
| --------- | -------------------------------------------------- | ------------------------------------------------------ |
| `rounded` | `--ctl-radius-control` (16% of short side, 8–30px) | The default for everything.                            |
| `square`  | `--ctl-radius-square` (7%, 6–12px)                 | Dense grids and tile-like layouts.                     |
| `circle`  | Largest circle that fits, centred                  | Face buttons (A/B/X/Y), sticks, the hold meter.        |
| `capsule` | Fully round short sides                            | Wide or tall actions: shoulder buttons, a swipe strip. |

Round silhouettes centre their caption and drop the hint.

## Appearance

How much tone a control carries at rest (`props.appearance`). The variant
(`accent` / `neutral` / `danger`) picks the tone; the appearance picks how
loudly it is used.

| Appearance | Rest                                                                          | Use it for                                   |
| ---------- | ----------------------------------------------------------------------------- | -------------------------------------------- |
| `filled`   | Solid tone with a top sheen; ink glyph.                                       | The primary action. One per layout, ideally. |
| `tinted`   | Surface washed with `--ctl-tint-mix` (22%) of the tone; toned glyph and edge. | Secondary actions.                           |
| `plain`    | Graphite surface, hairline edge.                                              | Pads and anything continuous.                |

Buttons default to `filled`; every other control defaults to `plain`.

## Size and layout

- The layout grid is 12×24 cells in portrait (24×12 in landscape). One cell on
  a typical phone is about 31pt.
- Every control has a **recommended size** (`recommendedSize` in its
  definition): button 3×3, stick/D-pad/aim pad 5×5, swipe pad/hold meter 4×4.
  New controls start at that size.
- Controls may shrink to **1×1**. Below the recommended size the designer shows
  an amber warning but still saves. Keep undersized controls for secondary or
  rare actions: Apple's minimum comfortable target is 44pt, which is about 2×2
  cells after the gap.
- Chrome yields to the play area: the hint hides below 132px of height, and the
  caption hides below 84px in either direction.
- Controls sit `--ctl-gap` (8px) apart; the surface keeps half a gap at its
  edges.
- The menu corner reserves 2×2 cells.

## Motion

| Token               | Value | Use                                                  |
| ------------------- | ----- | ---------------------------------------------------- |
| `--ctl-press-ms`    | 70ms  | Anything that responds to a touch starting.          |
| `--ctl-spring-ms`   | 340ms | Returning to rest, with `--ctl-ease-spring`.         |
| `--ctl-flash-ms`    | 520ms | One-shot confirmations (swipe chevron, full charge). |
| `--ctl-press-scale` | 0.95  | Button and hold-meter key while held.                |

Confirmations play **once**; nothing loops while you hold. The frame stylesheet
zeroes every duration under `prefers-reduced-motion`.

## Controls

**Button.** The frame is the key. Its caption is top-left (centred on round
shapes), with the glyph (icon or the label's first letter) in the middle.
Pressed: scales down; filled loses its sheen, and plain washes with the tone.
Tones: `accent` (the player), `neutral`, `danger`.

**D-pad.** One continuous raised cross on the plate, with thin chevrons and a
shallow dimple at the hub. The held arm washes from the plate colour at the hub
to full accent at its tip, with accent-ink chevrons. In 8-way mode, diagonals
light two arms.

**Stick.** A recessed circular gate with a hairline dead-zone ring, and a
domed knob with a shallow thumb dish and a soft shadow. Floating sticks centre
the gate under the thumb. Held: an accent ring on the gate and knob, with a
soft glow. Released: the knob springs home.

**Aim pad.** A recessed field with a faint quarter grid and a precise reticle
(a hairline ring and a centre dot). Held: the reticle grows slightly and gains
a halo. It stays where the finger left it.

**Swipe pad.** A quiet dot field. The finger draws a tapered accent stroke.
A recognised swipe confirms with a small accent chevron disc that drifts the
way you swiped and fades.

**Hold meter.** A round key inside a thin activity-style ring. Held: the key
presses in and the ring fills with rounded ends. Full: the key fills with the
accent, pulses once, and a stronger haptic fires. The value uses tabular
rounded numerals.

**Sensor tile** (motion inputs in the designer and preview): a recessed well
with a light-stroke icon in the accent colour.

## Checklist for a new or changed control

- [ ] Uses only `--ctl-*` tokens; new raw values go into `tokens.css` with a comment.
- [ ] Renders inside `ControlFrame` and passes `shape` and `appearance` through.
- [ ] Declares `shapes`, `appearances` and `recommendedSize` in its definition.
- [ ] Resting state is neutral; engaged state uses the accent; the activation has a haptic.
- [ ] Looks right at 1×1, at its recommended size, and full-width, in every declared shape.
- [ ] Checked against all eight player colours in the gallery, and on a real phone.
