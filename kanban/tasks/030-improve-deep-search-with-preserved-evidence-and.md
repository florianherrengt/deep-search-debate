---
id: 30
title: Improve deep search with preserved evidence and linked-source verification
status: in-progress
priority: high
created: 2026-09-07T19:29:18.713132+01:00
updated: 2026-09-08T16:42:54.5182+01:00
tags:
    - feature
    - research
claimed_by: dealt-eelware
claimed_at: 2026-09-08T16:42:54.518324+01:00
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

[[2026-09-07]] Mon 22:52
## Handoff — expanded search baseline
- Worktree: /Users/florian/projects/deep-search-debate/.worktrees/codex-ticket-30-deep-search-evidence
- Branch: codex/ticket-30-deep-search-evidence. All task code remains uncommitted for review.
- Implemented: retained query-relevant original source passages (up to 16,000 characters); mandatory source-backed final correction followed by analysis of the corrected answer; requirements/preferences checklist in existing generation records; known-page context for selection; main-content link ranking before the candidate limit; validated bounded JSON source extraction.
- Defaults: linked-page allowance is three times the search-selected allowance. At default settings, up to 27 linked pages per round with 9 reserved for the second hop. Root workflow ceiling is 1,200 pages and debate ceiling is 400. Existing explicit controls and provider/model choices remain respected.
- Recovery: additive migration preserves existing data; actual legacy {elements:[...]} plans and older bare arrays remain readable. Completed legacy query rows, including duplicate-filtered empty rounds, are authoritative. Completed correction and analysis are reused; live and replay checklists agree, including empty updates.
- Stories and docs: updated readable requirement coverage, provisional final checking, legacy plan rendering, linked-source progress, and desktop/mobile states.
- Verified: final Node 26 gatekeep passed (793 API + 370 web = 1,163 tests); production web build passed; final affected Deep Search browser suite passed 3/3; focused Ideas and both OpenAI browser cases passed. File-backed migration chain applied successfully, integrity_check=ok and foreign_key_check empty; upgrade/ownership/deletion cases pass.
- Browser suite note: latest complete Chromium run passed 14/15. The unchanged debate test briefly expected Streaming after a reload during which its 350 ms response had legitimately completed. Initial streaming had already been observed; the unchanged focused case passed in 55 seconds. No unrelated product or timing-fixture changes were made. Logs: /tmp/rethinkloop-ticket30-e2e.log and /tmp/rethinkloop-ticket30-debate-focused.log.
- Independent root/API/database/web checklist reviews completed; identified live/replay and legacy-checkpoint issues were fixed and covered by regressions. No remaining task-code findings. Build retains its existing large-chunk warning.
- No before-and-after answer-quality benchmark was run, as requested. Controlled-provider browser tests prove orchestration, evidence propagation, correction, persistence, provider routing, and UI behavior.

[[2026-09-08]] Tue 16:42
User approved fixing legacy saved OpenAI credential compatibility discovered during the live search smoke test. Preserve existing encrypted credentials and model choices, verify automatic refresh, then rerun the live search. Reuse the existing task worktree; no schema changes or new dependencies.
