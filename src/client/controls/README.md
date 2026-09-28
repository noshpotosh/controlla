# Controlla controls

The phone-side component library. A game names the inputs it needs; the phone renders a consistent controller from these controls; the game reads back semantic values. **Games never draw their own controls.**

On the development server, open **`/?role=gallery`** on a phone to play with every control and layout, with a live readout of what the game receives. Deep links: `?role=gallery&tab=layouts&layout=duo&landscape`.

## Using controls in a game

A **control** is a primitive; a **layout** composes controls; an **action** is the game input name. Layouts live in [src/client/controls/layouts](./layouts) and are designed at `/?role=designer`. Games declare controller requirements in `GameDescriptor.controls`, using the public [game API](../api/index.ts):

```ts
import type { ControllerRequirements } from '../../api/index.ts';

const controls: ControllerRequirements = {
  inputs: {
    aim: { prefer: 'pointer', fallback: 'aim-pad', required: true },
    pulse: { prefer: 'button', required: true },
  },
  controller: { layout: 'aim-and-pulse' },
};
// Set the game's descriptor.controls to these requirements.
```

The engine's `controllerSpec(descriptor)` adapter passes only the identity and controller requirements to the resolver. Its `ControllerSpec` has no scoring, lifecycle or snapshot policy. The shared [controls API](api.ts) owns this type, `WidgetType`, layouts, capabilities, resolved configurations, control definitions, output values and `ControlPort`; it has no runtime or UI imports. [types.ts](types.ts) contains the view props used by React controls.

- **Touch inputs** (`button`, `stick`, `aim-pad`, `dpad`, `swipe-pad`, `hold-meter`) need a control of the same **kind** (vector, press, swipe, charge…) with the input's name. A D-pad can stand in for a stick, but a button can't.
- **Motion inputs** (`pointer`, `tilt`, `shake`) are switched on per layout with checkboxes; they have no on-screen control. If the layout switches the motion on and the phone allows it, the motion input drives the game. Otherwise a touch control with the input's name stands in, so `aim` above falls back to the layout's `aim` pad. (Richer motion fallbacks are still to be designed.)
- **Different names:** use `controller: { layout: 'x', bind: { pulse: 'a' } }` inside the descriptor's `controls`.
- **No layout chosen:** the game gets a generated default from its inputs.

[`resolveConfig(spec, capabilities, generation)`](resolve.ts) is the validated entry point: it selects or generates a layout, checks the layout and named bindings, resolves permissions/fallbacks, then checks transport capacity before returning a complete configuration. Required inputs without an available fallback fail through the existing configuration-error path.

The binary frame supports **one resolved motion vector**: at most one action may resolve to `pointer` or `tilt`, including repeated actions using the same sensor. A conflict names the actions and throws; it never disables an action or silently substitutes a fallback. Unused motion toggles do not count. Multiple touch vectors are valid, including denied-motion fallbacks alongside one available motion action. Shake uses the existing four-press-slot budget. Application protocol 4, layout schema 2, resolved configuration schema 1, and the binary frame stay unchanged.

The designer shows which games use each layout, and flags inputs a layout can't satisfy. The test suite checks this for every game too.

Games receive semantic input through `GameInput`:

- `input.values[playerId][action]` contains a detached `{ value, time, observedAt? }` sample. `time` preserves capture time; `observedAt` records a validated observation of a held value when available.
- `input.actions` contains accepted press actions with a name, source timestamp and captured aim. A value-bearing press includes its own detached `value`.

Game authors use the public game API, which reexports output shapes such as `StickOutput`, `DpadOutput`, `SwipeOutput` and `HoldOutput`. They do not consume `InputFrame`, press slots, configuration generations or transport packets. Control views emit raw values through `ControlPort`; the controller/session adapters rotate, validate and map those values to semantic actions. Aim from a signed touch control is normalized before reaching the game.

**Aim pad** maps the entire control rectangle to signed `{x, y}` coordinates from −1 to 1. It starts at the center, retains its last accepted position on release, cancel, lost capture, or unmount, and emits no activation. Arrow keys move the retained position; Home explicitly centers it. The reusable `aim-and-pulse` layout pairs it with a separate `pulse` button and can substitute it for motion aim. Runtime suspension still clears cached input and retires the port like other controls.

The **Game receives** line in the gallery is the contract for each control. The gallery, designer, phone preview and Motion Lab are development-only; calibration, connection diagnostics and reports remain available during production play.

## Designing a controller

Run the dev server over HTTPS (`HTTPS=1 npm run dev`) and open **`/?role=designer`**. Everything happens on that one address: the designer, the phone preview, and games.

1. **Open the library.** It lists every layout with a live thumbnail, its motion inputs, and the games using it. You can create a **New layout** (blank or from a template, portrait or landscape), or **Duplicate**, **Preview**, **Edit** or **Delete** an existing one. You can't delete a layout while a game uses it.
2. **Name it.** The name you type becomes the file name (`src/client/controls/layouts/<id>.json`) and is fixed once created. The display name can change anytime.
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
8. **Save.** Valid layouts autosave; commit the JSON. The generated `src/client/controls/layouts/index.ts` updates when layouts are created or deleted.
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

All room participants and the signaling server must use the same application protocol version. After an upgrade, reload screens and phones; version mismatches stop connection retries and show a reload message.

The shared kit:

- `kit/ControlFrame.tsx`: the shell that draws the caption, hint, active state, variant class and focus ring.
- `kit/useTrackedPointer.ts`: single-finger capture that always ends cleanly.
- `kit/geometry.ts`: clamp, dead zone and direction snapping.
- `kit/icons.ts`: the only icon vocabulary games may name.

`registry.ts` (pure) and `views.ts` (React) list every control. The controller/session adapter owns configuration acknowledgement, packet generations and stale-input checks. The runtime reads `channel` and `throttle` from the registry, so a new control needs no runtime changes when it uses an existing output shape. Throttled values retain the latest sample's original generation, sequence and authority-clock timestamp. Values are cloned at sampling and validated at the authority. Ports belong to one configuration; retired callbacks are inert. A value-bearing activation carries its own detached `Press.value`, rather than depending on the latest continuous value reaching the host first. Only press-only controls use binary edge recovery; the binary frame retains four slots.

## Adding a control

```bash
npm run control:new -- my-control
```

This scaffolds the four files and registers the control in `registry.ts`, `views.ts`, `controls.css`, the `WidgetType` union in [api.ts](api.ts), and [docs/INPUTS.md](../../../docs/INPUTS.md). It does not modify core types or runtime code. Keep the `/* control-generator:imports */` marker after the control stylesheet imports so future controls can register there. Duplicate types fail before creating files. Then fill in the definition, build the view, and check it in the gallery. To show named demo options in the gallery, add an `OPTIONS` entry in [the development gallery](../devtools/gallery/Gallery.tsx).

## Copying a control for a special case

```bash
npm run control:new -- big-red-button --from button
```

This copies the folder under a new type, renaming symbols owned by the control, its component file, class prefix and definition. Shared imports and output types keep their names; the original is untouched.

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
