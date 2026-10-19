---
id: 36
title: Add Refine clarification controller and research handoff
status: review
priority: high
created: 2026-10-19T11:29:09.403839+01:00
updated: 2026-10-19T12:16:02.010239+01:00
tags:
    - feature
    - refine
class: standard
---

Implement the confirmed Refine specification: nine callable clarification stages with shared state and web research through existing deep search; saved private sessions; adaptive batches with multiselect and supplemental text; immutable prior batches; unanswered explicit; user controls more questions or immediate research; prep failure requires Retry; Start cancels prep and launches one existing standalone research; completed session read-only linked to research; preparation searches in Automated research linked to Refine.

[[2026-10-19]] Mon 11:46
Implementation is isolated in .worktrees/codex-ticket-36-refine on codex/ticket-36-refine (API 3014, web 5187). Frontend, API controller/lifecycle, and protocol-backed browser verification are delegated separately. User confirmed Start is available during preparation and cancels it; completed session read-only linked to one manual research. Frontend build/Storybook and focused tests pass; backend lifecycle/controller integration and end-to-end validation remain in progress.

[[2026-10-19]] Mon 12:16
## Handoff
- Worktree: /Users/florian/projects/deep-search-debate/.worktrees/codex-ticket-36-refine
- Branch: codex/ticket-36-refine. Feature code remains uncommitted for user review.
- Implemented: Refine navigation and private saved sessions; nine callable prompt stages with versioned shared state, question review and tool routing; adaptive multiselect questions plus free text; saved drafts and immutable prior batches; explicit unanswered records; retry-preserved context; cancellation-safe and idempotent handoff into existing research; preparation searches in Automated research linked to Refine; completed sessions read-only with a research link.
- Files: new src/api/routes/refine, src/api/db/schema/refineSessions.ts and migration 0005, nine refine prompt files, src/web/pages/Refine, browser/SEO/lifecycle/migration tests; existing deep-search manager/history, recovery, navigation, SEO, prompt roles, DBML and scoped documentation extended.
- Verified on Node 26.5.1: npm run gatekeep passed (94 API files / 911 tests; 56 web files / 409 tests); production Vite and Storybook builds passed; four Refine browser flows passed against real UI/API/SQLite with controlled upstream model/search services; desktop and 390px full-page screenshots inspected; git diff --check passed.
- Independent root, API, DB and web gatekeep reviews completed; findings fixed and regression-tested, including stage-generation restart cleanup, active-batch ownership, Start/Ask more race, question reference validity and nullable preparation-position CHECK.
- Review notes: no dependencies added. Browser model/search responses are fixtures; live-provider quality was not evaluated. Screenshots are under src/web/test-results/refine-desktop-ready.png and refine-mobile-390.png in the worktree. No feature-code commit, merge, push or deployment performed.
