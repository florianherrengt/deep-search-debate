---
id: 25
title: Allow users to use their own OpenAI Codex subscription
status: todo
priority: medium
created: 2026-08-25T14:16:35.14541+01:00
updated: 2026-08-25T14:34:49.76939+01:00
started: 2026-08-25T14:32:31.054817+01:00
class: standard
---

Users should be able to authenticate with (or bring) their own OpenAI Codex subscription to pay for LLM usage, instead of (or in addition to) RethinkLoop billing. Related: #7 Stripe payments, #23 budget per run.

## Repository context (investigated 2026-08-25)

### What the ticket asks
Let signed-in users supply their own OpenAI Codex subscription as the LLM credential/payment path, replacing or supplementing RethinkLoop credit billing for LLM usage. The mechanism is not specified beyond that sentence; every product decision is still open (see Open questions).

### Decisions (user-confirmed 2026-08-25)
- When a user connects their own account, RethinkLoop product credits are NOT used for their LLM usage: user-provider LLM calls are not debited and need no product pricing function for user-selected models. This covers LLM usage (ticket scope); whether web search and extraction keep their existing credit charges is still open (question 2).

### Current behaviour (evidence)
- **One global, env-configured LLM provider.** `LLM_PROVIDER` in {`deepseek`, `zen`} is validated at import time in `src/api/config.ts` (`nonSecretEnvironmentShape` + the `superRefine` rules starting at config.ts:350). `LLM_MODEL_NAME` is required. `deepseek` requires `DEEPSEEK_API_KEY` and the model must be `deepseek-v4-flash` or `deepseek-v4-pro` (config.ts:430-451); `zen` requires `OPENCODE_ZEN_API_KEY` and is rejected outside `NODE_ENV=development` (config.ts:452-461). All secrets are environment-only; there is no user-supplied configuration anywhere.
- **Provider singleton.** `createConfiguredLlm(llmConfig)` in `src/api/llms/provider.ts` maps provider to an AI SDK transport: `deepseek` -> `createDeepSeek` (`@ai-sdk/deepseek`), `zen` -> `createOpenAICompatible` (`@ai-sdk/openai-compatible`, baseURL `https://opencode.ai/zen/v1`). The exported singleton `llm = createConfiguredLlm(config.llm)` (provider.ts:70) is used by every generation call. `LlmConfig` union type: config.ts:574.
- **Every LLM call goes through `src/api/llms/generateText.ts`**: `generateTextStream`, `generateArrayStream`, `generateObjectStream`, `generatePromptTitle`. Common flow: admission `requirePositiveCreditBalance(userId)` -> `prepareTextGeneration` (durable `llm_generations` row) -> `streamText({ model: llm.model(...) })` -> terminal transaction debits credits (`debitCredits`) and persists the outcome. The `model?: string` param exists but is documented as "Internal override only: RethinkLoop selects every model and must keep it aligned with the configured pricing function before use" (generateText.ts:29-32).
- **Costing is model-ID-keyed and global.** `calculateLlmCredits(config.llm, modelId, usage)` in `src/api/llms/costs/index.ts`: `zen` -> flat 1 credit per successful generation; `deepseek-v4-flash` / `deepseek-v4-pro` -> micro-USD pricing functions in `src/api/llms/costs/deepseekV4Flash.ts` converted via `MICRO_USD_PER_CREDIT = 1_000` (`src/api/credits.ts:7`); any other modelId -> throws "No credit pricing function exists". Any user-selectable model needs a defined cost path or an explicit decision to bypass product credits (the latter is now decided for user-provider runs).
- **Credit model.** `user.credits` defaults to 500 (`src/api/db/schema/auth.ts:14`). Admission without reservation (`requirePositiveCreditBalance`, credits.ts:50), settlement only after success (`debitCredits` inside the generation terminal transaction, `src/api/llms/streams.ts:438`), negative balances allowed, failed/interrupted calls never charged (streams.ts:346-350). `OutOfCreditsError` -> HTTP 402 (`src/api/index.ts:45`). Web search (Serper/SearXNG; fixed `WEB_SEARCH_CREDITS_COST`, `src/api/web_search/index.ts:14`) and ScrapingAnt extraction (`calculateScrapingAntCredits`, credits.ts:101) are charged separately from LLM calls; a user-supplied LLM provider would not cover those.
- **Auth.** Better Auth with GitHub OAuth only (`src/api/auth.ts`); sessions and OAuth accounts in SQLite (`user`, `session`, `account` tables). Routes use `requireSession` (sets `userId`) or `loadOptionalSession` (`viewerUserId`); `requireTrustedOrigin` (CSRF) runs before session work. Admin = GitHub email matching `AUTH_ADMIN_EMAIL` or `user.is_admin` (`hasAdminAccess`, credits.ts:21). No per-user provider/preference columns exist.
- **No OpenAI/Codex code exists.** `@ai-sdk/openai` is NOT installed; api workspace deps are `@ai-sdk/deepseek`, `@ai-sdk/openai-compatible`, `@ai-sdk/provider-utils`, `ai` v7 (`src/api/package.json`). The `.codex/` directory at repo root is only a Codex-CLI dev-tool config (Playwright MCP), not application code.
- **Standalone streams** (`POST /api/streams`, `src/api/routes/streams.ts`) and title generation (`generatePromptTitle`) use the same global provider; dev-only provider-debug routes exist in `src/api/routes/debug.ts` behind debug auth.

