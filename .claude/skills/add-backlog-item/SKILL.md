---
name: add-backlog-item
description: Add, refine, reorder, split or drop items in the Controlla backlog (docs/BACKLOG.md and docs/backlog/), writing each item so an agent can build it without help until on-device testing. Use when the user describes work for later, such as a bug, feature, polish, cleanup, "add this to the backlog", "we should…" or "todo", or wants to change an existing backlog item, even if they don't mention the backlog.
---

# Add a backlog item

`docs/backlog/README.md` holds the rules, including the definition of ready, and
`docs/backlog/TEMPLATE.md` holds the item format. Read both first. This skill is
the procedure.

A minigame idea that is only being brainstormed belongs in `docs/MINIGAMES.md`
(the add-minigame-idea skill). It becomes a backlog item once the user wants it
built.

## Steps

1. Read `docs/BACKLOG.md` and skim the existing items. If one already covers the
   request, amend it rather than adding a duplicate. If the user gave several
   items at once, handle each one.
2. Research before writing. Find the code, docs and tests the work touches and
   describe how they behave today, using real paths. This research is what lets
   an agent build the item without the user.
3. Draft the item from the template. Turn the user's words into a Goal, Scope,
   Decisions and Acceptance criteria. Tag every criterion `(test)`, `(desktop)`,
   `(device)` or `(doc)`, and write the human test plan so that every `(device)`
   criterion has a step with an expected result.
4. Settle the decisions. For each choice that would change what gets built:
   - If the codebase or an earlier decision gives an obvious default, take it
     and write it under Decisions.
   - Otherwise ask the user. Batch the questions, up to four at a time, and give
     each a recommended option. Don't ask anything the codebase can answer.

   Anything still unanswered goes under Open questions, and the item is a Draft.

5. Check the size. If the item won't fit one branch and one sitting of testing,
   split it into items linked by **Depends on**, and tell the user.
6. Write `docs/backlog/BL-NNN-<slug>.md`, using the next unused number from the
   guide, and add its line to `docs/BACKLOG.md` under Ready or Draft. A new
   Ready item goes at the bottom unless the user gives it a priority.
7. Run `npx oxfmt` on the files you changed.
8. Commit only the backlog files, on a `docs/backlog…` branch as the guide
   describes, and push. Offer to merge into `develop` so agents can pick the
   item up.
9. Tell the user the ID and title, whether it's Ready or a Draft, the decisions
   you made for them (so they can overrule any), and anything still open. Keep it
   short and link the file.
