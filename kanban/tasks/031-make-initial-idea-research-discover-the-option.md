---
id: 31
title: Make initial idea research discover the option space
status: in-progress
priority: medium
created: 2026-09-12T21:26:43.816524+01:00
updated: 2026-09-13T01:01:43.879253+01:00
claimed_by: vaginula-sonar
claimed_at: 2026-09-13T01:01:43.879367+01:00
class: standard
---

Limit this change to the initial space-discovery phase shared by Ideas and Debates. Discover diverse concrete ideas, products and approaches, covering missing parts of the space without recommending a winner or doing detailed candidate research. Preserve the discovered options in the briefing. Leave idea generation, selection, refinement, selected-idea research and standalone deep-search behaviour unchanged. Reuse the existing research-request flow; validate prompt behaviour with a real-model pilot and run the existing regression gates. Leave task code uncommitted for review.

[[2026-09-12]] Sat 21:54
## Handoff
- Worktree: /Users/florian/projects/deep-search-debate/.worktrees/codex-ticket-31-space-discovery
- Branch: codex/ticket-31-space-discovery. Allocated API port 3008 and web port 5181. Task code remains uncommitted.
- Files: src/api/llms/prompts/generate-idea-research-prompts.md; src/api/llms/prompts/summarize-idea-research.md; src/api/routes/docs/idea-jobs.md; src/api/e2e/mockExternalServices.mjs.
- Scope: initial discovery requests concrete option names, categories and short descriptions, with follow-ups for missing parts of the space. Candidate generation, selection, detailed research and shared runtime remain unchanged.
- Validation: Node 26.5.1 npm run gatekeep passed: lint, typecheck, knip, 834 API tests and 375 web tests. Focused prompt/workflow tests passed. Independent API checklist review found no actionable issues; diff check passed.
- The initial gate exposed a test-helper bug: any prompt containing debate triggered debate-context validation. The one-line fixture fix reuses existing classified stage keys. Both failing restart tests and the final full gate passed.
- Real-model evidence: an isolated running-shoe crawl gathered 15 page summaries plus one retrieval-fallback snippet. It exposed specification drift and was deliberately stopped during second-round result selection. The tightened final prompts passed a six-stage live DeepSeek Pro/Flash replay over that captured evidence: planner, option map, coverage review, follow-up query planning, source correction and briefing. The replay added no web retrieval or candidate/debate calls. This is live-model evidence replay, not a fresh complete search under the final prompts.
- Evidence: /tmp/rethinkloop-ticket31-gatekeep-final.log; /tmp/rethinkloop-ticket31-discovery-replay-t1N6PF/briefing.md; /tmp/rethinkloop-ticket31-discovery-replay-t1N6PF/assessment.json; /tmp/rethinkloop-ticket31-discovery-replay-t1N6PF/report.json.
- Review notes: the final map and briefing retain concrete alternatives and coverage gaps without selecting a winner or including numeric candidate specifications/prices. Actual follow-up queries explore track/spike and recovery categories. A budget-category example threshold in review was not imposed by queries or final outputs. No source-code commit, merge, push or deployment performed.

[[2026-09-13]] Sun 00:12
User replaced the prompt-only scope. Implement a real initial space-discovery workflow that reuses search rounds, retrieval, durable execution and coverage checks; produces a broad unranked option inventory for idea generation; and pauses after generated ideas. Both Ideas and the direct-debate form use this preview flow. Start debate continues with the same persisted ideas through existing selection, refinement, individual research and tournament. Detailed candidate research begins only after the click. Leave source code uncommitted for review.

[[2026-09-13]] Sun 00:16
Read-only design investigation completed. Recommended implementation: reuse deep-search retrieval, settlement, round persistence and recovery; add a distinct discovery inventory and breadth-coverage review path; pass the original request into discovery without generated research-prompt fan-out; feed all discovered options into existing idea generation; persist a ready state before selection; create and attach one debate on Start debate, preserving idea IDs. Need resolve three product questions sent to user before source edits. Shared limits matter because existing Ideas defaults can exceed the debate page/candidate caps. Existing unfinished jobs need an explicit durable distinction if they retain the original automatic flow. A single discovery child requires new jobs deepSearchCount=1 and removal of mandatory planner generation. Tests planned: cumulative inventory/coverage continuation, stable pause and no downstream work, owner-only idempotent continuation, restart after idea commit, both UI entry points. Migration must preserve incoming FK children and handwritten triggers; ready must be excluded from startup and normal Resume. Worktree remains /Users/florian/projects/deep-search-debate/.worktrees/codex-ticket-31-space-discovery on codex/ticket-31-space-discovery. No new source changes or validation this resumed turn; four previous uncommitted files remain. Source code uncommitted; no merge, push or deployment.

[[2026-09-13]] Sun 01:01
User confirmed all three decisions: one coordinated discovery search; existing debate limits for the shared new flow; existing unfinished jobs retain their original workflow. Implementing the saved discovery and ready/start transition with stable idea IDs.
