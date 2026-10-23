---
id: 41
title: Add a final synthesis answer above completed debate results
status: review
priority: high
created: 2026-10-23T15:25:44.362103+02:00
updated: 2026-10-23T15:46:40.383797+02:00
tags:
    - feature
    - debates
class: standard
---

Confirmed scope: automatically generate a full explanation answering the original question from every match transcript, including judge verdicts. The synthesis may combine ideas or disagree with the tournament winner without changing that winner. Use the configured Big model and existing streaming, persistence, visibility, Stop and Resume mechanisms. Stream above the winner card and preserve existing winner/website/tournament. Synthesise only; no extra research, condensation, truncation, backfill, regeneration controls or compatibility work. Input overflow or generation failure fails the resumable workflow; completion requires the answer. No new dependencies.

[[2026-10-23]] Fri 15:46
## Handoff
- Worktree: /Users/florian/projects/deep-search-debate/.worktrees/codex-ticket-41-debate-answer
- Branch: codex/ticket-41-debate-answer; task code remains uncommitted.
- Changed: final-answer Big prompt and full transcript context; durable generation link, completion/Resume integration and fresh schema; streamed answer above winner with existing visibility; focused lifecycle/schema/UI tests and real-stack provider fixtures.
- Verified: Node26.5.1 canonical npm run gatekeep passed lint, typecheck, Knip, 1041 API tests and414 web tests (1455 total). Web and Storybook production builds passed. DeepSeek full23-match/public/reload, Codex full23-match Big model, and forced answer failure/Resume browser scenarios passed; final-code DeepSeek flow rerun passed. Fresh schema retained21 triggers and passed foreign-key/integrity checks.
- Reviews: dedicated root/API/database/web checklists complete. Fixed Stop falsely announcing a partial answer complete, escaped prompt-data delimiters with exact roundtrip regression, exercised linked answer cascade deletion, and corrected event docs.
- Review notes: one nullable owned generation pointer, no new dependency, no clipping/condensation/new research/backfill or regeneration controls. Fresh0000 baseline changed as requested; pre-change databases need recreation. Existing database files were not deleted. Initial fixture/lint failures were caused by the new completion requirement and are fixed; worktree dependency discovery was resolved by linking the existing installed dependency tree without changing manifests.
- Next: user review; commit/merge/push/deploy not performed.
