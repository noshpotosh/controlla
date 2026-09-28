# Controlla controls

The phone-side component library. A game names the inputs it needs; the phone renders a consistent controller from these controls; the game reads back semantic values. **Games never draw their own controls.**

Open **`/?role=gallery`** on a phone to play with every control and layout, with a live readout of what the game receives. Deep links: `?role=gallery&tab=layouts&layout=duo&landscape`.

## Using controls in a game

Controllers are **layouts**: a library of named touch layouts in [src/layouts](../layouts), designed at `/?role=designer`. Layouts don't belong to games. A game picks one by name, and each of its inputs drives the layout control with the same name:

```ts
export const racer: Manifest = {
  // …
  inputs: {
    steer: { prefer: 'tilt', fallback: 'stick', required: true },
    boost: { prefer: 'swipe-pad', required: true },
  },
  controller: { layout: 'steer-and-boost' }, // src/layouts/steer-and-boost.json
};
```

- **Touch inputs** (`button`, `stick`, `dpad`, `swipe-pad`, `hold-meter`) need a control of the same **kind** (vector, press, swipe, charge…) with the input's name. A D-pad can stand in for a stick, but a button can't.
- **Motion inputs** (`pointer`, `tilt`, `shake`) are switched on per layout with checkboxes; they have no on-screen control. If the layout switches the motion on and the phone allows it, the motion input drives the game. Otherwise a touch control with the input's name stands in, so `steer` above falls back to the layout's `steer` stick. (Richer motion fallbacks are still to be designed.)
- **Different names:** use `controller: { layout: 'x', bind: { boost: 'a' } }`.
- **No layout chosen:** the game gets a generated default from its inputs.

The designer shows which games use each layout, and flags inputs a layout can't satisfy. The test suite checks this for every game too.

The game then receives:

- **Press-channel controls** (`button`, `swipe-pad`, `hold-meter`, plus `shake`) as timestamped `Press` edges, across four slots. A controller can have at most 4.
- **Values** in `InputFrame.values[action]`, typed with `StickOutput`, `DpadOutput`, `SwipeOutput` and `HoldOutput` from [types.ts](types.ts). Rotated controls report in the frame the player sees, so a D-pad turned 90° still says "right" when the player presses the arm pointing right.

The **Game receives** line in the gallery is the contract for each control.

## Designing a controller

Run the dev server over HTTPS (`HTTPS=1 npm run dev`) and open **`/?role=designer`**. Everything happens on that one address: the designer, the phone preview, and games.

1. **Open the library.** It lists every layout with a live thumbnail, its motion inputs, and the games using it. You can create a **New layout** (blank or from a template, portrait or landscape), or **Duplicate**, **Preview**, **Edit** or **Delete** an existing one. You can't delete a layout while a game uses it.
2. **Name it.** The name you type becomes the file name (`src/layouts/<id>.json`) and is fixed once created. The display name can change anytime.
3. **Place touch controls.** Drag them from the palette, or click one to drop it in the first free spot. The phone is an uninterrupted grid: 12×24 cells in portrait, 24×12 in landscape. The hatched corner is reserved for the in-game menu button, and you can move it with the top-bar menu.
4. **Switch on motion** with the checkboxes under the palette.
5. **Adjust controls:**
   - drag to move, and drag a corner to resize (everything snaps to the grid)
   - `R` rotates 90°
   - arrow keys nudge, and ⇧ + arrows resize
   - Delete removes
   - ⌘Z undoes
6. **Tune them in the inspector:** name (what game inputs bind to), label, which control it is, variant, props and rotation. Each control's editable props come from `fields` in its `definition.ts`. With nothing selected, the inspector shows which games use the layout and whether every one of their inputs has a control.
7. **Fix the checks.** Items that overlap, stray off the grid, cover the menu, are smaller than their `minSize`, or share a name turn red and block saving.
8. **Save.** Valid layouts autosave; commit the JSON. The generated `src/layouts/index.ts` updates when layouts are created or deleted.
9. **Test on a phone.** **Test on phone** shows a QR code for `/?role=preview&layout=<id>` on this computer's LAN address. The preview hot-reloads on every save, so the phone follows your edits live. If the phone is held the wrong way it asks you to rotate it, and tapping the menu corner shows what each control sends.

**Play** in the designer lets you use the controls with the mouse and shows their output in the inspector.

## Anatomy of a control

Each control is a folder with the same files:

| File            | Role                                                                                                                                                                                                                                                       |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `definition.ts` | Pure data: type, name, `channel` (`press` / `value` / `both`), output `kind`, `throttle`, documented `output`, default `hint`, `variants`, `defaults`, designer `fields`, `minSize` (grid cells), and `rotateOutput` for directional values. **No React.** |
| `logic.ts`      | Pure gesture math (unit-tested in `tests/controls.test.ts`). Optional when there's none (e.g. button).                                                                                                                                                     |
| `<Name>.tsx`    | The view: composes `ControlFrame` + `useTrackedPointer` and talks only to its `ControlPort`.                                                                                                                                                               |
| `styles.css`    | Classes `.ctl-<type>__part`, using only `--ctl-*` tokens.                                                                                                                                                                                                  |

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
