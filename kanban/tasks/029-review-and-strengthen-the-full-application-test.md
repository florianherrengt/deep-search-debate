---
id: 29
title: Review and strengthen the full application test suite
status: done
priority: medium
created: 2026-09-07T17:57:32.500441+01:00
updated: 2026-09-07T18:47:11.118732+01:00
started: 2026-09-07T18:47:11.121666+01:00
completed: 2026-09-07T18:47:11.121666+01:00
class: standard
---

Review every test area and consolidate low-value or redundant tests only after equal or stronger behavior proof exists. Prefer real migrated SQLite, real internal paths, and external protocol boundaries. Preserve production behavior, dependencies, security, financial, integrity, concurrency, and regression safeguards. Measure original/final counts, run focused tests per batch and full gate plus browser E2E, report retained repetition and architectural obstacles. Use cheaper subagents extensively.

[[2026-09-07]] Mon 18:38
Reviewed all 148 original test files with cheaper GPT-5.6 Luna subagents. Removed seven weak Vitest cases and one assertion-free browser diagnostic; added twelve behavior cases for real generation and SQLite settlement/rollback, persisted creation, recovery ordering, financial rejection, and stream lifecycle. Final gate passed lint, typecheck, knip, and 1075 tests (729 API, 346 web; baseline 1070). All 14 remaining browser scenarios passed. Three temporary production faults were detected and restored before the final passing gate. Root, API, web, and database checklist reviews are clean. Full inventory, retained repetition, architecture limitations, and the existing selection-policy discrepancy are documented in docs/test-suite-review.md. Verified test and documentation changes remain uncommitted on codex/ticket-29-test-suite in /Users/florian/projects/deep-search-debate/.worktrees/codex-ticket-29-test-suite; production code, dependencies, migrations, and runtime configuration are unchanged.

[[2026-09-07]] Mon 18:47
Approved changes committed as d93351b and merged into local main as 927be20. The merged source and test tree exactly matches the verified task branch outside the canonical board. Prior final gate passed all 1075 tests and all 14 browser scenarios. Worktree and branch retained; no push performed.
