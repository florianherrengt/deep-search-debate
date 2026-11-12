---
id: 45
title: Clarify invalid model output errors and link IDs
status: in-progress
priority: high
created: 2026-11-12T00:24:41.577418Z
updated: 2026-11-12T00:59:37.541831Z
tags:
    - bug
    - llm
claimed_by: riotous-sympathy
claimed_at: 2026-11-12T00:59:37.541989Z
class: standard
---

Production search steam-deck-verified-builder-and-survival-game-picks failed on 2026-11-08 in select-linked-pages: DeepSeek returned Steam app identifiers from URLs instead of the supplied UUID id fields. Clarify the existing research link-selector prompt to require exact id-field values. Preserve strict validation, failure behavior, models and persistence. Keep task code uncommitted for review; no deployment or automatic Resume.

[[2026-11-12]] Thu 00:30
Ready for review. Worktree: /Users/florian/projects/deep-search-debate/.worktrees/codex-ticket-45-linked-page-ids. Branch: codex/ticket-45-linked-page-ids. Only application file changed: src/api/llms/prompts/select-linked-pages.md; exact id-field copying now distinguishes IDs embedded in URLs. Strict validation, schemas, persistence and models are preserved. Validation: git diff --check, lint, typecheck and Knip passed. API suite: 1032/1033 passed; one real-browser test timed out under full-suite load, then passed unchanged on both main and this worktree in focused reruns. All 409 web tests passed. Initial restricted test execution could not open local listeners or launch Chrome; reran with needed host permissions. Dedicated src/api/gatekeep.md review found no issues. Prompt-only instructions reduce the observed confusion but cannot guarantee model compliance. Task code remains uncommitted. Production was neither changed nor resumed; the saved search is still failed.

[[2026-11-12]] Thu 00:59
User confirmed on 2026-11-12: improve all model-validation error messages with the failed stage, and correct the saved error on the existing Steam Deck search. Retain technical server diagnostics and strict failure behavior. Prior prompt correction remains in scope. Production error text correction is authorized; deployment and Resume are not requested.
