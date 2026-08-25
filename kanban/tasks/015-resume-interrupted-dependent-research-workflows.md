---
id: 15
title: Resume interrupted dependent research workflows from persisted state
status: review
priority: medium
created: 2026-08-24T12:11:48.069418+01:00
updated: 2026-08-25T01:46:07.039167+01:00
started: 2026-08-24T12:21:24.380397+01:00
tags:
    - feature
class: standard
---

Add the ability to resume an interrupted (failed or stopped) idea generation instead of restarting from scratch.

The idea job pipeline (src/api/routes/ideas/) already persists its progress: idea job stages, deep_search_jobs, and llm_generations with statuses (src/api/db/schema/llmGenerations.ts, src/api/routes/docs/idea-jobs.md). On resume, read the persisted steps from the DB to determine where the pipeline stopped and continue from there, without regenerating completed work or charging credits twice.

Design decisions to confirm before implementation: resume only after interruption/failure, or also for user-initiated stop; UI entry point (Resume action on the idea page when status is failed/interrupted); whether completed deep-search sub-jobs can be reused as-is; what happens for the stage that was mid-flight (rerun the failing stage); behaviour when the user navigates away and comes back to a resumable job.

[[2026-08-24]] Mon 12:29
## Planning handoff
- Current state: read-only repository and contract investigation complete; no source files changed.
- Location: main; pre-existing unrelated working-tree changes preserved.
- Recommended scope: failed and restart-interrupted standalone idea jobs; keep explicit Stop irreversible; Resume only on the idea detail page; never auto-resume on revisit.
- Backend plan: persist missing search controls, atomically reopen an eligible job without a new creation admission, retain failed retry attempts, make the coordinator checkpoint-aware, seed resumed event replay from the durable prefix, and expose canResume.
- Open decisions: whether user-stopped and debate-owned jobs resume; whether failed child searches may start a fresh retained attempt or require granular sub-step recovery; and how legacy jobs without persisted controls behave.
- Next step: reclaim task 15 after user confirmation, then implement and verify the agreed plan.

[[2026-08-24]] Mon 12:43
Scope clarified by user: resumability must cover the entire dependent research workflow tree. A debate may need to resume its idea child, and an idea may need to resume its deep-search children. Planning is being revised around root-owned recursive recovery rather than an idea-only retry.

[[2026-08-24]] Mon 12:49


## Planning update

Scope is root-aware resumption across `debate → idea → deep search`, with standalone idea and deep-search roots also resumable. Nested jobs resume only through their effective root. The proposed plan adds execution epochs, closes missing checkpoint gaps, makes each pipeline idempotently reuse completed stages, and reconnects the UI/event feed for the new epoch.

Implementation is blocked pending confirmation of: user-stopped eligibility; legacy jobs whose original inputs/artifacts were never persisted; whether bounded extracted page text may be persisted; the policy for completed child searches rejected by the idea quality gate; and whether per-epoch Stop/failure history must be retained.

[[2026-08-24]] Mon 12:56
## Revised planning handoff
- Confirmed: on server startup, discover every non-completed effective root and schedule it for recovery rather than merely marking active rows interrupted. Capacity is respected by queueing excess roots.
- Confirmed: recovery is recursive and parent-owned: debate resumes its idea; idea resumes each deep search; deep search resumes its own persisted stages. Descendants never start independent root runs.
- Confirmed: no production-data compatibility is required. Remove legacy backfill/recovery paths from the plan and establish exact checkpoints in the fresh schema. No local data will be deleted without separate authorization.
- Remaining decisions: handling idea-owned searches that currently complete with a page-summary fallback but are then rejected; whether execution-level Stop/failure history must be stored; approval to retain bounded extracted page text until its summary completes.
- Source files changed: none. Board and working plan only.

[[2026-08-24]] Mon 17:19
Temporal Step 1 proof plan: keep the current public execution path unchanged and run a local proof with a separate Temporal worker. Phase 0 smoke-tests the current Node 26 direct-TypeScript runtime, Temporal workflow bundling, and native worker bridge. Phase 1 builds a deterministic synthetic debate to idea to deep-search child-workflow tree with stable business-derived workflow IDs; it proves automatic continuation after worker death, exhausted-failure parking and explicit resume, cooperative user Stop and resume, and recursive parent-to-child propagation while completed descendants remain untouched. Phase 2 exercises real persistence boundaries against one shared temporary SQLite file with deterministic outbound provider mocks: a completed LLM stage and one persisted searching query through web search, result persistence, and transactional credit settlement. Activities first read the owning durable stage, return completed output without provider work, and rerun only unfinished work; terminal settlement becomes a status-checked transactional compare-and-set. Required SIGKILL tests cover death during an unfinished activity, after DB commit but before Temporal acknowledgement, between child completion and parent continuation, duplicate workflow start/reconciliation, API restart while work continues, and simultaneous API-worker SQLite access. Acceptance requires stable workflow/child executions, exactly one application credit debit and durable result per logical stage, no regeneration of completed work, automatic resumption of active work when a worker returns, recursive Stop/resume, and DB-reconstructed progress after reconnect. The unavoidable provider-accepted-before-local-commit window is measured and documented; upstream exactly-once requires provider idempotency support. Non-goals are public-route cutover, UI changes, full deep-search stages, PostgreSQL migration, production deployment, and legacy-data compatibility. If the proof passes, the next plan covers PostgreSQL and the complete leaf-to-root migration; proof-only fixtures are then removed or retained only as crash regression tests.

