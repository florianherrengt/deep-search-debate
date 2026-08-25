---
id: 16
title: Remove excessive LLM logging
status: done
priority: low
created: 2026-08-24T12:11:50.587287+01:00
updated: 2026-08-25T11:50:52.238328+01:00
started: 2026-08-25T11:25:25.961852+01:00
completed: 2026-08-25T11:50:52.239478+01:00
tags:
    - chore
class: standard
---

The API logs are polluted by per-generation info logs. Example: console.info("LLM generation", ...) at src/api/llms/streams.ts:532, and the "LLM generation" label appears across the codebase (errors in generateText.ts, store.ts, persistence.ts).

Audit src/api for per-request/per-generation info logging. Keep only what is operationally useful (failures, terminal job states, resource warnings). Keep or move diagnostics such as token usage and latency to a bounded summary or a debug level rather than per-generation info logs. Update tests that assert the current log output (src/api/llms/streams.test.ts).

[[2026-08-25]] Tue 11:33
Implemented the logging policy in the ticket worktree: successful/interrupted LLM generations and default page-retrieval attempts are silent; failed metadata-bearing generations retain one privacy-safe error summary; durable and injected diagnostics remain. Updated streaming docs and regression tests. Targeted API tests: 38 passed.

[[2026-08-25]] Tue 11:40
## Handoff
- Location: uncommitted changes in /Users/florian/projects/deep-search-debate/.worktrees/codex-ticket-16-remove-excessive-llm-logging on branch codex/ticket-16-remove-excessive-llm-logging
- Behavior: successful and interrupted LLM generations no longer log; failed metadata-bearing generations emit one privacy-safe error summary without token or latency details; page retrieval attempt diagnostics are opt-in; durable metadata is unchanged
- Files changed: src/api/llms/docs/prompts.md, src/api/llms/generateText.ts, src/api/llms/streams.ts, src/api/llms/streams.test.ts, src/api/routes/docs/text-streaming.md, src/api/web_search/webExtract.ts, src/api/web_search/webExtract.test.ts
- Verified: targeted API suite passed 38 tests; npm run gatekeep passed lint, typecheck, knip, 612 API tests, and 299 web tests; git diff --check clean; independent final review found no remaining issues
- Integration hint: review and commit the uncommitted worktree changes; no merge or commit was created by the agent
