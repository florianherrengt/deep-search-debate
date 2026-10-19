---
id: 36
title: Add Refine clarification controller and research handoff
status: review
priority: high
created: 2026-10-19T11:29:09.403839+01:00
updated: 2026-10-19T15:05:36.961524+01:00
tags:
    - feature
    - refine
blocked: true
block_reason: 'Waiting on user: choose LLM condensation or rejecting oversize submissions before immutable save when accumulated Refine input exceeds the research prompt limit.'
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

[[2026-10-19]] Mon 13:05
Real-provider browser validation exposed a Refine retry defect: schema-valid recovery output with unsupported evidence references was cached before semantic validation, causing permanent retry failure. Reopening the existing worktree to fix that validation/checkpoint boundary, add a regression, and continue the live recorded flow. Existing real research is preserved.

[[2026-10-19]] Mon 13:55
## Live-provider verification handoff
- Worktree: /Users/florian/projects/deep-search-debate/.worktrees/codex-ticket-36-refine; branch codex/ticket-36-refine. Feature code remains uncommitted for review.
- Tested the real browser against actual DeepSeek Flash and Pro calls, SearXNG and ScrapingAnt, using an isolated ignored database copy. No upstream fixtures were used in this live session.
- Verified five questions with four choices each; two crop selections plus supplemental text; full reload persistence; three unanswered questions; Ask more submitting an immutable prior batch; Start during new preparation cancelling that preparation; one normal research job launched; Refine read-only with a working research link.
- Live session 99ca2ac5-da5a-46bf-a8cd-854da4427a44 handed off to research job 273255cb-5310-46bc-a681-314d1f238904. Stored research request retains both selected choices, both typed supplements and all three unanswered markers. Cancelled preparation has no running model generations.
- Live fixes: semantic validation now precedes successful stage checkpointing; explicit Retry evicts invalid cached stages and dependants while preserving valid work; prospective decision keys are resolved and checked by the map stage; model contracts distinguish raw excerpts from derived shared-state text and bibliographic citations, and constrain candidate decisions to their selected needs. Validation was not relaxed.
- Verified final source on Node 26.5.1: npm run gatekeep passed (917 API tests, 409 web tests), four Refine browser regressions passed with isolated controlled upstream services, git diff --check passed. Independent root/API delta reviews found no remaining actionable issues; original DB/web reviews remain applicable.
- Video: src/web/test-results/refine-real-20261019/refine-real-llm-walkthrough.mp4 (275.07 seconds, H.264 1440x1050, full decode checked). Safe provider/job audit: same directory, live-audit.json. Both are ignored local evidence files.
- Recording boundary: resumes the saved live session; initial prompt entry preceded the valid window capture. Idle waits are shortened; failures/retries are retained. The second preparation was deliberately cancelled to verify Start. The recording ends with the normal research job in Round 1; final report completion and a clean first-attempt live run are not claimed.
- Live-model evidence formatting and reference failures required manual retries. An existing deep-search linked-page enum violation also recovered through Retry. The controlled-provider fixture was corrected to classify all four needs after stricter validation. No dependency added, feature-code commit, merge, push or deployment performed.

[[2026-10-19]] Mon 15:04
Reopened after user requested fixes for the review findings: oversized accumulated Refine input can block research handoff; empty provenance arrays admit unsupported factual claims. Investigating bounded-prompt policy before code changes and preparing regression coverage.

[[2026-10-19]] Mon 15:05
Review-fix investigation complete; no source or test files changed in this fix turn. Provenance remedy is scoped to confirmed requirements, known facts, and domain findings; assumptions remain optional-source records. Existing bounded-text utilities remove passages, so using them would choose a material data-loss policy. Product clarification is pending: LLM condensation (recommended, with originals retained) versus rejecting oversize submissions before immutable save. Existing feature worktree and recorded real-LLM evidence are preserved.
