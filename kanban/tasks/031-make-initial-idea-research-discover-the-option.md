---
id: 31
title: Make initial idea research discover the option space
status: review
priority: medium
created: 2026-09-12T21:26:43.816524+01:00
updated: 2026-09-12T21:54:38.707277+01:00
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
