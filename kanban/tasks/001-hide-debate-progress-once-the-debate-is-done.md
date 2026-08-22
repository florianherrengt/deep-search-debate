---
id: 1
title: Hide Debate progress once the debate is done
status: done
priority: medium
created: 2026-08-22T16:41:53.179935+01:00
updated: 2026-08-22T23:12:11.490268+01:00
started: 2026-08-22T16:55:19.959193+01:00
completed: 2026-08-22T23:12:11.490687+01:00
class: standard
---

## Request (original ticket, preserved)

Context: the "Debate progress" section (heading + LinearProgress bar + "X/Y matches" counter) is rendered in src/web/pages/Debates/components/TournamentBoard.tsx:71-113.

Current behaviour: it is always shown, even when the tournament has stopped progressing.

Desired behaviour: hide the whole "Debate progress" section (heading, progress bar, counter) once the debate is no longer running, i.e. for any non-running status: completed, failed, interrupted (see statuses in src/web/pages/Debates/debatePresentation.ts). Keep showing it while status is "running".

Note: tournamentActive (TournamentBoard.tsx:49-50) already computes the running condition; reuse the same idea (status === "running" && !stopRequested). Update tests in src/web/pages/Debates/components/TournamentBoard.test.tsx if they assert the section in terminal states.

## What the ticket asks for and why

- Ask: on the debate detail page, the "Debate progress" section (h2 heading, stage chip, determinate progress bar, "X/Y matches" counter — or the "Waiting for idea selection…" fallback line) must not render in terminal states; it should remain only while the debate is running.
- Why (repository evidence, not stated in the ticket): in terminal states the page already communicates the outcome — overall status chip ("Debate complete" / "Debate failed" / "Stopped" / "Interrupted" via `getDebateStatusPresentation`, DebateView.tsx:48-51), `DebateStoppedAlert` for failed/interrupted (DebateView.tsx:111-116 → DebateStoppedAlert.tsx), `WinnerIdeaCard` for completed (DebateView.tsx:139-147). The leftover progress bar/counter would imply work continues, which the repo policy forbids: "Terminal workflows MUST NOT leave … active status copy, or loading indicators that imply work continues" (`src/web/docs/standards.md`, §7) and web gatekeep check "A failed or completed job cannot leave pending children, loading indicators, or status copy looking active" (`src/web/gatekeep.md`).
- Provenance: `TournamentBoard` was introduced by commit 10a3e1f ("Add streamed debate tournament workflow") and last touched by 2d0aaf7.

## Implementation map (verified against the current tree)

- Component: `src/web/pages/Debates/components/TournamentBoard.tsx`
  - Board root `<Stack spacing={3}>` (line 69) with three blocks: the progress section (lines 70-113), a conditional knockout block (leading `<Divider/>` at lines 115-117, shown when stage is semifinal|final, `showKnockout` line 64-65) and an unconditional `<Divider/>` (line 141) + standings/rounds grid.
  - Progress section internals: `Stack component="section" aria-labelledby={headingId-progress}` → a11y `role="region"` named "Debate progress" (this is how tests query it). H2 heading lines 81-89; stage `Chip` from `debateStageLabels` lines 90-94; progress row lines 96-107 when `expectedMatchCount` is non-null (`LinearProgress` determinate, value = `completedMatches / expectedMatchCount * 100`, plus "X/Y matches" caption); fallback copy "Waiting for idea selection before creating the tournament." lines 108-111.
  - `tournamentActive` local: lines 49-50 — `tournament.status === "running" && !tournament.stopRequested`.
  - Other uses of `tournamentActive` in the same file (their behaviour is NOT part of this ticket): round auto-expansion `currentRoundId` (lines 51-54), `KnockoutBracket active` (line 131), `MatchCard active` per Swiss match (line 268).
  - `completedMatches` = `getCompletedMatchCount(tournament)` (line 38; `debateSelectors.ts:37-40` counts matches with `status === "completed"`).
