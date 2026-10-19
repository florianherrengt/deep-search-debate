---
id: 37
title: Replace ScrapingAnt with private Browserless and direct fetching
status: done
priority: high
created: 2026-10-19T21:06:52.310211+01:00
updated: 2026-10-19T21:39:35.514071+01:00
started: 2026-10-19T21:39:35.516415+01:00
completed: 2026-10-19T21:39:35.516415+01:00
tags:
    - feature
    - api
    - infrastructure
class: standard
---

Confirmed scope: deploy Browserless privately with token authentication in existing Coolify environment; direct HTTP first and Browserless fallback; preserve local document extraction and page-level failure handling; page extraction costs zero credits while search charges remain. User confirms app is open source and free. Leave task code uncommitted for review under repository workflow.

[[2026-10-19]] Mon 21:34
Ready for review. Worktree: /Users/florian/projects/deep-search-debate/.worktrees/codex-ticket-37-browserless; branch codex/ticket-37-browserless. Task code remains uncommitted. Browserless v2.57.1 deployed privately as Coolify service sby755x538nk9u9g1tuw2hj9, pinned image sha256:93dc614e2532ee66bac78f68b6229c33392309293c626d2a0899ccdf0c8aac67; healthy, no published ports/domain, token authentication verified (401 anonymous, 204 authenticated). Both routed and bridge nft egress policies installed and enabled before Docker; live private IPv4/IPv6/host and DNS-to-private probes blocked; application-container access works. New literal runtime-only Browserless URL/token configured in Coolify without restarting the existing RethinkLoop image; legacy ScrapingAnt key retained until application release. App changes: direct public HTTPS with DNS pinning/validated redirects, private Browserless fallback, preserved document extraction, zero new extraction credits with unchanged search billing and historical rows; updated config, tests, E2E mocks and operations docs. Verified: Node26.5.1 npm run gatekeep (931 API and 409 web tests, lint/typecheck/Knip); full Playwright20/20; focused101/101; restartRecovery6/6; root/API/web dedicated checklist reviews; real direct HTML/JSON; real JavaScript page fallback through deployed Browserless (1443 characters, 5 links). Next: explicit user approval to commit/merge and release updated RethinkLoop. Production RethinkLoop still runs its previous image until release.

[[2026-10-19]] Mon 21:39
User approved committing, merging, pushing, and deploying. Integrating reviewed task code with current main, then verifying and releasing the exact combined commit.

[[2026-10-19]] Mon 21:39
Approved task commit 528466e merged into main (8a357f1), preserving the concurrent Refine evidence-ID fix. Prior full gate and browser E2E proof recorded above; combined-main release checks are running before publishing. User explicitly authorized push and production deployment.
