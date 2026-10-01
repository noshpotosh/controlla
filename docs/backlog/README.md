# Backlog guide

The [backlog](../BACKLOG.md) lists outstanding Controlla work. Each item is
written so an agent can build it from start to finish without asking anything.
The user decides what goes in and tests the result on a phone. This guide is for
anyone who writes or works items: the user, Claude, Codex or another agent.

## Files

- [`docs/BACKLOG.md`](../BACKLOG.md) is the index. It has one line per item,
  grouped by status. Items under **Ready** are in priority order, and the top
  one is next. To reprioritize, move a line.
- `docs/backlog/BL-NNN-<slug>.md` holds one item and follows
  [`TEMPLATE.md`](TEMPLATE.md). IDs have three digits and are never reused. The
  next ID is one more than the highest in this folder, on `develop` or on any
  unmerged `docs/backlog…` branch.

An item's status is the section of the index it is listed under. Item files
don't repeat it. Done and dropped items keep their files as a record.

Index lines look like these (examples, not real items):

```md
- [BL-007 Screen picker remembers the last screen](backlog/BL-007-screen-picker-memory.md): one-line summary.
- [BL-003 Haptic tick on pickups](backlog/BL-003-pickup-haptics.md): closed 2026-10-04.
- [BL-005 Spectator mode](backlog/BL-005-spectator-mode.md): dropped 2026-10-02, replaced by BL-009.
```

## Statuses

| Status        | Meaning                                                                  |
| ------------- | ------------------------------------------------------------------------ |
| Draft         | Captured, but it still has open questions. Don't work it.                |
| Ready         | Meets the definition of ready below. Any agent may pick it up.           |
| In progress   | An agent is building it on `feature/bl-NNN-<slug>`.                      |
| Needs testing | Built and checked. Waiting for the user's on-device test.                |
| Blocked       | Work stopped on a question the agent couldn't settle. The item holds it. |
| Done          | Tested and accepted. Listed newest first with the date it closed.        |
| Dropped       | Not doing it. The index line says why.                                   |

In progress, Needs testing and Blocked are committed on the item's branch, so
they reach `develop` only when that branch merges. On `develop`, an item usually
goes straight from Ready to Done. To see what's in flight:

```sh
git fetch origin && git branch -a --list '*bl-*'
```

## Definition of ready

An item is **Ready** when all of these hold. Otherwise it is a **Draft**.

1. **Goal** says what changes for players or for us, and why.
2. **Context** names the files, docs and tests involved, as they are on
   `develop`, and describes how things behave today. Paths are real, not
   guessed.
3. **Decisions** settle every choice that changes what gets built: look and
   wording, numbers (timings, sizes, thresholds), which games and screens are
   affected, names. If a value needs tuning on the phone, the item gives a
   starting value and says so.
4. **Scope** lists what is out as well as what is in.
5. Every **acceptance criterion** can be checked, and its tag says how:
   - `(test)`: an automated test the agent adds or updates.
   - `(desktop)`: a check the agent runs in a desktop browser.
   - `(device)`: a step in the human test plan.
   - `(doc)`: a written deliverable, such as a review, a decision record or new
     backlog items. The agent checks it against the criterion, and the user
     reads it during testing.
6. The **human test plan** covers every `(device)` criterion, and each step has
   an expected result.
7. **Depends on** names only items that are Done. If a dependency is not merged
   yet, the item names the branch to start from instead.
8. **Open questions** is empty.

### Size

An item should fit one branch, one agent session and one sitting of testing. If
the test plan runs past about ten steps, or the work spans unrelated areas,
split it into items linked by **Depends on**.

## Working an item

### 1. Pick and claim

- Take the item the user named, or else the top Ready item whose dependencies
  are Done. If it isn't Ready, don't start. Say what's missing.
- Check for an existing branch with `git branch -a --list '*bl-NNN*'`. If there
  is one, continue it.

### 2. Branch

Follow [AGENTS.md](../../AGENTS.md). In this repo that means:

