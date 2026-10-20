---
id: 40
title: Add bounded Browserless agent control and CapSolver recovery
status: in-progress
priority: high
created: 2026-10-20T17:49:40.962987+01:00
updated: 2026-10-20T18:09:50.912954+01:00
tags:
    - feature
    - api
    - research
claimed_by: linoxin-trithing
claimed_at: 2026-10-20T18:09:50.913091+01:00
class: standard
---

Implement approved fallback-only browser control using existing Small model and DOM observations. Anonymous public research actions; maximum 12 actions and 120 seconds per page. CapSolver proxy-free Turnstile and reCAPTCHA v2, one paid task per page and ten per effective root workflow including child searches and Resume. Persist minimal solver reservation/task state; unknown paid outcomes are not automatically repurchased. Interrupted pages reopen in fresh sessions, completed extraction is reused, terminal unsupported/exhausted CAPTCHA falls back to snippets. Keep private self-hosted Browserless, existing source attribution, page budgets, Stop, queues, and network protections. No new dependencies, no deployment. Task code remains uncommitted in an isolated worktree for review.

[[2026-10-20]] Tue 18:09
Implemented remote Browserless sessions, Small-model DOM actions, CapSolver client and durable per-page paid-task reservations. Real pinned Browserless smoke passed; default model loop verified through local DeepSeek-compatible SSE provider with two persisted completed generations; actual CapSolver client verified through local HTTP protocol stub and real browser callback. CapSolver credential authenticated without buying tasks. Final review identified link-handoff persistence and standard nested reCAPTCHA markup gaps; corrective work and migration-fixture updates are in progress before final gate.
