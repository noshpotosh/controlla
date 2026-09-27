# Controlla controls

The phone-side component library. A game names the inputs it needs; the phone renders a consistent controller from these controls; the game reads back semantic values. **Games never draw their own controls.**

Open **`/?role=gallery`** on a phone to play with every control and layout, with a live readout of what the game receives. Deep links: `?role=gallery&tab=layouts&layout=duo&landscape`.

## Using controls in a game

Declare inputs and a layout in the game's `Manifest` ([src/core/config.ts](../core/config.ts)):

```ts
layout: 'gamepad',
inputs: {
  move:  { prefer: 'dpad', required: true, label: 'Move' },
  jump:  { prefer: 'button', required: true, label: 'Jump', props: { icon: 'jump' } },
  power: { prefer: 'hold-meter', required: false, label: 'Power', props: { holdMs: 1500 } },
},
```

The game then receives:

- **Press-channel controls** (`button`, `swipe-pad`, `hold-meter`) as timestamped `Press` edges, in declaration order across four slots. A controller can have at most 4.
- **Values** in `InputFrame.values[action]`, typed with `StickOutput`, `DpadOutput`, `SwipeOutput` and `HoldOutput` from [types.ts](types.ts).

The **Game receives** line in the gallery is the contract for each control.

### Layouts

| Preset    | Slots                  | Shape                                                                 |
| --------- | ---------------------- | --------------------------------------------------------------------- |
| `single`  | `primary`              | One control fills the phone                                           |
| `stack`   | `primary`, `a`         | Big control on top, action below; side by side in landscape           |
| `duo`     | `a`, `b`               | Two equal actions                                                     |
| `gamepad` | `primary`, `a`, `b`    | Movement on top, actions below; left thumb / right thumb in landscape |
| `custom`  | (each widget's `rect`) | Escape hatch: normalized `[x, y, w, h]` per widget                    |

Inputs fill slots in order. Set `slot` on an input to choose its slot. When `layout` is omitted, the preset is picked from the input count. Landscape switches on the surface's own aspect ratio (a container query), so it works in the gallery's phone preview too.

## Anatomy of a control

Each control is a folder with the same files:

| File            | Role                                                                                                                                                  |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `definition.ts` | Pure data: type, name, `channel` (`press` / `value` / `both`), `throttle`, documented `output`, default `hint`, `variants`, `defaults`. **No React.** |
| `logic.ts`      | Pure gesture math (unit-tested in `tests/controls.test.ts`). Optional when there's none (e.g. button).                                                |
| `<Name>.tsx`    | The view: composes `ControlFrame` + `useTrackedPointer` and talks only to its `ControlPort`.                                                          |
| `styles.css`    | Classes `.ctl-<type>__part`, using only `--ctl-*` tokens.                                                                                             |

The shared kit:

- `kit/ControlFrame.tsx`: the shell that draws the caption, hint, active state, variant class and focus ring.
- `kit/useTrackedPointer.ts`: single-finger capture that always ends cleanly.
- `kit/geometry.ts`: clamp, dead zone and direction snapping.
- `kit/icons.ts`: the only icon vocabulary games may name.

`registry.ts` (pure) and `views.ts` (React) list every control. The runtime reads `channel` and `throttle` from the registry, so a new control needs no runtime changes. Throttled values always deliver their latest value, and a press flushes its value first.

## Adding a control

```bash
npm run control:new -- my-control
```

This scaffolds the four files and registers the control in `registry.ts`, `views.ts`, `controls.css`, the `WidgetType` union and [docs/INPUTS.md](../../docs/INPUTS.md). Then fill in the definition, build the view, and check it in the gallery. To show named demo options in the gallery, add an `OPTIONS` entry in [gallery/Gallery.tsx](gallery/Gallery.tsx).

## Copying a control for a special case

```bash
npm run control:new -- big-red-button --from button
```

This copies the folder under a new type, renaming the component, class prefix and definition. The original is untouched.

**Fork only when behaviour or output changes.** A different look or tuning belongs on the existing control as a `variant` (listed in the definition, styled with `.ctl-<type>.ctl--<variant>`) or a prop in `defaults`. Games pick those per input.

## Design rules

Every control follows these rules. Review new controls against them in the gallery on a real phone.

1. **Tokens only.** Raw colours, sizes and timings live in [tokens.css](tokens.css). Controls use `var(--ctl-*)`.
2. **The player's colour is the accent.** `--ctl-accent` is set from the player's roster colour, so each phone matches that player's cursor on the TV. Every active state uses the accent. Check all 8 colours with the gallery swatches.
3. **Same chrome everywhere.** The caption is small caps in the top-left. The hint sits muted at the bottom and hides in short cells. Neither is ever part of the play area.
4. **Every activation shows three cues together:** depth (the control sinks `--ctl-depth`), accent glow, and a short haptic (`port.haptic()`).
5. **Big targets.** Nothing is smaller than `--ctl-touch-min` (64px). Layout cells are the target, not the glyph.
6. **One finger per control.** Use `useTrackedPointer`, never raw pointer events, so cancels and unmounts always release inputs.
7. **Glyphs, not words**, inside the play area. Icons come from `kit/icons.ts` (lucide).
8. **Respect `prefers-reduced-motion`.** The frame stylesheet already zeroes animation durations.
