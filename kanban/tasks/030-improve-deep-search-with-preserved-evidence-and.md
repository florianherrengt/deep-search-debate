---
id: 30
title: Improve deep search with preserved evidence and linked-source verification
status: in-progress
priority: high
created: 2026-09-07T19:29:18.713132+01:00
updated: 2026-09-07T22:00:50.635974+01:00
tags:
    - feature
    - research
claimed_by: hipping-hipless
claimed_at: 2026-09-07T22:00:50.636299+01:00
class: standard
---

Transfer applicable methods from ../rethink-loop-research into the shared deep-search pipeline: preserve source provenance and qualifications, use focused gap-driven queries, and follow relevant source links with durable bounded execution. User approved higher cost and runtime when useful and explicitly excluded before-and-after benchmarking; this implementation becomes the new baseline. Preserve existing providers, recovery, cancellation and truthful replay. Validate correctness and the real user flow. Leave task code uncommitted for review.

[[2026-09-07]] Mon 19:58
## Handoff
- Worktree: /Users/florian/projects/deep-search-debate/.worktrees/codex-ticket-30-deep-search-evidence
- Branch: codex/ticket-30-deep-search-evidence. Task code is uncommitted for user review.
- Implemented: preserve source URLs, qualifications and evidence types through query planning, answer, review and structured analysis; focused gap-driven queries; bounded two-hop linked-source exploration with durable selection, extraction, deduplication, resume/replay and visible provenance.
- Defaults: three standalone research rounds, two debate child rounds, separate linked-page allowance per round, 600-page root ceiling and 200-page debate ceiling. Existing explicit lower request controls remain respected. No new dependencies.
- Main files: src/api/agents/deep_search, src/api/routes/deepSearch, src/api/web_search/webExtract.ts, new additive linked-page migration, src/web linked-source state/view, focused tests and scoped documentation.
- Verified: Node 26; npm run gatekeep passed (756 API + 356 web tests); npm run build:web passed; all 15 controlled-provider Chromium E2Es passed; desktop and 390px mobile linked-source Storybook inspection passed; fresh/upgrade migrations and existing aggregate deletion passed.
- Reviews: dedicated root, API, database and web checklist reviews completed with no remaining findings.
- Validation note: one unchanged Ideas reconnect assertion briefly captured a removed alert during a concurrent full run. Focused worktree/main and full Ideas reruns passed; final standalone canonical gate passed without source/test changes for that race. Build retains the existing large-chunk warning.
- This is the new baseline. No before-and-after answer-quality benchmark was run, as requested. Functional E2E verifies the real app path using controlled external provider responses.

[[2026-09-07]] Mon 22:00
User approved the next five improvements: retain original supporting passages, mandatory final source-backed correction, ranked link discovery, explicit requirements and coverage context, and bounded JSON source reading. Triple linked-page capacity with a reserved share for deeper hops; keep existing worktree, providers, durable recovery, and uncommitted review handoff. No comparative quality benchmark.
