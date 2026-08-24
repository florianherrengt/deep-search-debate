---
id: 7
title: Add Stripe for payments
status: backlog
priority: medium
created: 2026-08-22T17:04:21.115294+01:00
updated: 2026-08-22T17:05:53.070861+01:00
tags:
    - payments
class: standard
---

## Context (gathered from repo, 2026-08-22)

### Current monetization
- No Stripe or payment code exists anywhere in the repo yet.
- Credits live on the user table: user.credits int, default 500 (src/api/db/schema/auth.ts).
- 1 credit = 0.001 USD; MICRO_USD_PER_CREDIT = 1_000 in src/api/credits.ts. LLM cost conversion in src/api/llms/costs/deepseekV4Flash.ts.
- Consumption flow: requirePositiveCreditBalance admission check before provider work, then debit settled usage (debitCredits / chargeUserCredits). Failed provider calls are not charged. Negative balances are allowed.
- Grants are admin-only today: POST /api/admin/users/:userId/credits (src/api/routes/credits.ts) with UI in src/web/pages/AdminCredits/AdminCredits.tsx. addUserCredits (src/api/credits.ts) is the natural hook for purchased top-ups.
- Credit balance is displayed in the app bar chip (src/web/App.tsx); turns red at 0 or below. Client API in src/web/lib/credits.ts.
- Waitlist (POST /api/waitlist) grants no credits.

### Integration points
- Config: Zod-validated env in src/api/config.ts; new STRIPE_* vars (secret key, webhook secret, price IDs, test/live mode) go there, with production rules like the AUTH_* vars.
- Backend: Hono routes mounted under /api; Better Auth sessions provide the signed-in user. Checkout creation requires auth; the Stripe webhook endpoint must be public (no session middleware) and verify STRIPE_WEBHOOK_SECRET signatures.
- DB: better-sqlite3 with Drizzle migrations (src/api/db). Likely additions: Stripe customer id, transaction record, idempotency key for webhook events.
- Deployment: Coolify (coolify/) with a public base URL (BETTER_AUTH_URL), so webhooks are reachable.
- Docs to read before implementing: src/api/docs/runtime.md, src/api/docs/standards.md, src/api/db/docs/database.md, src/api/docs/testing.md, src/web/docs/standards.md.

### Open product questions (decide before implementation)
- One-time credit packs vs subscriptions? (credit model suggests one-time top-ups)
- Pack sizes and prices; test vs live mode.
- Grant credits on webhook checkout.session.completed (idempotent) vs redirect return page?
- VAT / sales tax handling for EU customers.
- Where the buy UI lives (app bar chip dialog?) and whether admin grants remain as-is.
- Keep the 500-credit signup grant unchanged?
