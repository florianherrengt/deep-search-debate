---
id: 40
title: Add bounded Browserless agent control and CapSolver recovery
status: in-progress
priority: high
created: 2026-10-20T17:49:40.962987+01:00
updated: 2026-10-20T20:56:01.890581+01:00
tags:
    - feature
    - api
    - research
claimed_by: linoxin-trithing
claimed_at: 2026-10-20T20:56:01.890738+01:00
class: standard
---

Implement approved fallback-only browser control using existing Small model and DOM observations. Anonymous public research actions; maximum 12 actions and 120 seconds per page. CapSolver proxy-free Turnstile and reCAPTCHA v2, one paid task per page and ten per effective root workflow including child searches and Resume. Persist minimal solver reservation/task state; unknown paid outcomes are not automatically repurchased. Interrupted pages reopen in fresh sessions, completed extraction is reused, terminal unsupported/exhausted CAPTCHA falls back to snippets. Keep private self-hosted Browserless, existing source attribution, page budgets, Stop, queues, and network protections. No new dependencies, no deployment. Task code remains uncommitted in an isolated worktree for review.

[[2026-10-20]] Tue 18:09
Implemented remote Browserless sessions, Small-model DOM actions, CapSolver client and durable per-page paid-task reservations. Real pinned Browserless smoke passed; default model loop verified through local DeepSeek-compatible SSE provider with two persisted completed generations; actual CapSolver client verified through local HTTP protocol stub and real browser callback. CapSolver credential authenticated without buying tasks. Final review identified link-handoff persistence and standard nested reCAPTCHA markup gaps; corrective work and migration-fixture updates are in progress before final gate.

[[2026-10-20]] Tue 18:25
## Handoff
- Worktree: /Users/florian/projects/deep-search-debate/.worktrees/codex-ticket-40-browser-control-capsolver
- Branch: codex/ticket-40-browser-control-capsolver. All task code is uncommitted for review; no push or deployment.
- Files changed: browserAgent and prompt/model routing; pageFetch/CDP and bounded snapshots; CapSolver client; extraction, summaries, pipeline and failed-source link persistence; minimal page-row CAPTCHA reservation/task columns, additive migration 0006, snapshot/journal/DBML; typed configuration, environment example, operational docs and Browserless Compose timeout; focused regression tests.
- Behavior: HTTP then stateless Browserless rendering, then bounded Small-model DOM recovery only when rendering is unusable or fails. Maximum 12 actions and 120 seconds per session. Anonymous public research controls only. Cross-document links use existing selection and budgets; unreadable sources remain failed/snippet evidence.
- CAPTCHA: proxy-free Turnstile and standard reCAPTCHA v2. One reserved paid attempt per page, at most ten across the effective root and child workflows, retained through Stop/Resume. Reserve before createTask; an uncertain creation is never automatically purchased again. Known task IDs may be polled within validity. Full Cloudflare challenge pages remain unsupported.
- Verified: final npm run gatekeep under Node 26.5.1 passed lint, typecheck, Knip, 1028 API tests and 409 web tests. Five isolated-port Playwright workflows passed: two-hop research/correction, root Stop/reconstruction, mixed-result replay, complete researched ideas, and Refine linked deep-search. Migration upgrade/fresh integrity, foreign keys and trigger preservation covered.
- Real behavior proof: pinned self-hosted Browserless CDP, model-selected click/fresh observation/extraction; default model transport through local DeepSeek-compatible SSE with persisted generations; CapSolver HTTP protocol stub through actual client, durable reservation/task ID and correct browser response field/callback; no second purchase after uncertain creation; real Browserless UTF-8 DOM limit before CDP transfer. Actual CapSolver key authenticated with available balance. No paid tasks created and no live third-party CAPTCHA solve claimed.
- Reviews: dedicated root, API and schema checklist reviews clear after fixes. Secret scan and git diff --check passed; dependencies unchanged. Disposable Browserless smoke container stopped.
- Release notes: apply the separate Browserless Compose TIMEOUT=130000 and API runtime CAPSOLVER_API_KEY while retaining required host nftables egress policy. Puppeteer cannot cancel the initial WebSocket handshake; a stalled handshake can retain the browser queue permit until it settles. Documented in API runtime guidance. Deployment is outside this task.

[[2026-10-20]] Tue 20:56
User approved the reviewed single-column CAPTCHA representation: NULL means unattempted, empty string means reserved with unknown task ID, nonempty means known provider task. Remove the reservation timestamp and local expiry calculation; retain transactional root budgets, at-most-once purchase, Stop/Resume, and provider-owned expiry. Implement in existing task worktree, then run gatekeep and relevant end-to-end tests.
