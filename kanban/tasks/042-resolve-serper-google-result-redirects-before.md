---
id: 42
title: Resolve Serper Google result redirects before storing search results
status: done
priority: high
created: 2026-10-31T17:49:09.1963Z
updated: 2026-11-01T20:35:39.157277Z
started: 2026-11-01T20:35:39.139464Z
completed: 2026-11-01T20:35:39.139464Z
tags:
    - bug
    - api
class: standard
---

Resolve the complete Serper search response before normalization and persistence. Honor retryAfter within one 120-second total Serper search budget. On resolution failure or deadline exhaustion, return only results with real destination URLs from the latest valid response. Preserve caller cancellation and existing initial-search errors. No new dependencies; leave task code uncommitted for review.

[[2026-10-31]] Sat 18:02
## Handoff
- Worktree: /Users/florian/projects/deep-search-debate/.worktrees/codex-ticket-42-serper-resolve
- Branch: codex/ticket-42-serper-resolve
- Files: src/api/web_search/serper.ts and index.ts, their tests, config.ts and config.test.ts, src/api/.env.example, src/api/docs/runtime.md.
- Behavior: full response resolution and retryAfter within a shared 120-second production search budget; resolved-only fallback retains the latest valid response; original caller cancellation remains authoritative, including a deadline-first race. Local SearXNG keeps its 30-second default; explicit timeout overrides remain supported.
- Verified: npm run gatekeep passed with Node 26.5.1 (lint, typecheck, knip, 1043 API tests, 409 web tests). Focused regression tests passed 81/81. Root and API checklist reviewers reported no findings. Real Node timer checks passed retry, deadline fallback, and cancellation. Live search returned 10 direct URLs; live free resolve returned HTTP 200. Live search did not reproduce goto links, so redirected/partial cases use deterministic protocol fixtures.
- Review notes: task code remains uncommitted; no new dependencies or schema changes. Nothing pushed or deployed. Existing dependency installations are linked into the ignored worktree node_modules directories for validation.

[[2026-11-01]] Sun 20:35
User approved merge and deployment on 2026-11-01. Code committed as d5f6a29 and merged into local main as 00733ed. Canonical-main verification passed npm run gatekeep with 1043 API tests and 409 web tests. The release includes only this application change plus committed board updates.