[[2026-08-24]] Mon 17:19
Planning complete; no source or dependency files changed. Awaiting approval of the Temporal Step 1 proof plan and explicit permission to add the Temporal SDK dependencies before implementation.

[[2026-08-24]] Mon 17:44
SQLite reconciliation plan — this supersedes the earlier Temporal proof note. SQLite remains the only execution and product source of truth; add no workflow, execution, event, or epoch table and no orchestration dependency. Persist only missing facts: idea child-search limits; bounded extracted page content until its summary commits; a strict quality policy for idea-owned searches; and replaceable owning-stage links for failed or interrupted LLM attempts. Replace startup terminalization with reconciliation after managers are constructed and before HTTP listens. Scan effective roots only: debates, standalone ideas, and standalone deep searches whose status is not completed. Debate resumes its existing idea child; idea resumes each existing or missing position-owned deep search; deep search reconstructs rounds, queries, results, selected pages, summaries, answers, reviews, and analysis from SQLite and runs only the first unfinished facts. Descendants are never scheduled independently. Completed work is returned from persisted rows. A stale running provider generation is marked interrupted and a new immutable attempt is linked atomically; failed attempts remain for inspection. Search results, extraction output, LLM completion, owning-stage transition, credit settlement, and user debit each use status-checked transactions so retries can return the already-settled result. A crash after upstream acceptance but before the SQLite commit may repeat the provider request, but application credits settle once. Same-process failure or Stop parks the root until explicit Resume; a server startup resumes every non-completed root, including a previously stopped root, matching the confirmed startup rule. Resume clears the root Stop gate and terminal presentation fields. Resumed live logs are seeded from DB reconstruction before new events, so navigating away or reconnecting shows the completed prefix and follows new work. Implement leaf-to-root: persistence/loaders and atomic links; checkpoint-aware deep search; idea recovery; debate recovery; startup scan and root-only Resume APIs; reconnect UI; docs. Verify with table-driven persisted-prefix tests plus file-backed process-kill tests at registration, provider return, transaction commit, child completion, match verdict, website write, and root completion boundaries. Acceptance: completed stages make zero provider calls, only the mid-flight stage may rerun, application credits debit once, stable child/round/item counts do not grow, recursive ownership is preserved, and resumed output equals an uninterrupted run. Current single-process SQLite deployment remains an explicit invariant; multi-instance leases/fencing and legacy-data compatibility are out of scope.

[[2026-08-24]] Mon 17:44
Planning only; no application, schema, dependency, or documentation files changed. Awaiting approval of the superseding SQLite reconciliation plan before implementation.

[[2026-08-24]] Mon 18:12
## Clarification handoff
- Current state: full read-only trace of deep search, idea, debate, startup, SQLite settlement, replay, routes, UI, and tests is complete. No application, schema, migration, dependency, or documentation files changed.
- Location: main; unrelated working-tree changes remain preserved.
- Decision 1: Resume API contract. Recommend POST /api/{root-kind}/:id/resume; return 202 for both newly scheduled and already-live deduplicated execution, 409 for completed roots or descendants, and 404 for unknown or foreign roots.
- Decision 2: startup scheduling failure. Recommend fail startup if any effective root cannot be reset and scheduled, because reconciliation is required before accepting requests and silently parking a root would violate automatic recovery.
- Decision 3: existing optional round-review failure. Recommend preserve its accepted stop-exploring fallback when already persisted, rather than retrying it during an unrelated later recovery.
- Decision 4: permissive standalone page-summary failure. Recommend preserve the existing snippet fallback; retry failed page summaries only when the persisted child quality policy is strict.
- Decision 5: forward migration for new non-null idea limits. Recommend add schema defaults matching the existing request defaults so the forward migration remains valid for populated test fixtures, without any runtime compatibility branch; confirm whether this limited migration fill is acceptable under the no-backfill requirement.
- Next step: reclaim Task 15 after the user confirms these five decisions, then implement leaf-to-root and run focused restart tests plus npm run gatekeep.

