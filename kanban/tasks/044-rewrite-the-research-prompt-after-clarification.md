---
id: 44
title: Rewrite the research prompt after clarification
status: done
priority: medium
created: 2026-11-04T11:38:23.179666Z
updated: 2026-11-04T12:07:39.783874Z
started: 2026-11-04T12:07:39.785991Z
completed: 2026-11-04T12:07:39.785991Z
tags:
    - refine
class: standard
---

Always rewrite the original request plus all submitted clarification answers at final research handoff. Preserve unanswered questions as unresolved. Start research automatically after a successful rewrite; preserve answers and allow explicit retry after failure. Reuse existing condensation/checkpoint mechanisms.

[[2026-11-04]] Wed 11:54
Implemented and ready for review. Worktree: /Users/florian/projects/deep-search-debate/.worktrees/codex-ticket-44-refine-prompt-rewrite; branch codex/ticket-44-refine-prompt-rewrite. Seven changed files cover the Refine manager, rewrite prompt, scoped documentation, manager tests, provider fixtures and browser tests. Every final handoff rewrites original plus all submitted answers; unanswered remain unresolved; successful rewrite starts research automatically; failed rewrite preserves answers for explicit retry. Reuses existing Small model, validation and chunk checkpoints; reconstructs canonical source after restart. Verified: npm run gatekeep passed (lint, typecheck, knip, 1033 API tests and 409 web tests); six Refine headless E2E scenarios passed across full and focused runs; screenshots inspected; root/API/web checklist reviews completed. One unchanged browser-agent test timed out during concurrent testing and passed in the sequential full gate. User requires headless browser tests to avoid focus stealing. Code remains uncommitted; no merge, push or deployment.
