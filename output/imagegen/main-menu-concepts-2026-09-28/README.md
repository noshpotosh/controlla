# Controlla main-menu concepts

Follow-up: [three Toybox-style main menus](../toybox-main-menu-2026-09-28/README.md) explore the user's newer wooden game-screen reference.

Three original landscape raster mockups exploring the collection-wide Create Room / Join Room menu. Generated on 2026-09-28 with the built-in image generation tool. The supplied Honey Hustle references informed the cheerful shapes, colors and tactile materials, without adopting honey-themed branding for the collection.

| Concept | Image | Direction |
| --- | --- | --- |
| Party Islands | [01-party-islands.png](01-party-islands.png) | Sunny sculpted 3D worlds, varied minigame scenery and two prominent central actions. Closest to the references' vivid game-world presentation. |
| Pop Playground | [02-pop-playground.png](02-pop-playground.png) | Bold graphic typography, stacked controls and tactile party objects. Recommended starting point for a flexible collection-wide visual language. |
| Tabletop Clubhouse | [03-tabletop-clubhouse.png](03-tabletop-clubhouse.png) | Warm cardstock and painted game pieces, with two actions inside a central panel. Cozier and more handmade. |

These are initial big-screen menus, not implemented screens. Create Room leads to hosting. Join Room should distinguish another screen from a phone controller on the next step; phone joining has additional screen identification requirements. No claim is made that the room flow has changed in code.

Full generation instructions are saved in [prompts.md](prompts.md). All three PNGs are 1672 × 941 pixels, approximately 16:9.

Visual verification: inspected every generated image for the Controlla branding, Create Room and Join Room labels, phone-controller helper, How to Play, settings control, and overall layout. These are concept assets; no application tests were needed or run. Before implementation, refine button-text contrast and actual TV readability. The Tabletop image includes incidental decorative lettering on a background poster; this is generated scenery, not proposed product copy.

Recovery: all three directions share branch `codex/main-menu-concepts-0928`, based on freshly fetched `origin/main` at `eb7ffbb`. The isolated worktree is `.worktrees/main-menu-concepts-0928` under the main repository. Existing architecture changes and earlier artwork in the original checkout were preserved.