- Props: `{ tournament: DebateTournament }` only (lines 32-34). `DebateTournament` = `DebateTournamentSnapshot` (`debateUiTypes.ts:4`) = Zod output of `debateTournamentSchema` in `src/web/lib/debateJobs.ts:44-62`: `status: "running"|"completed"|"failed"|"interrupted"` (line 55), `stopRequested: boolean` (line 52), `expectedMatchCount: number|null` (line 56), `stage: "ideas"|"swiss"|"semifinal"|"final"` (line 54).
- Render path: `pages/Debates/index.tsx` `DebateDetail` (line 276) → `DebateView` (`components/DebateView.tsx`, renders `<TournamentBoard tournament={tournament} />` at line 149). `TournamentBoard` has exactly one call site in the app.
- Data source: `pages/Debates/useDebateJob.ts` — TanStack Query snapshot from `getDebateJob` (`/api/debate-jobs/:slug`) plus NDJSON `updated`/`error`/`done` events that only trigger invalidation/refetch. The validated snapshot is the single source of truth; there is no client-side progress state. `status`, `stopRequested`, `expectedMatchCount` all arrive in that snapshot.
- Status presentation mapping: `pages/Debates/debatePresentation.ts` — `getDebateStatusPresentation(status, stopRequested)` (lines 16-27: running+stopRequested → "Stopping…"; interrupted+stopRequested → "Stopped"; else per-status labels) and `debateStageLabels` (lines 29-34).
- Companion terminal-state UI (already exists, unchanged by this ticket): status chip in the header (DebateView.tsx:77-83), `DebateStoppedAlert` (shows when `tournament.error` is non-null), `WinnerIdeaCard` (when the final match has a winner; `getWinner` from `debateSelectors.ts:68-76`).
- Same-`tournamentActive`-idea consumers to be aware of (they already flip in terminal states): `MatchCard` (`MatchCard.tsx:56-99` — non-completed match + inactive → "Stopped" chip; running + active → filled "Live" chip) and `KnockoutBracket` (`KnockoutBracket.tsx:61,81` — empty-slot label "Debate stopped" vs "Waiting…").
- Not affected (verified): the match detail route renders `DebateMatchDetail`, which does not include the progress section; the debates list page (`DebateStart`, index.tsx) uses only a status chip per job (`JobHistory`) — no progress bar there.
- Sibling pattern for reference only (Ideas feature, not in scope): `src/web/pages/Ideas/components/ProgressCard.tsx`.

## Fixtures, stories, tests

- Fixtures: `pages/Debates/stories/fixtures.ts` — `swissTournament` (running, stopRequested false, stage swiss, expectedMatchCount 33, 33 total matches across rounds), `semifinalTournament` (running, false, stage semifinal), `completedTournament` (completed, stage final, canStop false, error null, creditsUsed set). There are no exported failed/interrupted fixtures; existing tests/stories derive them via spread override (patterns: `TournamentBoard.test.tsx:101` `{...swissTournament, status: "failed"}`; `DebateView.stories.tsx:94-135` Failed / Stopping / Stopped / Interrupted).
- Unit tests:
  - `TournamentBoard.test.tsx:21-32` renders `completedTournament` and asserts `getByRole("region", {name: "Debate progress"})` is visible — WILL BREAK; flip to absent (query* returns null) per the ticket.
  - The other tests in that file use the running fixtures, and the terminal test at lines 100-105 only asserts match chips ("Live" absent / "Stopped" present) — not affected by the section being hidden.
  - `Debates.test.tsx` (route-level) and `DebateView.stories.test.tsx` contain no progress-section assertions (verified by reading) — they should keep passing, but run the suite.
- Storybook (no file changes expected; rendered states change): `TournamentBoard.stories.tsx` (SwissRound, Semifinals, TournamentComplete, plus a Standings-only render) and `DebateView.stories.tsx` (RunningSwiss / RunningSemifinal keep the section; Completed / Failed / Stopped / Interrupted lose it; the Stopping story = running + stopRequested true is where the open predicate question is visible).
- E2E (Playwright, `src/web/e2e/`): `debates.spec.ts` asserts the counter in the DOM in three places:
  - line 125 — while running: `getByText(/\d+\/23 matches/)` visible — unaffected.
  - line 297 — after completion: `getByText("23/23 matches", {exact: true})` visible — WILL BREAK; needs updating.
  - line 627 — after user-stop and reload (status interrupted): `getByText(/\d+\/23 matches/)` visible — WILL BREAK; needs updating.
  - The failure test (lines 630-727) never asserts the counter. `borderAudit.spec.ts` visits the debate detail page but only asserts the title heading and match links — no existence impact; re-run for a visual check.
  - E2E boots the real API + Vite with external services mocked (`playwright.config.ts`: API :3100, web :5174, temp SQLite db, `NODE_OPTIONS` preload of `src/api/e2e/mockExternalServices.mjs`).

## Conventions the implementer must follow

- `src/web/docs/standards.md` (read before frontend changes) and `src/web/gatekeep.md`:
  - Derive visibility from the validated snapshot (`tournament.status`, `tournament.stopRequested`); do not add client state for it (§4 "Derived values MUST be computed from their source state"; gatekeep: "progress counts, stage labels, and status are derived from the snapshot").
  - Tests: query by accessible role/label, never MUI class names (§9); the "Debate progress" region name derives from `section` + `aria-labelledby`.
  - Terminal workflow rule is the policy basis for this ticket (§7, gatekeep line 17).
  - Keep the change inside `src/web/pages/Debates/` (feature-first layout, §3); no new dependencies, no theme changes (MUI `Stack`/`sx` only, §5).
