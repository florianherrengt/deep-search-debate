---
id: 34
title: Let users select and replace generated ideas before starting a debate
status: review
priority: high
created: 2026-10-09T18:01:24.351613+01:00
updated: 2026-10-09T19:17:21.56767+01:00
tags:
    - feature
    - ideas
    - debates
class: standard
---

Confirmed flow: shared Ideas and debate setup; request 2, 4, 6, or 8 candidates; initially generate exactly that count and run AI screening before presenting all candidates in Selected and Rejected groups. Owner toggles persist and move cards between groups. Generate more retains selected candidates, marks unselected candidates discarded, and fills only the gap using the original request, research, kept ideas, and discarded history. Replacements start selected and are not AI-screened. Freeze controls while generating; no regeneration limit. Start debate requires 2, 4, 6, or 8 selected and freezes participants. Two ideas play one match; four play every pair then a top-two final; six and eight retain existing Swiss and playoffs. Whole-job failure and Resume reuse completed checkpoints. Existing data compatibility is unnecessary; direct API automatic flow is outside requested scope. Keep task code uncommitted for review.

[[2026-10-09]] Fri 18:53
## Handoff
- Worktree and branch: /Users/florian/projects/deep-search-debate/.worktrees/codex-ticket-34-idea-selection on codex/ticket-34-idea-selection. Task source remains uncommitted for user review.
- Files changed: existing API idea lifecycle, persistence, replay, routes, prompts, tournament orchestration and contracts; SQLite migration 0005 and schema documentation; shared browser setup form, selection list, job/detail state, small-tournament display, tests and stories.
- Verified: final npm run gatekeep passed (lint, typecheck, knip, 900 API tests, 403 web tests); full Playwright suite 18/18 passed with mocked external services; production web and Storybook builds passed; fresh migration and existing-data migration tests passed; desktop/mobile, saved selections, keyboard focus and gap refill inspected in the real local browser.
- Review notes: shared flow requests 2/4/6/8 candidates; initial AI defaults remain user-editable, including empty or odd defaults; manual refills are unlimited, replace only the gap, retain discarded history and do not rescreen. Debate freezes 2/4/6/8 selected participants. Two uses one final; four uses three no-repeat Swiss rounds plus final; six/eight retain existing formats. Automatic prompt API flow preserved. Migration keeps existing data; no database reset. Root/API/DB/web checklist reviews passed, including final keyboard-focus change. No code commit, merge, push, deployment or pull request performed.
- Preview: /private/tmp/rethinkloop-ticket-34-selection.png. Temporary mock preview services are stopped after verification.

[[2026-10-09]] Fri 19:08
Simplification pass requested: reuse the existing candidate projection, consolidate pending-control checks, remove redundant selection lookup, and preserve ordered batch replay with simpler deduplication. Keep behavior, schema, API contracts and tournament rules unchanged. The ready selected-candidate detail finding remains a separate fix.

[[2026-10-09]] Fri 19:17
## Simplification handoff
- Worktree and branch: /Users/florian/projects/deep-search-debate/.worktrees/codex-ticket-34-idea-selection on codex/ticket-34-idea-selection. Source remains uncommitted.
- Changes: reused existing candidate projection in IdeaList; removed redundant ideas prop; consolidated pending-control checks; removed duplicate candidate SELECT; replaced replay map/min/sort with first-seen Set over position-ordered rows; removed the private expectedMatchCount pass-through wrapper.
- Verification: npm run gatekeep passed (lint, typecheck, knip, 901 API tests, 404 web tests). Four affected Ideas browser tests passed with local mocked external services. Web and Storybook builds passed. After tightening test fixtures, the two API test files passed 47 tests, Ideas passed 49 tests, and final single-fixture boolean correction passed its named test and lint. Diff check clean.
- Review: dedicated root, API, DB and web checklist reviews found no new defect in this simplification. Behavior, API contracts, schema, tournament formats, and checkpoint semantics are preserved. Legacy saved-run compatibility remains explicitly outside the confirmed requirements.
- Remaining known finding: a selected candidate detail opened before Start debate still shows downstream failure copy. That P2 issue was reported in the prior review and was not included in this behavior-preserving simplification.
- No source commit, merge, push, deployment or pull request performed.