### Relevant files and symbols
- `src/api/config.ts` — `LlmConfig`, `resolveLlmConfig`, `nonSecretEnvironmentShape`, `secretSchemas`, `config.llm`, `config.llmExecution`.
- `src/api/llms/provider.ts` — `createConfiguredLlm`, `llm`, `LlmCallReasoning`, `supportsStructuredOutputs`.
- `src/api/llms/generateText.ts` — `generateTextStream`, `generateArrayStream`, `generateObjectStream`, `generatePromptTitle`, `boundedOutputTokens`, `streamTimeout`, `llmGenerationQueue` (process-wide PQueue), `loadStructuredPrompt` (JSON-schema injection when `supportsStructuredOutputs === false`).
- `src/api/llms/streams.ts` — `prepareTextGeneration`, `registerTextStream`, `consume` (terminal tx + `debitCredits`), `TextGenerationPersistenceCallbacks`, `LlmGenerationOwner`.
- `src/api/llms/costs/index.ts`, `src/api/llms/costs/deepseekV4Flash.ts` — `calculateLlmCredits`.
- `src/api/credits.ts` — `requirePositiveCreditBalance`, `debitCredits`, `chargeUserCredits`, `addUserCredits`, `getCreditAccount`, `hasAdminAccess`, `MICRO_USD_PER_CREDIT`, `calculateScrapingAntCredits`.
- `src/api/routes/credits.ts` — `GET /api/credits`, admin grant `POST /api/admin/users/:userId/credits`; web client mirror in `src/web/lib/credits.ts`.
- `src/api/db/schema/auth.ts` — `user` (credits, isAdmin), `session`, `account`; `src/api/db/schema/llmGenerations.ts` — durable per-generation record (modelId, promptName, creditsUsed, token counts, status).
- `src/api/routes/researchCapacity.ts` — rolling-window creation quotas and active-job limits (rate limiting, not budget reservation; related #23).
- `src/api/index.ts` — route mounting, `handleRequestError` (402 mapping); `src/api/auth.ts`; `src/api/routes/auth.ts`; `src/api/routes/streams.ts`; `src/api/routes/debug.ts`.
- Web: `src/web/App.tsx` (credit chip at ~line 216, account menu, routes incl. `/admin/credits`), `src/web/components/auth/AuthGate.tsx` (GitHub sign-in), `src/web/lib/api.ts` (`getJson`/`postJson` + Zod at network boundary), `src/web/lib/authClient.ts`, `src/web/lib/credits.ts`, `src/web/pages/AdminCredits/`.
- Docs to read before implementing: `src/api/docs/runtime.md`, `src/api/docs/standards.md`, `src/api/docs/testing.md`, `src/api/db/docs/database.md`, `src/api/routes/docs/text-streaming.md`, `src/web/docs/standards.md`, `src/api/gatekeep.md`, `src/web/gatekeep.md`. Pre-PR gate: `npm run gatekeep` (lint -> typecheck -> knip -> test).

### Conventions an implementation agent must follow
- Zod at trust boundaries via `zValidator`; route modules export `function xxx(app: Hono<AppEnv>)` mounted in `src/api/index.ts` under `/api`; no build step (imports keep `.ts` extensions); no cross-workspace imports (web mirrors contract types/Zod schemas by hand).
- New env vars must be added to the config schema with validation and production rules (see `secretSchemas` and the `superRefine` block).
- LLM execution policy is provider-agnostic except `supportsStructuredOutputs` (provider.ts:34/59), the model-id-keyed pricing functions, and `config.llmExecution` timeouts/retries/concurrency; `loadStructuredPrompt` injects JSON Schema text for providers without native `json_schema` (the Zen case).
- DB: better-sqlite3 + Drizzle migrations are the schema source of truth; the migration history is a deliberately replaced fresh baseline (runtime.md "Local database initialization"), so schema changes go through `npm run db:generate` + `db:migrate`.
- Frontend: TanStack Query owns server state; feature-first layout under `src/web/pages/`; new settings UI would follow the existing page pattern and route registration in `App.tsx`.

### Known constraints and edge cases
- Pricing functions throw for unknown model IDs; a new provider/model without a pricing path breaks every generation call (user-provider runs bypass product credits by decision, so they need no pricing function — but the shared `calculateLlmCredits` call site must not throw for user-selected models).
- The 402 client/UX path assumes credits are the only admission gate. User-provider LLM calls bypass credit charging (decided 2026-08-25); whether `requirePositiveCreditBalance` still gates those runs is open — if it does not, the economic abuse gate disappears for them and only creation/rate quotas remain.
- The `llm_generations` row stores `modelId` and `creditsUsed`; contract/replay consumers (e.g. `src/api/routes/runCredits.ts`) sum credits from these rows.
- Session/CSRF middleware order in `src/api/index.ts`: auth -> trusted origin -> optional session -> reads -> required session -> mutations.
- Only deepseek is allowed in production today; zen is a dev-only fallback that still charges 1 product credit per generation.

### Open questions (resolve before design/implementation)
1. Mechanism: what is the actual way a third-party app can use a user's OpenAI Codex subscription? There is no public API that bills arbitrary LLM usage to a ChatGPT/Codex subscription; candidate mechanisms (user-supplied OpenAI API key, Codex CLI `auth.json` refresh-token flow, OAuth) differ hugely in feasibility, ToS risk, and credential lifetime. This external feasibility must be researched first.
2. Scope and admission: does the user provider replace only LLM generation, or also web search and extraction (do those keep charging credits)? Does `requirePositiveCreditBalance` still gate user-provider runs — can a 0-credit user with a connected account run?
3. Cost accounting: RESOLVED (2026-08-25) — user-provider runs do not debit product credits. Remaining: how is abuse prevented when credits no longer gate user-provider calls (creation/rate quotas and process-wide concurrency still apply; is anything else needed)?
4. Credential storage: where are user credentials stored (new DB columns? encrypted at rest — no secret-storage mechanism exists today), and how are they scoped, revoked, rotated, and surfaced in the UI?
5. Models: which OpenAI models can the subscription access, and how do `supportsStructuredOutputs`, reasoning policy, and token/usage accounting apply per model (usage is still persisted on `llm_generations`)?
6. UI surface: there is no settings page today; where does the connect flow live (account-menu item -> new page or dialog)?
7. Interaction with #7 (Stripe) and #23 (per-run budgets): per-run credit budgets do not apply to user-provider runs (no credits used) — confirm; do upstream-cost guardrails (e.g. `LLM_MAX_OUTPUT_TOKENS`, timeouts) suffice?
8. Upstream rate limits (ChatGPT/Codex plans throttle requests) and error surfacing; does retry/timeout policy change per provider?
9. Precedence: `config.llm` is resolved at import time from env; a per-user override needs a resolution layer (which wins, and what happens when the user credential is absent/expired/invalid — fallback to server provider or block?).
