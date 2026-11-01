---
id: 43
title: Bound Clarify preparation searches and benchmark question latency
status: in-progress
priority: high
created: 2026-11-01T20:49:53.257887Z
updated: 2026-11-01T21:06:17.23861Z
tags:
    - refine
    - performance
claimed_by: harsh-belick
claimed_at: 2026-11-01T21:06:17.24019Z
class: standard
---

Use the existing deep-search engine for a brief Clarify investigation: benchmark one round, two searches, and two selected results per search; separate investigation time from question-preparation time. Preserve ordinary final research settings. Measure before deciding whether linked-page limits, a preparation-wide cap, or stage changes are needed. Do not redesign the pipeline without evidence and confirmation of material behavior choices.

[[2026-11-01]] Sun 21:06
Implemented the initial 2-search / 2-result / 1-round preparation budget, plus the explicitly confirmed use of the current Small model/provider/reasoning assignment for all clarification and preparation stages. Final research retains ordinary model roles. Worktree: .worktrees/codex-ticket-43-clarify-investigation. Canonical gate passed 1,455 tests; all five Refine browser E2E scenarios passed after the targeted-search fixture was updated to honor the requested query count. Live benchmark used DeepSeek Flash (live catalogue ID deepseek-flash), reasoning none, real local SearXNG and Browserless, and an in-memory synthetic account. It failed after 259,248 ms: preparation search completed in 212,201 ms, then question review referenced an unknown candidate. Timing report: /var/folders/3l/qvmxtykj6sn1rrc6j18dqtcc0000gn/T/rethinkloop-43-benchmark-I8o8Lh/report.json. No production data or model settings were modified. Low breadth/round count alone is insufficient for fast clarification. Investigating the next minimal preparation-only change; user decision pending on saving a short evidence brief instead of a full audited preparation report. No pipeline-stage skips implemented yet.
