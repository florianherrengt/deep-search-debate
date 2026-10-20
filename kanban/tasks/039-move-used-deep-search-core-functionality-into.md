---
id: 39
title: Move used deep-search-core functionality into RethinkLoop
status: review
priority: medium
created: 2026-10-20T16:26:53.659681+01:00
updated: 2026-10-20T16:36:59.449849+01:00
class: standard
---

Move only the currently used URL/IP validation, SearXNG, HTML text cleanup and isolated PDF extraction into this repository. Preserve existing behavior, remove the external package completely, and verify with focused tests, gatekeep and relevant workflow E2E tests. User confirmed scope and authorized implementation on 2026-10-20.

[[2026-10-20]] Tue 16:36
## Handoff
- Worktree: /Users/florian/projects/deep-search-debate/.worktrees/codex-ticket-39-local-search-extraction
- Branch: codex/ticket-39-local-search-extraction
- Source changes: local URL/IP validation, SearXNG handling, HTML visible-text cleanup and bounded PDF extraction with an isolated local TypeScript child process. Removed the external package, promoted already-installed parser dependencies and retained the MIT license. Updated Coolify documentation.
- Verification: Node 26.5.1 npm run gatekeep passed (977 API tests, 409 web tests; lint/typecheck/knip passed). Eight Playwright scenarios passed across deepSearch, ideas and debates (3.8 minutes; outbound provider/network mocks, real app/SQLite/extraction/replay). Focused extraction tests passed 77 tests across seven files.
- Preservation checks: direct comparison with the installed old package matched 16 URL, 10 IP and seven HTML cases; SearXNG read failures and original error formatting are regression-tested; separate PDF fetch/parse budgets and child exit cleanup are covered.
- Review: dedicated root and API gatekeep reviewers have no remaining findings. No package version changes or new installed packages; nine package entries removed. No external core references remain in application source, manifests, lockfile or deployment files.
- Code is uncommitted for user review. No merge or deployment performed.
