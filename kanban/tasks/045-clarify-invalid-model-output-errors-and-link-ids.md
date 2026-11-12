---
id: 45
title: Clarify invalid model output errors and link IDs
status: done
priority: high
created: 2026-11-12T00:24:41.577418Z
updated: 2026-11-12T02:54:32.376055Z
started: 2026-11-12T02:54:32.378628Z
completed: 2026-11-12T02:54:32.378628Z
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

[[2026-11-12]] Thu 02:54
Released and verified after explicit user approval to commit, push, deploy and test. Implementation commit 1b6e96c; integrated and pushed main release a9e10a4a4f38f399e48ab1baaa465b2bb2ce2b86. Dagger published docker.io/florianherrengt/rethinkloop:a9e10a4a4f38f399e48ab1baaa465b2bb2ce2b86 with digest sha256:e2a0b1a6540b6a01d9e71810b4fb6a8873630cc66f26b81a1d406fe36449c866. Coolify deployment rjosjhbhuyzhhof1sngzca52 finished 2026-11-12T02:16:45Z; running container and public health verified healthy. Manual consistent SQLite backup passed quick_check at /data/rethinkloop/backups/pre-validation-errors-20261112T012605Z.db before deployment. Build required reclaiming unused local Docker build cache; images, containers and data preserved. All 1447 local tests and static checks passed; 71 targeted tests passed inside deployed image using isolated in-memory DB and loopback test host. Actual deployed subscribeToTextStream replay verified corrected historical error and terminal done event after cache-clearing restart. Original live job 8cb2fc01-2a69-45f1-aef6-fc59156c8347 completed at 2026-11-12T02:52:06.966Z with error null: all 9 queries complete, 71 pages read, 13 accepted page fallbacks, no active work. Replacement selector eae15468-298d-402b-934c-e1c51bdc074f selected 3 supplied IDs and persisted edges; all 20 prior completed generations unchanged. Corrected answer a73dcd56-4c87-411f-879e-77d8454ed015 and canonical-schema-valid analysis 2ac40d5a-2379-4844-946c-7244e8efec0e are completed and job-owned. Final independent application-code read and public health checks passed. Existing unrelated local changes preserved; worktree retained.
