---
id: 28
title: Verify full Pi OpenAI debate locally
status: in-progress
priority: high
created: 2026-09-07T11:53:56.976753+01:00
updated: 2026-09-07T11:53:56.976753+01:00
tags:
    - bug
claimed_by: salmine-vinegar
claimed_at: 2026-09-07T11:53:56.976753+01:00
class: standard
---

User reports apparent hanging and asks for local proof before another deployment. Production remained active at first inspection (68 completed model calls;5 of7 child searches completed). Confirmed test gap: full debate E2E uses DeepSeek; OpenAI E2E stops after title/query planning. Extend existing protocol-compatible OpenAI test harness to exercise full debate and verify terminal persistence/reload locally, then run actual local OpenAI debate after fresh user sign-in. Preserve exact Small Luna medium and Big Sol xhigh choices, existing runtime controls, production database and deployment until local proof. Investigate before fixing; no speculative UX or concurrency changes. Continue in existing ec74e0a worktree to match deployed code.
