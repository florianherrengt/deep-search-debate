---
id: 34
title: Let users select and replace generated ideas before starting a debate
status: review
priority: high
created: 2026-10-09T18:01:24.351613+01:00
updated: 2026-10-09T18:53:54.039989+01:00
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