- Fetch, then branch `feature/bl-NNN-<slug>` from `origin/develop`. If a
  dependency isn't merged yet, branch from its branch instead and record that
  in the item's handoff. State the baseline commit.
- Work in the main checkout and switch branches there. Don't create worktrees
  unless the user asks. Work one item at a time per checkout.
- The user keeps some long-lived local files, such as
  `src/client/controls/layouts/test.json` and the `index.ts` line that
  registers it. Leave them alone and out of commits. Stage explicit paths.
- In the first commit, move the item to **In progress** in the index and fill
  in **Branch** in the item.

### 3. Build

- Meet each acceptance criterion. Add or update tests in `tests/`, following
  the existing files.
- Update docs that describe behavior you changed, such as the README,
  `docs/architecture/`, `docs/INPUTS.md` and `docs/MINIGAMES.md`.
- Commit coherent checkpoints and push the branch as you go.

### 4. Decide; don't ask

When something comes up that the item doesn't cover:

- Prefer the smallest change that meets the criteria and reads like the
  surrounding code.
- Reuse existing controls, contracts and patterns before adding new ones.
- Leave behavior outside the item unchanged.
- Record the choice under **Handoff → Decisions made while building**, so the
  user can review it while testing.

### 5. Stop and ask

Stop only in these cases:

- Acceptance criteria conflict with each other or with how the code really
  works, and the Goal doesn't settle which one wins.
- Finishing would need something listed as out of scope, a change to the
  application protocol, signaling security or saved-data formats that the item
  doesn't cover, or a new npm dependency the item doesn't allow.
- A test would have to be deleted or weakened for any reason other than the
  item deliberately changing that behavior.
- A motion pointer game would opt out of anchored aim (`anchor: false`). The
  user wants to be asked first.

To stop: write the question under **Open questions**, with options and a
recommendation. Move the item to **Blocked**, then commit, push and tell the
user.

### 6. Validate

Run `npm test`, `npm run typecheck`, `npm run lint` and `npm run build`. All
must pass. The exception is a failure that the latest
[validation ledger](../VALIDATION.md) entry already records as pre-existing.
Note that you saw it.

For `(desktop)` criteria, run the app as in the README's "Run locally" section
and check it in a browser. Separate tabs can act as phones using touch and
mouse fallback. Real motion, multitouch, vibration, latency and anything
iPhone-specific can't be checked on a desktop, so those belong in the human
test plan.

### 7. Hand off for testing

- Fill in the item's **Handoff**: branch and last commit, check results, what
  you couldn't verify, and the decisions you made while building. Tighten the
  human test plan if the build changed any steps.
- Add a dated entry to the [validation ledger](../VALIDATION.md) in its
  existing format.
- Move the item to **Needs testing**, then commit and push.
- Tell the user the branch, what to run and the test plan, so they can start
  testing without reading anything else.

## Testing and closing

The user tests on an iPhone 13. Android is untested. The usual setup is to check
out the item's branch, run `npm run dev:phone`, and open the printed URL on the
laptop and the phone. For Wi-Fi or latency checks, use `npm run dev:lan`
instead. See [phone development](../PHONE-DEVELOPMENT.md).

- Record results under **Test results**: date, device, and the outcome of each
  step.
- If steps fail, fix them on the same branch, run the checks again, update the
  handoff and hand off again.
- When everything passes, move the item to **Done** with the date, then commit
  and push. The branch merges into `develop` only when the user asks.

## Editing the backlog

Adding, refining, reordering, splitting and dropping items change only docs.
Commit just the backlog files on a `docs/backlog…` branch made from
`origin/develop`, or continue an unmerged one, and push it. Agents start from
`develop`, so a new item isn't available to them until the user merges that
branch. If switching to the backlog branch would disturb another task's
uncommitted work, ask first.

Status changes made while working an item are committed on that item's branch
instead.

## Claude skills

Claude has two project skills that follow this guide:
[`add-backlog-item`](../../.claude/skills/add-backlog-item/SKILL.md) and
[`work-backlog-item`](../../.claude/skills/work-backlog-item/SKILL.md). Other
agents can follow this guide directly.
