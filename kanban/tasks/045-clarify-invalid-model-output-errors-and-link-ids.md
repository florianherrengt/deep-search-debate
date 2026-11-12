---
id: 45
title: Clarify invalid model output errors and link IDs
status: review
priority: high
created: 2026-11-12T00:24:41.577418Z
updated: 2026-11-12T01:16:11.773599Z
tags:
    - bug
    - llm
class: standard
---

Production search steam-deck-verified-builder-and-survival-game-picks failed on 2026-11-08 in select-linked-pages: DeepSeek returned Steam app identifiers from URLs instead of the supplied UUID id fields. Clarify the existing research link-selector prompt to require exact id-field values. Preserve strict validation, failure behavior, models and persistence. Keep task code uncommitted for review; no deployment or automatic Resume.

[[2026-11-12]] Thu 00:30
Ready for review. Worktree: /Users/florian/projects/deep-search-debate/.worktrees/codex-ticket-45-linked-page-ids. Branch: codex/ticket-45-linked-page-ids. Only application file changed: src/api/llms/prompts/select-linked-pages.md; exact id-field copying now distinguishes IDs embedded in URLs. Strict validation, schemas, persistence and models are preserved. Validation: git diff --check, lint, typecheck and Knip passed. API suite: 1032/1033 passed; one real-browser test timed out under full-suite load, then passed unchanged on both main and this worktree in focused reruns. All 409 web tests passed. Initial restricted test execution could not open local listeners or launch Chrome; reran with needed host permissions. Dedicated src/api/gatekeep.md review found no issues. Prompt-only instructions reduce the observed confusion but cannot guarantee model compliance. Task code remains uncommitted. Production was neither changed nor resumed; the saved search is still failed.

[[2026-11-12]] Thu 00:59
User confirmed on 2026-11-12: improve all model-validation error messages with the failed stage, and correct the saved error on the existing Steam Deck search. Retain technical server diagnostics and strict failure behavior. Prior prompt correction remains in scope. Production error text correction is authorized; deployment and Resume are not requested.

[[2026-11-12]] Thu 01:16
Expanded implementation ready for review in /Users/florian/projects/deep-search-debate/.worktrees/codex-ticket-45-linked-page-ids, branch codex/ticket-45-linked-page-ids. Nine files changed: shared structured parser now replaces raw model-validation dumps with stage-specific messages while preserving original error identity/issues and diagnostics; prompts.ts owns stage labels; empty-output messages name the stage; original prompt clarification remains. Regression evidence: 8 intended failures before source change; 71 affected tests passed afterward; 4 discovery pipeline tests passed after updating only two obsolete raw-message expectations. Final full checks passed: lint, typecheck, Knip, all 1038 API tests and all 409 web tests. API used --maxWorkers=2 after the unchanged real-browser test timed out at standard full-suite concurrency. Dedicated API gatekeep review found no issues in the complete nine-file diff. Production saved text correction completed and re-queried: 1 job, 1 generation, 3 queries, 6 pages, with exact-old-error guards and all other columns unchanged. Backup: /data/rethinkloop/data/error-correction-8cb2fc01-2a69-45f1-aef6-fc59156c8347-20261112T011227875169Z.json. New saved error: Linked-source selection failed because the model returned link IDs that were not supplied. The failed generation has an older retained in-memory stream log; it can still show raw detail until restart. The main job error reads corrected DB state. Browser was unsigned-in so no live visual verification. No restart, Resume, release, or task-code commit performed. A release restarts the app and automatically resumes unfinished roots, requiring explicit user approval. Source remains uncommitted for review.
