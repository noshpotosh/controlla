---
name: add-minigame-idea
description: Record a Controlla minigame idea in docs/MINIGAMES.md with the input controls it needs, and keep the input glossary in docs/INPUTS.md in sync. Use when the user describes, pitches, or brainstorms a minigame ("game idea", "what if players…", "add this to the list"), even if they don't mention the file.
---

# Add a minigame idea

Two files work together:
- `docs/MINIGAMES.md`: a table with the columns **Name | Description | Controls / sensors**. Its only job is to show which **input controls** each game needs.
- `docs/INPUTS.md`: the input glossary. It has one row per input, grouped as Touch, Motion and Needed (not built), and each row has a **Used by** column that links back to games in MINIGAMES.md.

Stay at the level of inputs: what the player does with the phone. Leave out visuals, on-screen rendering, scoring details, fallbacks and edge cases; those get worked out when each game is built.

## Steps

1. Read both files. The glossary lists every existing input. If the idea is already in MINIGAMES.md, update that row instead of adding a new one.
2. Add a row at the bottom of MINIGAMES.md:
   - **Name:** the user's name for the game.
   - **Description:** optional; at most a sentence or two in the user's words.
   - **Controls / sensors:** a comma-separated list of input names in backticks, such as `` `tilt`, `button` ``. Use glossary names where they fit. For an input nothing covers, give it a short name and mark it `(new)`. Nothing else goes in this cell.
     - Describe inputs by what the phone can actually sense: touch, which way is down (tilt), rotation (gyro), or sudden movement (acceleration). A player "ducking" is the phone dropping; the phone can't see a body.
3. Update INPUTS.md:
   - For each input the game uses, add `[Game name](MINIGAMES.md)` to that row's **Used by** cell, comma-separated.
   - For a `(new)` input not yet in the glossary, add a row under **Needed (not built)** with what it senses and what the game would receive, in a few words each.
4. Run `npx oxfmt docs/MINIGAMES.md docs/INPUTS.md` to realign the tables.
5. Show the user the row you added and any new inputs. Don't commit unless they ask.
