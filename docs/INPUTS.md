# Input glossary

Every controller input a minigame can ask for, what it senses on the phone, and what the game receives. **Used by** links to the ideas in [MINIGAMES.md](MINIGAMES.md), so the inputs that many games need stand out.

Names are the `WidgetType` values in [src/core/types.ts](../src/core/types.ts); behaviour is implemented in [src/client/Widgets.tsx](../src/client/Widgets.tsx) and, for motion, [src/client/runtime.ts](../src/client/runtime.ts).

## Touch

| Input         | Senses                                    | Game receives                                                                        | Used by                                                             |
| ------------- | ----------------------------------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------- |
| `button`      | A tap or press and hold                   | Pressed / released                                                                   | [Latency Lab](MINIGAMES.md)                                         |
| `dpad`        | Holding one of four arrow buttons         | Direction `{x, y}` of −1, 0 or 1; `{0, 0}` on release                                |                                                                     |
| `stick`       | A finger dragged from the widget's center | Direction `{x, y}` from −1 to 1, with a small dead zone; `{0, 0}` on release         | Fallback in [Latency Lab](MINIGAMES.md), [Tilt Rally](MINIGAMES.md) |
| `swipe-pad`   | A quick swipe across the pad              | On lift-off: direction, distance and speed of the swipe (ignored if very short)      | [Tilt Rally](MINIGAMES.md)                                          |
| `draw-canvas` | A finger drawing                          | Position (0–1) and pressure while the finger moves                                   |                                                                     |
| `slider`      | A slider thumb dragged                    | A value from 0 to 1                                                                  |                                                                     |
| `dial`        | A finger circling the widget              | Total angle turned, in radians; keeps counting past one full turn                    |                                                                     |
| `hold-meter`  | How long a finger stays down              | Charge from 0 to 1, filling over the hold time (0.8 s by default); resets on release |                                                                     |
| `text`        | Typing and pressing Send                  | The text, up to 120 characters                                                       |                                                                     |

## Motion

These need motion permission on the phone (the **Enable motion** button).

| Input     | Senses                                    | Game receives                                                                                                                                                                | Used by                                                          |
| --------- | ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `pointer` | Rotation (gyro), phone held like a remote | A position on the screen (0–1). Moves like a mouse: turn speed moves the cursor, quick flicks go further. Adjustable sensitivity; push past an edge or Recenter to re-center | [Latency Lab](MINIGAMES.md)                                      |
| `tilt`    | Which way is down (gravity)               | Left–right and forward–back tilt from −1 to 1; full scale at about 38° of tilt                                                                                               | [Tilt Rally](MINIGAMES.md), [Don't Spill the Milk](MINIGAMES.md) |
| `shake`   | A hard, sudden movement in any direction  | A single event when acceleration passes about 1.8 g, at most once every 0.6 s; no direction                                                                                  |                                                                  |

## Needed (not built)

| Input  | Senses                                             | Game receives                                                       | Used by                              |
| ------ | -------------------------------------------------- | ------------------------------------------------------------------- | ------------------------------------ |
| `jolt` | Sudden movement (acceleration) and rotation (gyro) | Which way the phone moved sharply (up, down, left, right) or turned | [Don't Spill the Milk](MINIGAMES.md) |
