---
id: 35
title: Ask for 2000-character idea descriptions and truncate at 3000
status: review
priority: high
created: 2026-10-09T18:17:22.474558+01:00
updated: 2026-10-09T18:27:20.026658+01:00
tags:
    - bug
    - ideas
class: standard
---

User-confirmed behavior: initial idea generation and refinement share one description rule. Ask the model for descriptions up to 2,000 characters. Preserve descriptions through 3,000 characters and truncate longer descriptions to 3,000 internally. Preserve existing title validation, malformed-output failures, provider behavior, and completed workflow checkpoints. Add focused schema and persistence regression coverage. Do not commit task code, merge, push, deploy, or resume production without separate authorization.

[[2026-10-09]] Fri 18:27
## Handoff
- Worktree: /Users/florian/projects/deep-search-debate/.worktrees/codex-ticket-35-idea-description-limit
- Branch: codex/ticket-35-idea-description-limit
- Changes: shared ideaSchema truncates descriptions to 3,000; initial generation and refinement prompts request at most 2,000. Prompt contract documentation and three existing test files updated. Title and malformed-output validation remain strict; raw provider text remains available.
- Verified: test-first failure reproduced; 13 focused tests passed; saved original 2,155-character response and 2,342-character replay accepted unchanged; 4,000-character input truncates to 3,000. Full npm run gatekeep passed (lint, typecheck, knip, 886 API tests, 396 web tests). Independent root and API checklist reviews found no issues. Worktree reuses existing installed dependencies; full checks required local server access for restart tests.
- Review state: seven changed files remain uncommitted in the worktree. Production deployment and failed-run resume are not performed.
