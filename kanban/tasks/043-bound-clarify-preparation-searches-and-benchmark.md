---
id: 43
title: Bound Clarify preparation searches and benchmark question latency
status: review
priority: high
created: 2026-11-01T20:49:53.257887Z
updated: 2026-11-01T21:10:53.125821Z
tags:
    - refine
    - performance
blocked: true
block_reason: 'Waiting on user: may preparation searches save a short evidence brief in search history instead of a full audited report?'
class: standard
---

Use the existing deep-search engine for a brief Clarify investigation: benchmark one round, two searches, and two selected results per search; separate investigation time from question-preparation time. Preserve ordinary final research settings. Measure before deciding whether linked-page limits, a preparation-wide cap, or stage changes are needed. Do not redesign the pipeline without evidence and confirmation of material behavior choices.

[[2026-11-01]] Sun 21:06
Implemented the initial 2-search / 2-result / 1-round preparation budget, plus the explicitly confirmed use of the current Small model/provider/reasoning assignment for all clarification and preparation stages. Final research retains ordinary model roles. Worktree: .worktrees/codex-ticket-43-clarify-investigation. Canonical gate passed 1,455 tests; all five Refine browser E2E scenarios passed after the targeted-search fixture was updated to honor the requested query count. Live benchmark used DeepSeek Flash (live catalogue ID deepseek-flash), reasoning none, real local SearXNG and Browserless, and an in-memory synthetic account. It failed after 259,248 ms: preparation search completed in 212,201 ms, then question review referenced an unknown candidate. Timing report: /var/folders/3l/qvmxtykj6sn1rrc6j18dqtcc0000gn/T/rethinkloop-43-benchmark-I8o8Lh/report.json. No production data or model settings were modified. Low breadth/round count alone is insufficient for fast clarification. Investigating the next minimal preparation-only change; user decision pending on saving a short evidence brief instead of a full audited preparation report. No pipeline-stage skips implemented yet.

[[2026-11-01]] Sun 21:10
## Handoff
- Worktree: /Users/florian/projects/deep-search-debate/.worktrees/codex-ticket-43-clarify-investigation
- Branch: codex/ticket-43-clarify-investigation; task code remains uncommitted for review.
- Implemented: new preparation limits 2 searches / 2 selected results / 1 round; all Clarify/controller/condensation and preparation-search LLM work uses the current user-selected Small provider, model, and reasoning effort. Ordinary final research retains its normal roles and limits. Review indexing is explicit; invalid output still fails without repair or retry.
- Changed areas: API model selection/generation, Refine preparation manager, review prompt, related docs and focused tests, targeted-query E2E fixture.
- Verified: final npm run gatekeep passed lint, typecheck, knip, 1,047 API tests and 409 web tests (1,456 total). All 5 Refine browser E2E scenarios passed. Dedicated root and API checklist reviews found no issues. No unrelated pre-existing failures remain.
- Live result: DeepSeek Flash, reasoning none, real local SearXNG/Browserless, synthetic in-memory account. Preparation completed in 212,201 ms; overall attempt failed after 259,248 ms on unknown question-review candidate. No usable questions. A later prompt clarification makes zero-based indexes explicit, but the full live flow was not rerun and the exact invalid output was not retained, so the root cause and live fix remain unproven.
- Timing evidence: /Users/florian/Documents/Codex/2026-11-01/clarify-benchmark/shallow-small-model-259248ms.json
- Remaining: shallow settings alone are too slow. Proposed preparation-only next step skips linked pages and final correction/analysis, promoting an evidence brief through existing durable completion. User must confirm its saved-history meaning before implementation. No such stage skips are included yet.
