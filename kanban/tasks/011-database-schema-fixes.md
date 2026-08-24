---
id: 11
title: Database schema fixes
status: backlog
priority: high
created: 2026-08-24T01:34:07.363343+01:00
updated: 2026-08-24T01:56:40.955927+01:00
tags:
    - database
    - schema
class: standard
---

From the comprehensive multi-agent database schema review (2026-08-24). Schema is fundamentally sound — no redesign needed. Items below are ordered by risk.

## Critical

1. **No DB backup + silent fresh-DB boot.** No backup mechanism exists anywhere (no litestream/VACUUM INTO/cron/Dagger step; coolify/README.md:234-235 documents "Database resets after deploy" when the bind mount is missing). prestart migrations create an empty DB and the app boots healthy → one misconfigured redeploy loses all data. Add WAL-safe scheduled backups (VACUUM INTO or sqlite3 .backup — never copy data.db alone; the -wal holds recent commits), a tested restore runbook, and a production boot guard on empty/unmigrated DB.
2. **KeePass vaults committed to a PUBLIC repo.** src/api/secrets/dev.kdbx and prod.kdbx are git-tracked in the public GitHub repo (re-included via .gitignore:15-17). Offline brute-force → total prod compromise. git rm + history purge (git-filter-repo) + rotate every secret inside.

## Important

