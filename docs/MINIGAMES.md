# Minigame ideas

Add a row per idea. Description is optional. For controls, use the input names from the [input glossary](INPUTS.md) where they fit, and mark anything new `(new)` so we can see which inputs to build next.

| Name                  | Description                                                                                                                                        | Controls / sensors                                    |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| Latency Lab _(built)_ | Aim and react: reaction, tracking, strobe and fairness modes.                                                                                      | `pointer` (falls back to `stick`), `button`           |
| Tilt Rally _(built)_  | Race by steering with the phone; swipe for speed.                                                                                                  | `tilt` (falls back to `stick`), `swipe-pad`           |
| Don't Spill the Milk  | Hold your phone upright with a full glass of milk on it; turn, duck and dodge through an obstacle course without spilling. Fullest glass (%) wins. | `tilt`, `jolt` (new)                                  |
| Bowling               | Aim your shot, then swing the phone forward like a bowling arm to release the ball.                                                                | `tilt`, `jolt` (new)                                  |
| Golf                  | Aim your shot, then swing the phone to putt or drive.                                                                                              | `tilt`, `jolt` (new)                                  |
| Basketball            | Swipe to shoot at hoops that move around and physically collide with the ball.                                                                     | `swipe-pad`                                           |
| Shape Flash           | A random shape flashes on screen for 5s; players redraw it from memory and closest match wins.                                                     | `draw-canvas`                                         |
| Target Practice       | Aim with the phone; targets disappear once a player hits them, scoring points per hit.                                                             | `pointer`, `button`                                   |
| Kart Racer            | Steer with the phone; swipe or press for boosts and items.                                                                                         | `tilt` (falls back to `stick`), `swipe-pad`, `button` |
| Chop Shop             | Cooking Mama-style prep: chop and slice ingredients with quick down-swings and swipes.                                                             | `jolt` (new), `swipe-pad`                             |
| Showdown Chop         | Wii Sports Resort-style chopping: swing in the direction shown by the arrow before time runs out.                                                  | `dpad`, `jolt` (new)                                  |
| Brawl                 | Fighting game: move and block with a stick or dpad, attack with buttons.                                                                           | `stick` (or `dpad`), `button`                         |
| Saber Slash           | Beat Saber-style rhythm slasher: swipe in the shown direction as notes arrive.                                                                     | `swipe-pad`                                           |
| Jam Session           | Rock Band-style rhythm game; each player gets a different part (drums, guitar, vocals) with its own input.                                         | `button`, `dpad`, `swipe-pad`                         |
| Darts                 | Aim with the phone, then flick to throw at the board.                                                                                              | `pointer`, `swipe-pad`                                |
| Bomb Squad            | Defuse the bomb by cutting wires, turning dials and entering codes before time runs out.                                                           | `button`, `dial`, `text`                              |

What each input senses, what the game receives, and which games use it: [INPUTS.md](INPUTS.md).
