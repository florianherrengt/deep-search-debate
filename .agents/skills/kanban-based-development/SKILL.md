---
name: kanban-based-development
description: >
  Autonomous, parallel-safe development workflow using kanban-md, repository
  worktrees, review-before-commit task code, and committed board state on main.
  Use when the user asks to work through a ticket, issue, task, or board, asks
  for kanban-based development, or when multiple agents coordinate this codebase.
allowed-tools:
  - Bash(kanban-md *)
  - Bash(kbmd *)
  - Bash(git *)
  - Bash(npm run worktree:create *)
---
<!-- kanban-md-skill-version: 0.38.0 -->

# Kanban-Based Development

Use `kanban-md` as the shared coordination layer, isolated `.worktrees/` for
task code, and local `main` as the integration target.

## Non-negotiable invariants

- Run every `kanban-md` command from the canonical repository checkout that
  owns the board, called `<board-home>`. It must be on `main`.
- The board is shared. Claim a task before code changes, keep one active claim,
  never steal or release another agent's claim, and do not run mutating board
  commands concurrently.
- Commit every board mutation, or one short atomic batch of related mutations,
  on `main`. Do not leave `kanban/` changes uncommitted at a handoff, context
  switch, or task completion.
- Preserve other agents' board updates. Review and commit the complete coherent
  `kanban/` snapshot; never reset, discard, or selectively overwrite their
  changes.
- Task code belongs in a repository-managed worktree under `<board-home>/.worktrees/`.
  Create or attach it with `npm run worktree:create -- <branch> [start-point]`;
  never call `git worktree add` directly.
- Keep task code uncommitted in its worktree when implementation is ready for
  review. Moving a ticket to `review` authorizes a board commit, not a task-code
  commit or merge.
- Commit and merge task code only after the user explicitly approves it. An
  unqualified user request to `merge` means local `main`, not a pull request or
  another target branch.
- Do not push, open a pull request, deploy, or release without a separate
  explicit request.

## Board commits

After a mutating `kanban-md` command or short atomic batch, remain in
`<board-home>` and inspect the board diff before committing it:

```bash
git status --short --branch
git diff --check -- kanban
git add -- kanban
git diff --quiet -- kanban
git diff --cached --stat -- kanban
git commit --only -m "chore: update kanban board" -- kanban
```

The quiet diff check must confirm that the staged and working-tree `kanban/`
state match. If it fails because another board mutation arrived, inspect the
complete board diff and stage the new coherent snapshot before committing. Do
not discard the later mutation or claim it will land in a separate commit.

## Agent identity

At the start of a session, generate one name and reuse it for every claim:

```bash
kanban-md agent-name
```

Do not store the name in a shared file or environment variable.

## Default task lifecycle

### 1. Claim on canonical `main`

From `<board-home>`:

```bash
git switch main
kanban-md pick --claim <agent> --status todo --move in-progress
```

If `todo` is empty, pick from `backlog`. Read the full task with
`kanban-md show <ID>`, then commit the resulting board mutation on `main`.

### 2. Create the task worktree

Use a concise `codex/` branch, normally containing the ticket ID:

```bash
npm run worktree:create -- codex/ticket-<ID>-<slug>
```

The helper chooses `<board-home>/.worktrees/<branch-derived-name>`, copies the
ignored environments, and assigns isolated ports. Run code commands only from
the returned task worktree. Continue running board commands from `<board-home>`.

### 3. Implement and verify

Implement the smallest confirmed change and run the repository's relevant
targeted checks followed by its canonical gate. Add timestamped progress notes
from `<board-home>` when useful, renew the claim, and commit each resulting
board mutation.

### 4. Hand off for user review without committing code

Leave the verified task changes uncommitted in the task worktree. From
`<board-home>`, move the task to `review` with a handoff that gives the user the
worktree, branch, changed files, and validation evidence:

```bash
kanban-md handoff <ID> --claim <agent> \
  --note "## Handoff
- Worktree and branch:
- Files changed:
- Verified:
- Review notes:" \
  --timestamp --release
```

Commit the resulting `kanban/` snapshot on `main`. Stop and wait for the user's
review; do not commit or merge the task code merely because it is verified.

### 5. After explicit approval, perform only the requested Git action

If the user asks only to commit after review, commit the approved task files on
the worktree branch and stop. Do not merge, move the ticket to `done`, or clean
up the worktree.

If the user asks to merge after review, commit the approved task files in the
worktree if needed. In `<board-home>`, first commit any pending canonical board
snapshot, then merge the task branch directly into local `main`:

```bash
git switch main
git merge --ff-only <task-branch>
```

Prefer the fast-forward above. If `main` has advanced, inspect the divergence
and use a normal local merge when it is mechanically safe. Stop for the user if
overlapping changes or a conflict require product or ownership judgment. Never
rebase or rewrite another agent's branch merely to avoid a merge commit.

### 6. Complete and persist the board

Only after the task commit is integrated into `main`:

```bash
kanban-md edit <ID> --release
kanban-md move <ID> done
```

Append a concise completion note when the existing task body does not already
contain the implementation location and validation evidence. Commit the final
`kanban/` snapshot on `main`.

### 7. Clean up

Keep the worktree and branch after integration unless the user explicitly asks
for cleanup. When asked, confirm the task worktree is clean and its branch is
merged before removing the worktree and deleting the local branch.

## Blocked or waiting on the user

Do not merge incomplete work. From `<board-home>`, move the task to `review`
with a handoff containing the exact question, current worktree and branch,
files changed, validation run, and next step:

```bash
kanban-md handoff <ID> --claim <agent> \
  --block "Waiting on user: <what is needed>" \
  --note "## Handoff
- Current state:
- Worktree and branch:
- Open questions:
- Verified:
- Next step:" \
  --timestamp --release
```

Commit that board mutation on `main`. When the user answers, reclaim, unblock,
move back to `in-progress`, and commit the new board snapshot before resuming.

## Status meanings

| Status | Meaning |
|---|---|
| `in-progress` | An agent actively owns and is working on the task. |
| `review` | Verified task code is uncommitted while awaiting user review, or work is parked for a decision/access blocker. |
| `done` | Verified task changes are merged into local `main` and the board snapshot is committed. |

When nothing is available, inspect blocked and review tasks and ask only the
questions required to unblock them.
