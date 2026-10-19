---
id: 36
title: Add Refine clarification controller and research handoff
status: in-progress
priority: high
created: 2026-10-19T11:29:09.403839+01:00
updated: 2026-10-19T11:46:38.293638+01:00
tags:
    - feature
    - refine
claimed_by: sabotine-hushaby
claimed_at: 2026-10-19T11:46:38.294392+01:00
class: standard
---

Implement the confirmed Refine specification: nine callable clarification stages with shared state and web research through existing deep search; saved private sessions; adaptive batches with multiselect and supplemental text; immutable prior batches; unanswered explicit; user controls more questions or immediate research; prep failure requires Retry; Start cancels prep and launches one existing standalone research; completed session read-only linked to research; preparation searches in Automated research linked to Refine.

[[2026-10-19]] Mon 11:46
Implementation is isolated in .worktrees/codex-ticket-36-refine on codex/ticket-36-refine (API 3014, web 5187). Frontend, API controller/lifecycle, and protocol-backed browser verification are delegated separately. User confirmed Start is available during preparation and cancels it; completed session read-only linked to one manual research. Frontend build/Storybook and focused tests pass; backend lifecycle/controller integration and end-to-end validation remain in progress.
