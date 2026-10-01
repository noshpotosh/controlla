---
name: work-backlog-item
description: Build a Controlla backlog item end to end (branch, implement, test, hand off for on-device testing) following docs/backlog/README.md, then record the user's test results and close it. Use when the user says "work on BL-007", "pick up the next backlog item" or "what's next on the backlog", reports test results for a backlog item, or asks to close one.
---

# Work a backlog item

The "Working an item" section of `docs/backlog/README.md` is the source of
truth. This is the checklist.

## Start

1. Read the guide, `docs/BACKLOG.md` and the item. Use the item the user named,
   or else the top Ready item whose dependencies are Done.
2. If the item isn't Ready, because it has open questions, no test plan or
   criteria you can't check, don't start. Say what's missing and offer to fix it
   with the add-backlog-item skill.
3. Look for an existing branch with `git branch -a --list '*bl-NNN*'`. If there
   is one, continue it.
4. Otherwise branch as the guide and `AGENTS.md` describe, and state the
   baseline commit. In the first commit, move the item to In progress and fill
   in its Branch.

## Build

5. Work through the acceptance criteria without stopping to ask. Follow the
   guide's "Decide; don't ask" rules. Stop only in its "Stop and ask" cases,
   which mark the item Blocked.
6. Commit coherent checkpoints and push the branch as you go.

## Validate and hand off

7. Run the four checks from the guide. For `(desktop)` criteria, run the app and
   check it with the browser tools.
8. Fill in Handoff, add a validation ledger entry, move the item to Needs
   testing, then commit and push.
9. Reply with the branch and commit, the check results, what you couldn't
   verify, the decisions you made, and the human test plan with the commands to
   start it. The user's next step is testing, so make that easy.

## After testing

10. Record the user's results under Test results: date, device and the outcome
    of each step.
11. If steps fail, fix them on the same branch, run the checks again, update
    Handoff and hand off again.
12. When everything passes, move the item to Done with the date, then commit and
    push. Offer to merge into `develop`, and merge only when the user says so.
    Confirm the source, target and anything excluded first.