[[2026-08-24]] Mon 23:38
Implementation started after explicit authorization to discard current SQLite data and flatten migrations. Fresh baseline/schema and LLM settlement CAS are complete; deep-search persistence, idea recovery, and debate recovery are in progress in non-overlapping slices. Remaining API/startup/fallback recommendations still await explicit confirmation before those behavior choices are finalized.

[[2026-08-25]] Tue 00:31
Implementation progress: fresh baseline migration and schema checkpoints verified; LLM settlement CAS, checkpoint-aware deep search, recursive idea/debate recovery, effective-root startup reconciliation, and root-only Resume API are implemented. API typecheck and the full API suite pass (75 files, 604 tests). Frontend reconnect controls and the remaining real-process crash matrix are in progress.

[[2026-08-25]] Tue 01:03
## Implementation handoff
- Replaced startup terminalization with fail-fast effective-root reconciliation after manager construction and before HTTP listen. Only non-completed debates, standalone idea roots, and standalone deep-search roots are scheduled; parents recursively resume descendants.
- Added SQLite-derived checkpoint reconciliation across deep search, idea, and debate. Completed stages and children are reused; incomplete exact attempts are retried through atomic owning-link replacement; application credit settlement remains status-guarded and exactly once. Persisted required idea limits, strict child-search quality, and bounded extracted page content.
- Added root-only Resume APIs with owner/descendant/completed status handling, same-process live deduplication, Stop-to-immediate-Resume handoff, durable replay seeding, canResume projections, and Resume/reconnect UI for all three root pages.
- Flattened Drizzle history into one fresh baseline and removed the repository SQLite database files under explicit authorization. No legacy-data compatibility or backfill path remains.
- Added file-backed real-process SIGKILL tests with deterministic providers and IPC barriers for registration, provider-return, settlement, coordinator/event, child fan-out, verdict, and website-write crash boundaries. Resumed deep-search, idea, and debate snapshots are compared with uninterrupted controls cloned from equivalent durable prefixes.
- Updated scoped runtime, database, deep-search, idea, debate, and streaming documentation. Final review also corrected stale irreversible-Stop UI/schema wording and narrowed the optional-review fallback documentation to registered attempts.

Validation:
- npm run gatekeep: passed lint, TypeScript, knip, 75 API files / 610 tests, and 51 web files / 298 tests.
- Focused restart/recovery: 2 files / 7 tests passed; restart matrix itself 5/5.
- Focused Stop-to-Resume managers: 3 files / 23 tests passed.
- Resume/Stop UI tests and production Storybook build passed; rendered available/pending Resume states were visually inspected.
- git diff --check passed; no repository data.db, WAL, or SHM file remains.
- Independent whole-change and remediation re-review: no remaining findings.

Remaining limitations:
- Supported execution model remains one API process; there are no multi-instance leases or fencing.
- A provider request can repeat if upstream accepted it before SQLite committed and offers no idempotency lookup; RethinkLoop application credits still settle once.
- The discarded local database is not recoverable without an external backup, and old migration histories are intentionally unsupported.
- Storybook emits its existing bundle-size/eval warnings and tests emit the existing Node localStorage experimental warning; neither fails validation.
- No commit was created. Unrelated kanban/config/task changes were preserved.

[[2026-08-25]] Tue 01:46
## Live-provider end-to-end validation
- Ran the complete idea workflow through the real browser UI with DeepSeek deepseek-v4-flash, local SearXNG web search, and ScrapingAnt extraction against an isolated fresh SQLite database.
- Submitted: We are trying to find business opportunities in old, boring businesses where software could be used, particularly AI.
- Terminated the API mid-research without using Stop, restarted it on the same database, and verified automatic recovery reused the same idea root and child IDs and completed the persisted workflow.
- Final durable state: one completed idea job; 10/10 completed deep-search children; 8/8 selected, refined, and evaluated ideas; 36 completed search queries; 988 search results; 79 completed and 24 isolated failed page extractions; 212 completed LLM generations; no running rows; SQLite integrity and foreign-key checks clean.
- Live testing found DeepSeek could return more than the schema maximum of 12 analysis facts because its JSON-schema response format is compatibility-mode advisory. Added explicit 12-item and 12-source bounds to analyze-research-answer.md plus a regression test. A UI Resume retried only that unfinished analysis stage, performed no duplicate search or extraction work, and succeeded.
- Final list and detail pages rendered all results, supporting research, pros, cons, and critique with no browser console errors and no remaining Stop or Resume action.
- Post-fix npm run gatekeep passed: lint, typecheck, knip, 75 API files / 611 tests, and 51 web files / 298 tests.