3. **Recovery can complete a debate whose winner-website FILE is missing.** Generation terminal tx commits before writeIdeaSite's file rename (ideas/ideaSites.ts:79-80); recovery's repair checks only the completed generation (db/recovery.ts:199-223) → debate marked completed, winner page 404s, no retry path. Fix: verify file existence in recovery/completion, or repair from durable generation output. (Note: recovery DOES check website generation status — only the file gap is real.)
4. **finish_reason has no SQL CHECK** (llmGenerations.ts:39 — TS enum only; violates schema/gatekeep.md:21). Value is load-bearing: 'other' authorizes debate-message regeneration (debates/persistence.ts:350-363). An AI SDK update adding a finish reason silently breaks the retry path. One-line CHECK.
5. **Parent links lack immutability triggers** their siblings have: idea_jobs.debate_job_id, deep_search_jobs.idea_job_id/idea_job_position are insert-only by convention only (database.md:177-181); precedent triggers exist at 0000_fresh-baseline.sql:536-570. Reparenting corrupts cascade semantics + position derivation.
6. **Slug Set-building full-table scan on every job creation** (deepSearch/manager.ts:108-115, ideas/manager.ts:69-76) — reads ALL users' slugs into JS; runs per child search so one idea job does N+M scans, synchronous on the event loop. Fix: indexed probes via existing unique slug index, or insert-conflict retry.
7. **drizzle-kit trigger-drop hazard + no TS↔DDL drift detection.** The 11 triggers exist only in hand-written migration SQL; drizzle-kit table-rebuild migrations (required for many SQLite ALTERs) silently DROP triggers on rebuilt tables. Also nothing fails if schema/*.ts is edited without db:generate. Document in schema gatekeep checklist; re-add triggers manually in any rebuild migration.
8. **App-only invariants worth house-style enforcement:** ideas.evaluation_generation_id not tied to selected=1 (docs claim rejected ideas retain no evaluation); debate_matches ideas can schema-wise come from another debate (app validates at debates/persistence.ts:221-248; precedent two-hop trigger at 0000:476-491).
9. **No credit-grant audit trail:** user.credits grants (credits.ts:80-98, default 500) leave no event row; balance not derivable. Add a credit-change ledger before billing matters.

## Housekeeping

- Delete dead relations.ts (db.query never used), dead attachFinalAnswerGeneration path (deepSearch/store.ts:927-948, unguarded), unused pending web-page status (store.ts:350-359 hardcodes extracting).
- Scope seo.ts resolvers in SQL (only load-then-check-in-JS pattern in the codebase).
- Partial indexes for capacity gates (llm_generations + 3 job tables WHERE status='running' AND owner IS NULL) — per-request counts currently walk user's whole history.
- Admissions window ORDER BY needs id tie-break (researchCapacity.ts:136).
- llm_generations_user_started_at_idx third column serves no query.
- Prompt-title standalone generations are billed to user.credits but excluded from all creditsUsed rollups (runCredits.ts:23-135) — displayed cost undercounts actual debit.
- Reasoning traces/raw provider errors replay anonymously for public debates — confirm this is an intended product decision.
- Fix AGENTS.md:31 stale "committed data.db" wording.
- Retention: zero production DELETEs; generations/pages/sessions/waitlist/admissions grow unbounded. Fine at current scale; decide policy before it hurts.

## Already well designed (keep)

Composite same-owner FKs; NO ACTION on generation-use links + CASCADE on ownership; terminal-state CHECKs fully defining each status; central llm_generations XOR-owned ledger; SQL-scoped authz at the root incl. live streams; uniform CAS state machine with charges settled in the same transaction; facts-not-projections (derived standings, stored randomSeed, linked final answers); verified-consistent migration chain.

[[2026-08-24]] Mon 01:56

## Second-pass review addendum (2026-08-24, independent 8-angle re-review)

### Critical (new)

A1. **Dev database silently diverged from the migration chain (verified directly).** src/api/data.db's __drizzle_migrations rows hash-match OLDER contents of 0002_modern_magus.sql and a since-deleted 0003; its debate_jobs.website_generation_id still carries the abandoned composite FK (website_generation_id, debate_job_id) -> llm_generations(llm_generation_id, debate_job_id), while schema/debateJobs.ts:64-68 + 0004_tricky_joshua_kane.sql define the single-column FK. Drizzle applies an entry only when max(created_at) < journal.when: DB max 1787431136069 > 0004.when 1787430866203, so 0004 is skipped forever with no warning. Invisible to tests (:memory:) and to CI-less local runs. Fix: delete and recreate src/api/data.db plus stale empty artifacts ./data.db and src/api/db/data.db. Process fix: gatekeep rule — once db:migrate has run against a database, treat those migration files as immutable (regenerate only by deleting the DB); commit journal+SQL+snapshots atomically.

### Important (new)

A2. Extends item 7: drizzle-kit's generated table-rebuild emits PRAGMA foreign_keys=OFF which is a NO-OP inside the migrator's wrapping transaction; and baselineMigration.test.ts:138-147 asserts the website FK shape-agnostically (single-column vs composite both pass) — the exact drift class that already occurred would not fail the test. Pin the exact {from, table, to} triple set.
A3. Runtime CHECK value lists hand-duplicate statuses.ts constants (e.g. schema/ideaJobs.ts:106-108) with no parity test: adding a constant compiles fine then dies on the CHECK at runtime. Derive lists from constants or add a parity test. Only finish_reason lacks any CHECK (matches item 4).
A4. Completed branch of idea_jobs' terminal CHECK omits selection_generation_id although selection is unconditional in the pipeline (schema/ideaJobs.ts:138) — a completed row lacking it represents no legal state.
A5. CAS-guard asymmetry among sibling writers: attachQuerySummaryGeneration (deepSearch/store.ts:623-651) and attachPageSummaryGeneration (store.ts:439-467) update by ID alone — a repeat call silently swaps the link and orphans the old generation; saveRoundReviewFailure (store.ts:899-925) lacks the reviewCompletedAt IS NULL predicate its siblings have and can legally rewrite a committed review into an error. Unreachable today; traps for future retries.
A6. Extends item 9: credits_used columns on llm_generations/deep_search_queries/deep_search_web_pages have no >= 0 CHECK — enforcement lives only in debitCredits (credits.ts:61-63) and the rule is absent from database.md's app-enforced boundaries list. Add three one-line CHECKs + doc entry.
A7. Admin identity race: AUTH_ADMIN_EMAIL grants admin (all users' emails + unlimited credit grants) to whichever GitHub account first registers that email (credits.ts:21-30). Seed is_admin=1 row instead, or operationally pre-claim and document.
A8. Waitlist: anonymous unthrottled PII writes, indefinite retention, no purge path (routes/waitlist.ts) — extends the Housekeeping retention line into a concrete decision.
A9. Secrets at rest beyond item 2: GitHub access/refresh tokens and session tokens sit plaintext in the SQLite file; no volume-permission/encryption posture documented in coolify/Dagger/database.md.
A10. Double-submit creates duplicate jobs (no idempotency key on POST routes): two admissions, two billable title calls, two quota slots per double-click. Bounded by quotas (cost waste, not corruption); client-side disable or admission idempotency closes it.
A11. research_job_admissions_user_kind_created_at_idx has no production consumer (kind filtered in JS at researchCapacity.ts:124-154) — pure write amplification; drop it or push the kind filter into SQL.
A12. Boot-recovery UPDATEs full-scan llm_generations (no status-leading index, db/recovery.ts:91-98) — same partial-index fix family (WHERE status='running') as the Housekeeping capacity item, applied to the startup path.
A13. Doc/drift nits: database.md:177-181 insert-only contract does not name idea_jobs.deep_search_count/number_of_ideas even though the selected-research join derives from them; db/recovery.ts hardcodes table names/status literals as raw SQL strings outside compiler checking and re-implements the effective-root walk that resolveEffectiveResearchRoot owns.

### Confirmed independently by second pass

Items 4, 6, 7, 8 (evaluation coupling), 9, AGENTS.md stale wording, partial-index capacity counts, unbounded growth all reproduced with the same evidence. One correction to the record: judge messages ARE persisted with speaker_slot = 2 (debates/persistence.ts:404), so the slot-2 partial unique index is live and tested, not dead weight.
