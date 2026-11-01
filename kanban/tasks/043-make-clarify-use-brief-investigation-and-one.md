---
id: 43
title: Make Clarify use brief investigation and one question-generation call
status: review
priority: high
created: 2026-11-01T20:49:53.257887Z
updated: 2026-11-01T22:08:45.850886Z
tags:
    - refine
    - performance
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

[[2026-11-01]] Sun 21:45
## Brief-path handoff
- Worktree: /Users/florian/projects/deep-search-debate/.worktrees/codex-ticket-43-clarify-investigation; branch codex/ticket-43-clarify-investigation. Task code is uncommitted.
- Completed: saved source-backed preparation briefs, no linked-page expansion, no full report correction or structured analysis, existing final-output and replay mechanism reused. All clarification uses the selected Small provider/model/effort; final research keeps its normal roles and pipeline. No backward-compatibility branch, new schema, migration, public mode or dependency.
- Verified: npm run gatekeep passed lint/typecheck/knip and 1,459 tests (1,050 API + 409 web); all 5 Refine browser E2E scenarios passed; 93 focused pipeline/store/replay tests passed; root and API checklist reviews found no issues.
- Live evidence: current preparation saved its brief in 53,992 ms, compared with 212,201 ms for the earlier shallow full-report preparation. The full current attempt failed after 80,662 ms when Flash returned an evidence ID outside the allowed catalog. Validation remains strict. An independent replay using that same saved brief completed the controller in 45,019 ms with a ready but empty question batch. Captured inputs show all needs routed to research, leaving no allowed clarification needs; the later action still said ASK_USER. This is permitted model under-generation/cross-stage disagreement, not a wiring defect. No speculative controller fixes were made.
- Reports: /Users/florian/Documents/Codex/2026-11-01/clarify-benchmark/evidence-brief-small-model-80662ms.json and controller-from-saved-brief-45019ms.json.
- Remaining: interactive latency and reliable useful questions are not yet achieved. Proposed next architecture is one Small-model call taking the saved brief and prior answers to return the next questions, preserving strict validation, immutable saved answer batches and final research handoff. Awaiting explicit user choice before that change.

[[2026-11-01]] Sun 21:54
User approved one Small-model call for question preparation and explicitly chose reusing the session evidence brief for Ask more. Implement a direct validated question response, removing the staged routing/taxonomy and automatic extra-search loop. Keep exact allowed evidence-reference validation, immutable answer batches, one registered-generation checkpoint/retry/cancellation, and ordinary final research handoff. No backward compatibility or new database migration is required.

[[2026-11-01]] Sun 22:08
## Final implementation handoff
- Worktree: /Users/florian/projects/deep-search-debate/.worktrees/codex-ticket-43-clarify-investigation
- Branch: codex/ticket-43-clarify-investigation. Task code remains uncommitted for user review; no merge, push, PR or deployment performed.
- Final behavior: one initial preparation search per session (2 searches x 2 selected results x 1 round), selected pages only, concise saved evidence brief, no linked-page expansion/correction/analysis. Every question batch uses one selected Small-model call; Ask more reuses the same brief plus immutable prior answers. Final research retains its ordinary roles, limits and handoff.
- Simplification: removed the staged need/decision/assumption taxonomy, its derived state writes and TOOL_WORK loop, and eight retired prompts. Existing DB table/column left untouched, no migration/dependency/compatibility layer. Evidence IDs, strict schemas, duplicate checks, canonical generation checkpoint, ownership, retry, cancellation, draft/history and immutable submissions remain verified.
- Validation: final npm run gatekeep passed lint, typecheck, knip, 1,030 API tests and 409 web tests (1,439 total). Stage-specific tests were replaced by direct-controller contract tests for the approved architecture. Focused controller/manager/model suites passed 31/31. All 5 Refine browser E2E scenarios passed, covering shared-brief reuse/reload, drafts and history, invalid evidence failure/retry, Start during preparation, and condensation/final handoff. Independent root, API and web checklist reviews reported no findings. git diff --check clean.
- Live verification with DeepSeek Flash, reasoning none, real local SearXNG/Browserless and disposable in-memory account: fresh session returned 7 questions in 78,486 ms; preparation itself was 69,488 ms, and question generation 8,166 ms. Follow-up returned 5 questions in 8,113 ms (generation 8,075 ms). Exactly one completed prep search and two question generations across both batches; no analysis generation. The initial one-time investigation remains the main latency cost. Earlier model-reference/under-generation failures belonged to the removed staged controller; the final live flow completed both batches successfully without relaxing validation.
- Reports: /Users/florian/Documents/Codex/2026-11-01/clarify-benchmark/final-first-78486ms-followup-8113ms.json and single-call-8665ms-followup-10175ms.json.
- Ready for review. No remaining implementation blocker; first-session investigation timing is a measured limitation, not a promise of instant startup.
