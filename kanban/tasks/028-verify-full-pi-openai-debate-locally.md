---
id: 28
title: Verify full Pi OpenAI debate locally
status: in-progress
priority: high
created: 2026-09-07T11:53:56.976753+01:00
updated: 2026-09-07T16:41:55.370594+01:00
tags:
    - bug
claimed_by: salmine-vinegar
claimed_at: 2026-09-07T16:41:55.37073+01:00
class: standard
---

User reports apparent hanging and asks for local proof before another deployment. Production remained active at first inspection (68 completed model calls;5 of7 child searches completed). Confirmed test gap: full debate E2E uses DeepSeek; OpenAI E2E stops after title/query planning. Extend existing protocol-compatible OpenAI test harness to exercise full debate and verify terminal persistence/reload locally, then run actual local OpenAI debate after fresh user sign-in. Preserve exact Small Luna medium and Big Sol xhigh choices, existing runtime controls, production database and deployment until local proof. Investigate before fixing; no speculative UX or concurrency changes. Continue in existing ec74e0a worktree to match deployed code.

[[2026-09-07]] Mon 12:12
Local full-stack OpenAI E2E added and committed as c5e898d on codex/ticket-27-pi-url-schema. Reuses existing deterministic fixture content through real Pi transport; validates exact Luna medium/Sol xhigh roles, research analysis, final evaluations, all23matches, winner HTML, streamed transcript/reload, durable zero-credit generations. Full1065 gate checks passed twice. Three adjacent E2Es passed; after review cleanup fix, final OpenAI file2/2 passed. Deliberate live-match assertion failure verified cancellation of only test-owned debate, zero active generations, safe disconnect, and successful retry. Root/API/web checklist reviews clean. User completed fresh local OAuth; real six-candidate cafe debate5ccadbb4-ff35-4d84-9aa7-1e3590c417f5 started on local3005/5178 using explicit Luna medium/Sol xhigh. Local search returned30real results; current real run in first research synthesis, not yet terminal. Production was not deadlocked: all7research jobs and assessments completed and tournament started without any intervention. No production DB writes, deployment, Git push, or merge this turn. Local services and saved connection remain available.

[[2026-09-07]] Mon 12:18
Real local reproduction reached a distinct failure: Sol xhigh answer-research-request generation 69a6fd4b-9285-4b99-b23e-86abf1544472 was aborted at exactly 300001 ms, retaining 2507 answer characters and 2441 reasoning characters. Local debate 5ccadbb4-ff35-4d84-9aa7-1e3590c417f5 and its child settled failed with the timeout message; eight earlier job-owned generations completed. Browser reload shows Debate failed with Resume workflow, so successful checkpoints remain reusable. No timeout-policy implementation has begun: user choice requested between removing total deadline while retaining inactivity protection (recommended) and removing all application model-call timeouts. Full controlled OpenAI debate coverage is committed as c5e898d; final 1065-test gate passed after cleanup fix, final OpenAI E2Es 2/2 passed, earlier adjacent DeepSeek full debate passed, and root/API/web reviews are clean. Worktree is clean, local services remain on 3005/5178 with user-connected OpenAI and explicit Luna medium/Sol xhigh. Production remains untouched and progressed to second Swiss round (3 completed of 18 eventual matches); no new deployment, merge, or push. Continue locally from the saved failed run after the policy decision.

[[2026-09-07]] Mon 16:28
User approved no total model-generation time limit and 10-minute inactivity protection for initial and subsequent text or reasoning activity. Manual Stop and validation remain. User additionally requests small models and low-cost testing: use the existing Small choice, OpenAI Luna medium, for both roles only in the live local test account; production choices remain unchanged. Resume the saved local debate after verification, then commit and deploy under standing authorization.

Local timeout change committed as 0042584 after 79 focused regressions went from 12 expected failures to green, full gate passed (724 API and 346 web tests), both OpenAI browser E2Es passed including all 23 matches and winner HTML, and dedicated root/API reviews found no issues. No total application deadline; first/inter-content inactivity defaults both 600000 ms, Stop and validation preserved. Saved real local debate resumed with OpenAI Luna medium for both roles; formerly failing research synthesis completed, all six candidates generated/refined, six supporting searches running. User now explicitly requests local-only work, so no image release or production deployment. Production settings and data untouched.