- Verification commands: `npm run test -w @rethinkloop/web` (vitest run, jsdom + RTL), `npm run test:e2e -w @rethinkloop/web` (Playwright, boots API + Vite itself), `npm run gatekeep` at the repo root (lint → typecheck → knip → test; the canonical pre-PR gate), `npm run storybook -w @rethinkloop/web` for visual inspection.
- Working-tree warning: the current branch carries unrelated uncommitted changes (idea-site feature: `src/api/routes/ideas/*`, Ideas `ProgressCard`, README/coolify, `kanban/`, `dagger/`, etc. — see `git status`). The files relevant to this ticket are clean (verified: no diff in `src/web/pages/Debates/**`, `src/web/lib/debateJobs.ts`, `src/web/e2e/debates.spec.ts`). Do not stage or commit the unrelated files.

## Edge cases to handle / verify

1. `expectedMatchCount: null` — the section then shows the "Waiting for idea selection…" copy instead of bar + counter (TournamentBoard.tsx:96-112). A debate that dies before the tournament exists (stage ideas, terminal status) must not keep showing that copy; hiding the whole section covers it, but verify.
2. Leading `<Divider/>`: when the first section is omitted, the board stack's first rendered child is a `<Divider>` (lines 115-117 before knockout, or line 141 before standings) in every terminal state — a stray line at the top of the board. See open question 2 for the decision needed.
3. A11y/heading order: hiding the section removes its h2; the remaining page is h1 (debate title) → h2 (Knockout / Standings / Debate rounds). Verify no orphaned `aria-labelledby` targets (the `useId` heading ids are each scoped to their own section).
4. Live transition running → terminal: the NDJSON `done`/`updated` event triggers a refetch (`useDebateJob.ts`), the snapshot flips status, and the section disappears on re-render; the subscription itself is not kept open for terminal snapshots (useDebateJob.ts:26). Expected behaviour; no extra machinery needed.
5. Narrow screens: hiding a block just removes content; sanity-check the remaining standings/rounds grid at 375px (Storybook or the 375px viewport section of debates.spec.ts).

## Acceptance criteria

1. The entire "Debate progress" section (heading, stage chip, bar, counter, and the "Waiting for idea selection…" fallback) is hidden for statuses completed, failed, interrupted.
2. It remains visible while running, including the live "X/Y matches" counter and determinate bar tracking `getCompletedMatchCount` / `expectedMatchCount`.
3. `TournamentBoard.test.tsx`: the completed-state test asserts the section is absent instead of present; terminal-state coverage exists for failed and interrupted at the same level.
4. The two `debates.spec.ts` counter assertions (line 297 completed, line 627 interrupted) are updated to match the new behaviour (confirm scope — open question 3).
5. `npm run gatekeep` passes (at minimum: `npm run test -w @rethinkloop/web` and `npm run test:e2e -w @rethinkloop/web`); Storybook states visually confirmed.
6. No API changes, no new dependencies, and no behaviour change for the other `tournamentActive` consumers (match cards, knockout bracket, round auto-expansion).

## Open questions (not resolvable from repository evidence)

1. **The "Stopping…" window.** The ticket states two conditions that only differ when `status === "running" && stopRequested === true` (header chip "Stopping…", debatePresentation.ts:20-21): the desired-behaviour sentence ("hide for any non-running status… keep showing while status is 'running'") keeps the section visible during Stopping…, while the note ("reuse tournamentActive = running && !stopRequested") hides it then. In-file precedent: the preparingIdeas card in DebateView.tsx:52-55 treats running + stopRequested as NOT active. No test covers the counter during Stopping…. Ask the ticket author which window behaviour is intended.
2. **Stray leading `<Divider/>`** (edge case 2): when the first section is hidden, a top border line remains. Should the implementation also drop/relocate that divider? The ticket scope ("hide the section") does not mention it.
3. **E2E scope.** The ticket only names `TournamentBoard.test.tsx`, but `debates.spec.ts:297` and `:627` will fail once the counter is hidden. Updating them is assumed to be in scope; confirm.

[[2026-08-22]] Sat 23:12
Done in .worktrees/task-10-waitlist-label (branch task/1-hide-debate-progress, merged 3aa77f6): section gated on tournamentActive per user decision (hidden during Stopping…), leading dividers made conditional, unit tests updated + new multi-state test, debates.spec.ts counter assertions flipped to region-absent and pre-existing Prompt-accordion e2e failure fixed by expanding the accordion first (user-approved). Verified: web units 269/269, debates e2e 3/3, lint+typecheck clean, Storyboard TournamentComplete/SwissRound confirmed visually.
