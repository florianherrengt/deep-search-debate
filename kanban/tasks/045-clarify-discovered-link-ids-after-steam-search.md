---
id: 45
title: Clarify discovered link IDs after Steam search failure
status: in-progress
priority: high
created: 2026-11-12T00:24:41.577418Z
updated: 2026-11-12T00:24:41.577418Z
tags:
    - bug
    - llm
claimed_by: riotous-sympathy
claimed_at: 2026-11-12T00:24:41.577418Z
class: standard
---

Production search steam-deck-verified-builder-and-survival-game-picks failed on 2026-11-08 in select-linked-pages: DeepSeek returned Steam app identifiers from URLs instead of the supplied UUID id fields. Clarify the existing research link-selector prompt to require exact id-field values. Preserve strict validation, failure behavior, models and persistence. Keep task code uncommitted for review; no deployment or automatic Resume.
