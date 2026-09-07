---
id: 28
title: Verify full Pi OpenAI debate locally
status: in-progress
priority: high
created: 2026-09-07T11:53:56.976753+01:00
updated: 2026-09-07T12:12:56.241008+01:00
tags:
    - bug
claimed_by: salmine-vinegar
claimed_at: 2026-09-07T12:12:56.241128+01:00
class: standard
---

User reports apparent hanging and asks for local proof before another deployment. Production remained active at first inspection (68 completed model calls;5 of7 child searches completed). Confirmed test gap: full debate E2E uses DeepSeek; OpenAI E2E stops after title/query planning. Extend existing protocol-compatible OpenAI test harness to exercise full debate and verify terminal persistence/reload locally, then run actual local OpenAI debate after fresh user sign-in. Preserve exact Small Luna medium and Big Sol xhigh choices, existing runtime controls, production database and deployment until local proof. Investigate before fixing; no speculative UX or concurrency changes. Continue in existing ec74e0a worktree to match deployed code.

[[2026-09-07]] Mon 12:12
Local full-stack OpenAI E2E added and committed as c5e898d on codex/ticket-27-pi-url-schema. Reuses existing deterministic fixture content through real Pi transport; validates exact Luna medium/Sol xhigh roles, research analysis, final evaluations, all23matches, winner HTML, streamed transcript/reload, durable zero-credit generations. Full1065 gate checks passed twice. Three adjacent E2Es passed; after review cleanup fix, final OpenAI file2/2 passed. Deliberate live-match assertion failure verified cancellation of only test-owned debate, zero active generations, safe disconnect, and successful retry. Root/API/web checklist reviews clean. User completed fresh local OAuth; real six-candidate cafe debate5ccadbb4-ff35-4d84-9aa7-1e3590c417f5 started on local3005/5178 using explicit Luna medium/Sol xhigh. Local search returned30real results; current real run in first research synthesis, not yet terminal. Production was not deadlocked: all7research jobs and assessments completed and tournament started without any intervention. No production DB writes, deployment, Git push, or merge this turn. Local services and saved connection remain available.
