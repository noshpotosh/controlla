# Shared Git policy

Keep work recoverable and make collaboration easy. Apply this policy to all repository work, including delegated agents. Explicit task instructions take precedence.

## Act without routine permission requests

- For implementation tasks, creating topic branches/worktrees, fetching, selectively committing your work, and pushing checkpoints to the existing collaboration remote are authorized. Do them without waiting for reminders or asking at every checkpoint.
- Respect requests for read-only, draft-only, or local-only work. Routine checkpoint authorization does not authorize merging into `main`, releasing, or deploying.
- Use `origin` as the collaboration remote and `main` as the integration branch; verify the actual remote and branch configuration before use. Do not change remotes, credentials, Git identity, or branch protections to get an operation through.

## Start on the right branch

- Before editing, inspect `git status --short --branch`, staged and unstaged diffs, upstream tracking, and `git worktree list`. Treat unfamiliar changes as a collaborator's work until ownership is established.
- Continue the current topic branch when it belongs to this task and this checkout is not being used concurrently. For a new idea or independent task, create a unique branch such as `codex/controller-layout-a1b2`; never start implementation directly on `main` or a release branch.
- Fetch before choosing a baseline. Start independent work from `origin/main`; start dependent work or alternative experiments from the relevant committed checkpoint. State the chosen baseline. If fetching is unavailable, use a known local commit and report that its freshness is unverified.
- Preserve pre-existing work and staged changes. Never automatically stash, discard, clean, reset, switch branches under another worker, or include someone else's edits in your commit. If ownership is unclear, isolate independent work; ask only when that ambiguity blocks the task.

## Use worktrees where they help

- Prefer separate worktrees for parallel implementation, competing approaches, long experiments, or a checkout already occupied by another task. Simple sequential work can stay in its existing suitable checkout.
- Give each concurrent writer a distinct branch and worktree. Assign a clear scope and base commit before delegation. Read-only reviewers can share a checkout; do not let multiple writers share an index or working files.
- A worktree starts from committed history and does not copy uncommitted changes. Checkpoint task-owned prerequisites first when safe; never silently omit needed dirty work or copy unrelated edits. If the prerequisite belongs to someone else, coordinate only that dependency.
- Before integrating parallel work, inspect its commits and changes, merge or cherry-pick the intended commits into the task branch, then validate the combined result. Preserve source branches until their work is integrated and backed up.

## Save useful checkpoints

- Commit after a coherent improvement, before a risky rewrite or changing direction, and before handoff or ending an implementation session. During long work, save meaningful intermediate progress instead of waiting for everything to be finished. Do not create empty commits or commit every tiny edit.
- Distinguish a verified checkpoint from a saved experiment. Run checks appropriate to the change; record what passed, failed, or was skipped in the commit body. Use `wip: <what is saved>` for incomplete or unverified checkpoints, with remaining work explained. Never describe untested work as known-good.
- Stage explicit files or hunks and inspect the entire staged diff before committing. Avoid blanket `git add .`, `git add -A`, and `git commit -a`. Do not commit secrets, machine-specific local configuration, dependency directories, build output, or unrelated generated files.
- Recheck the branch and index immediately before Git mutations. If unexpected edits or staged changes appear, preserve them and isolate your work instead of racing another writer or absorbing their changes.
- Push each meaningful checkpoint to the explicit topic branch, setting its upstream on the first push: `git push -u origin <topic-branch>`. Review outgoing commits first. Never use a blanket push, push directly to `main`, or force a rejected push under this standing authorization.
- If a push is blocked by network, authentication, permissions, or a remote update, keep the local commits and report the exact blocker and unpushed commit IDs. Do not claim they are backed up remotely. Continue independent work when possible.

## Preserve alternatives and shared history

- Before replacing an approach, commit and push the current task-owned state, then branch the alternative from the chosen checkpoint. If pushing is unavailable, retain the local checkpoint and branch while reporting the missing remote backup.
- Inspect an earlier attempt in another worktree; recover it with a new branch, selected cherry-picks, or a revert commit. Preserve subsequent work so both versions remain available.
- Prefer additive commits, including `git revert` for undoing shared changes. Do not amend or rebase published commits, force-push (including `--force-with-lease`), run destructive resets/cleans, or delete branches containing unmerged or unpushed work without explicit authorization for that operation.
- On divergence, fetch and inspect before proceeding. Incorporate understood upstream changes with a merge on the task branch; resolve only conflicts whose intended behavior is clear. Ask about ambiguous intent without overwriting a collaborator's work. Do not use an implicit `git pull` strategy or automatically rebase shared history.
- Use pull requests for integration into `main`. Preparing a draft PR is allowed when useful; marking work ready requires appropriate validation, and merging requires explicit task authorization. Do not bypass required checks or reviews.
- Do not automatically remove experiment branches or worktrees at task completion. Cleanup must preserve unique commits and dirty files, and must not disturb another worker.

## Leave a recoverable handoff

- Report the branch, worktree path if applicable, latest checkpoint commit, validation results, and whether the remote push succeeded. Identify remaining task work and any pre-existing changes left untouched.
- When comparing approaches, name the branch or commit for each and identify the last verified checkpoint. Keep this information in the handoff or PR so a teammate can resume or recover an earlier version without relying on one agent's memory.
