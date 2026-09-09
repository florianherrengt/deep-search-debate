---
id: 30
title: Improve deep search with preserved evidence and linked-source verification
status: in-progress
priority: high
created: 2026-09-07T19:29:18.713132+01:00
updated: 2026-09-09T01:53:13.247095+01:00
tags:
    - feature
    - research
claimed_by: dealt-eelware
claimed_at: 2026-09-09T01:53:13.247209+01:00
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

[[2026-09-08]] Tue 17:12
## Handoff — saved OpenAI credentials and live search proof
- Fixed compatibility with encrypted pre-Pi Codex auth.json credentials. Valid legacy tokens are adapted in memory without rewriting the saved row; normal refresh retains the existing per-user lock and connection-ID compare-and-swap and persists rotated credentials in the current Pi format.
- Malformed credentials now retain the safe protocol-incompatible diagnosis through both Pi credential reads and streamed errors instead of being mislabeled as expired. No schema change, dependency, provider switch, or reconnect was required.
- Regression proof: actual Pi auth integration covers legacy read, expired-token refresh/rotation, fresh-instance reuse, malformed expiry/payloads, disconnect/reconnect races, and flattened stream errors. Final Node 26 gatekeep passed: lint, typecheck, knip, 808 API tests and 370 web tests (1,178 total). Dedicated root/API/database/web checklist reviews completed with no remaining findings.
- Real-provider UI search completed: http://localhost:5180/deep-search/sqlite-wal-multi-process-support (job 8d6f6d03-ba0e-462f-8273-3306bd39acf5). Existing OpenAI Luna/Sol model choices, real SearXNG and ScrapingAnt; three queries, 31 completed page extractions including 15 second-hop paths, 52 completed generations, 34 product credits, 20 minutes 9 seconds. An earlier failed title-generation attempt predates the fix; the completed live job has no error.
- The reviewer stopped after one round with all four SQLite WAL requirements covered. Mandatory correction changed the answer and added the URI citation, then structured analysis completed before the job. Main conclusions match the official evidence: same-host concurrency with one writer, ordinary WAL unsupported across NFS servers, conditional read-only opening, and SQLite backup facilities for a consistent live backup.
- Restart proof: restarted the owned API and web services, reopened the saved result, and verified completed answer, four supported requirements, and connected OpenAI Luna/Sol settings. Hashes of job, rounds, generations, encrypted connection, and model settings remained unchanged; credits stayed 436. Integrity check passed and no foreign-key violations.
- Live quality follow-ups, outside this credential fix: duplicate www/non-www pages and overlapping forum views consume browsing allowance; some decisive source sections are absent from retained original passages even though summaries contain the facts; navigation links receive some selections; the final analysis still treats the documented immutable-modification hazard too cautiously; Markdown pipe tables render as plain text. No comparative benchmark was run.
- Local fixture uses an isolated fresh test DB with the existing debug account, encrypted connection, and model settings copied from main. Original main DB is untouched. All task code remains uncommitted in /Users/florian/projects/deep-search-debate/.worktrees/codex-ticket-30-deep-search-evidence on codex/ticket-30-deep-search-evidence for user review. No merge, push, or deployment performed.
- Final gate log: /tmp/rethinkloop-ticket30-credentials-final-gatekeep.log. Live API logs: /tmp/rethinkloop-ticket30-live-api.log and /tmp/rethinkloop-ticket30-restarted-api.log.

[[2026-09-09]] Wed 01:22
User approved remark-gfm. Continue the live-search follow-ups: bounded known-page evidence for linked-source selection, summary-informed original passage retention and final context, and Markdown table rendering with the existing React/MUI renderer. Reuse this worktree and existing data structures; leave task code uncommitted for review.

[[2026-09-09]] Wed 01:40
## Handoff — Markdown tables and live-search follow-ups
- Added the approved remark-gfm dependency to the existing React/MUI renderer. Tables are semantic and horizontally scrollable with visible keyboard focus; streaming preserves scroll/focus; footnotes and backlinks remain scoped to each answer. Added a comparison-table story and focused rendering/security/accessibility coverage.
- Linked-page selection now receives bounded known-page status, titles, and available completed summaries, helping it avoid repeating evidence while preserving distinct URLs and version/query-specific sources. No URL-identity rewriting or new persistence was introduced.
- Successful page summary completion now refines the existing original-passages field using the research request plus the completed summary, then clears temporary extraction in the same transaction. Final context narrowing uses the full summary too. Passages remain verbatim and bounded; completed historical pages and failed summaries are preserved.
- Verified on Node 26: final gatekeep passed (819 API + 375 web = 1,194 tests), all 15 controlled-provider browser E2Es passed, production web build and Storybook build passed. Builds retain the existing large-chunk warning.
- Real UI proof: desktop and 390px mobile tables, keyboard horizontal scrolling, footnote/backlink navigation, and saved real search rendering after restarting the API at http://localhost:5180/deep-search/sqlite-wal-multi-process-support. The saved job remains complete and credits remain 436.
- A read-only check using the saved 31-source live search and the actual final-context formatter retained the previously omitted immutable-modification warning, incorrect-query risk, and SQLITE_CORRUPT passage within the existing 100,000-character context budget (94,810 characters). No stored result was rewritten.
- Dedicated root, API, database, and web checklist reviews found no remaining actionable issues. Final diff whitespace check passed. No new full real-provider search or before-and-after quality benchmark was run; reduction in duplicate browsing has not been measured live.
- Worktree: /Users/florian/projects/deep-search-debate/.worktrees/codex-ticket-30-deep-search-evidence. Branch: codex/ticket-30-deep-search-evidence. All task code remains uncommitted for user review; no merge, push, or deployment. Final logs: /tmp/rethinkloop-ticket30-followups-gatekeep.log and /tmp/rethinkloop-ticket30-followups-e2e.log.

[[2026-09-09]] Wed 01:53
User approved gap-informed continuation: analyze material searchable gaps before deciding to stop and feed those gaps into the next focused round while respecting the existing hard limit. Reuse existing review and durable generation mechanisms, preserve completed research, and leave task code uncommitted for review.
