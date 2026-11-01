---
id: 43
title: Bound Clarify preparation searches and benchmark question latency
status: in-progress
priority: high
created: 2026-11-01T20:49:53.257887Z
updated: 2026-11-01T21:43:44.59818Z
tags:
    - refine
    - performance
claimed_by: harsh-belick
claimed_at: 2026-11-01T21:43:44.598404Z
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

[[2026-11-01]] Sun 21:13
User confirmed: save a short evidence brief for completed preparation searches. Proceed with preparation-only skipping of linked-page expansion and final report correction/analysis, reusing existing durable output/completion and retaining current Small model selection. Ordinary final research remains unchanged.

[[2026-11-01]] Sun 21:43
User approved saving a short evidence brief and explicitly waived backward compatibility for older in-progress preparation checkpoints. Implemented preparation-purpose detection from the durable link, no linked-page expansion, concise brief request framing, and direct atomic candidate-to-final promotion without correction or research analysis; no new tables, columns, public modes, or dependencies. Ordinary final research is unchanged. Focused pipeline/store/replay tests: 93 passed. Current npm run gatekeep passed 1,050 API tests and 409 web tests (1,459 total), plus lint/typecheck/knip. All 5 Refine browser E2E tests passed. Root/API checklist reviews found no issues. Live brief run: preparation saved in 53,992 ms versus 212,201 ms in the earlier shallow run, with 4 selected pages and no analysis generation. The controller then failed after 80,662 ms on an unsupported model evidence ID. Reusing the saved brief in an independent diagnostic completed the controller in 45,019 ms with an empty ready batch: upstream model stages routed all needs to research despite four user scoping decisions, so question generation correctly had no allowed clarification needs. No controller wiring defect found; invalid references still fail closed. Reports: /Users/florian/Documents/Codex/2026-11-01/clarify-benchmark/evidence-brief-small-model-80662ms.json and controller-from-saved-brief-45019ms.json. User decision pending on replacing the staged question controller with one Small-model call to reduce latency and cross-stage disagreement; no single-call controller changes made yet.
