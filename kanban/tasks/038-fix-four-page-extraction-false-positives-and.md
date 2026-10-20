---
id: 38
title: Fix four page extraction false positives and documentation pruning
status: review
priority: high
created: 2026-10-20T14:02:51.731723+01:00
updated: 2026-10-20T14:10:34.54132+01:00
tags:
    - bug
    - api
class: standard
---

Fix the four failures reproduced during Browserless diagnosis: Mozilla Client Challenge accepted as evidence; legitimate CAPTCHA documentation rejected; inline script NUL bytes reject valid HTML; CSS custom-property classes cause shared sanitizer to prune documentation. User confirmed all fixes must remain inside RethinkLoop. Preserve real challenge, binary, hidden/noise, JSON/PDF, URL and credit behavior. No retrieval-method persistence or deployment in this task.

[[2026-10-20]] Tue 14:10
## Handoff
- Worktree: /Users/florian/projects/deep-search-debate/.worktrees/codex-ticket-38-page-extraction-fixes
- Branch: codex/ticket-38-page-extraction-fixes
- Files: src/api/web_search/webExtract.ts and webExtract.test.ts; task code remains uncommitted.
- Fixed all four diagnosed extraction bugs entirely inside RethinkLoop, without new dependencies or deep-search-core changes. Original HTML remains authoritative for titles and links; only the text-extraction view normalizes ignored script/style NULs and CSS custom-property class fragments. Explicit CAPTCHA walls remain rejected while valid CAPTCHA documentation is accepted.
- Verified: regression-first tests captured the four original failure classes, then the CAPTCHA-wall review finding; final focused 39/39 passes. npm run gatekeep passed lint, typecheck, Knip, 947 API tests and 409 web tests. Final source/test ESLint and diff-check passed.
- Real URLs: HTTP recovered Browser MCP capability matrix (9407 chars), Browser MCP docs (664, four script NULs), DoBrowser docs (641), GitHub (32887), X post (656, eleven script NULs). A side-process smoke using the new extractor and production transport credentials rejected the Mozilla HTTP Client Challenge, used private Browserless, and returned the real extension listing (1590 chars). No saved workflow, application image, production source, or DB was changed.
- Root and API checklist agents reviewed the complete final diff; their final reports have no material findings.
- Ready for user review; no task-code commit, merge, push, or deployment performed.
