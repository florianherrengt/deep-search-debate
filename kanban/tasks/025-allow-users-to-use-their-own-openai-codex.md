---
id: 25
title: Allow users to use their own OpenAI Codex subscription
status: review
priority: medium
created: 2026-08-25T14:16:35.14541+01:00
updated: 2026-09-02T16:21:19.32675+01:00
started: 2026-08-25T14:32:31.054817+01:00
blocked: true
block_reason: 'Waiting on user: click Connect OpenAI and complete the real ChatGPT sign-in in the open browser, then report completion.'
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

[[2026-08-25]] Tue 20:39
## Handoff — feasibility and auth investigation complete

- User confirmed full authentication workflow is in scope and connected-account LLM calls do not consume RethinkLoop credits.
- Official Codex app-server supports managed ChatGPT authentication; device-code is the viable remote-web flow, but it is beta and may be disabled by a user or workspace admin.
- Recommend ai-sdk-provider-codex-cli 2.1.2 for AI SDK generation only. It is compatible with this repo but does not publicly expose managed account login/read/logout, so a small typed stdio auth client is still required.
- Recommend per-user provider process and persistent CODEX_HOME, with account/read authoritative and pending login state in memory; no DB migration is necessary.
- Security blocker: the provider inherits the full API environment, and same-UID Codex children can read sibling homes/app data. A scrubbed environment plus verified current Codex minimal-permission profile or stronger outer isolation is required.
- Runtime impact: add exact provider and exact official Codex dependencies, roughly 300–350 MB image growth, final-image CLI/protocol smoke tests, lifecycle cleanup, and persistence/isolation tests.
- Generation seam: resolve provider by userId in generateText.ts; keep streams.ts persistence and server-funded DeepSeek pricing intact; connected Codex calls persist usage with zero product credits.
- Product decisions requested from user: accept public/community-package risk; at-rest credential policy; isolation level; external search/extraction credits and zero-balance admission; fallback behavior; model/output-limit policy; signout/disconnect behavior and active jobs; Settings account details; dependency approval.

[[2026-08-25]] Tue 22:56
## Additional user-confirmed decisions

- Store OpenAI Codex credentials encrypted in the application database. Hydrate a private temporary CODEX_HOME only while Codex is active, persist any rotated credential state back to encrypted storage before cleanup, then delete the temporary directory.
- Lock Codex down as far as the runtime permits. Environment scrubbing, minimal filesystem permissions, disabled unnecessary tools and tool network access, fail-closed approvals, process limits, and negative isolation tests are release requirements.
- If a saved OpenAI connection is expired, broken, or rate-limited, return an actionable error; do not silently fall back to DeepSeek. DeepSeek is selected only when no OpenAI connection is configured.
- Adding exact pinned ai-sdk-provider-codex-cli and OpenAI Codex dependencies is approved.

Still awaiting decisions on device-code authentication UX, whether existing search and extraction credit charges remain, and the Codex output-limit policy.

[[2026-08-25]] Tue 23:00
## Further user-confirmed decisions

- OpenAI-connected calls continue charging the existing RethinkLoop credits for web search and extraction; only the LLM generation portion is zero-credit.
- Do not add a Codex-specific output-size or token cap. Preserve the existing request timeout and abort behavior, accepting that the community provider ignores maxOutputTokens.

The only remaining product confirmation is whether to use the recommended ChatGPT device-code connection flow.

[[2026-08-25]] Tue 23:01
## Confirmed implementation specification

This section supersedes the earlier open questions.

### Authentication and credential lifecycle
- Use the official ChatGPT managed device-code flow. The authenticated connection UI presents the verification URL and one-time code and supports pending, connected, failure, cancel, and disconnect states.
- Store Codex credentials encrypted in the application database with a server-held encryption key.
- Hydrate credentials into a private temporary CODEX_HOME only while Codex is active. If Codex rotates credentials, persist the updated encrypted value before deleting the temporary directory.

### Provider selection and billing
- Resolve the provider at the start of every LLM call.
- If no OpenAI connection is configured, use DeepSeek and normal RethinkLoop LLM credits.
- If a valid OpenAI connection exists, use Codex and record zero RethinkLoop credits for the LLM generation.
- Existing web-search and extraction charges remain unchanged; the OpenAI subscription covers only LLM generation.
- A configured connection that is expired, broken, or rate-limited returns an actionable error. Do not silently fall back to DeepSeek or charge product LLM credits.

### Runtime and security
- Use exact pinned ai-sdk-provider-codex-cli and OpenAI Codex dependencies; adding both is approved.
- Use app-server over local stdio. Do not expose an app-server network listener.
- Scrub the child environment, isolate HOME, CODEX_HOME, temporary files, and working directory, apply the narrowest verified filesystem and tool permissions, disable unnecessary tools and tool network access, fail approvals closed, and enforce process lifecycle limits.
- Isolation tests that attempt to access application secrets, source, database files, or another users credentials must fail before release.
- Do not add a Codex-specific token or output-size cap. Preserve existing request timeouts and cancellation behavior, accepting that the community adapter ignores maxOutputTokens.

### Validation
- Add deterministic fake app-server tests for authentication and generation, cross-user isolation tests, credential encryption and refresh tests, routing and billing tests, frontend connection-flow tests, and final-container Codex binary and protocol smoke tests.

[[2026-08-25]] Tue 23:37
Approved implementation defaults (2026-08-25):
- Put the authenticated OpenAI connection workflow on a private `/settings` page linked from the account menu.
- Use the connected account’s default Codex model. Map the existing reasoning toggle to the highest advertised reasoning effort when enabled and the lowest advertised effort when disabled.
- Use exact `@openai/codex@0.149.1` through an npm override despite `ai-sdk-provider-codex-cli@2.1.2` declaring a `0.144.x` range; explicit path selection and real protocol smoke tests are required.
- Disconnect affects new calls immediately. An already-active Codex call may finish, but credential refresh uses compare-and-swap and cannot recreate a deleted or replaced connection.
- Use the specified single server-held encryption key for this ticket; keyring rotation and privacy-policy wording are outside this implementation unless separately requested.

[[2026-08-26]] Wed 01:40
## Handoff — implementation ready for live-account review

- Feature worktree: `/Users/florian/projects/deep-search-debate/.worktrees/codex-ticket-25-openai-subscription`; branch: `codex/ticket-25-openai-subscription`. Feature code remains uncommitted for user review.
- Added ChatGPT device-code authentication, AES-256-GCM encrypted per-user credentials in SQLite, private ephemeral Codex homes, and a `/settings` connection workflow.
- Every LLM call now checks for a saved OpenAI connection: Codex uses the account default model and records zero LLM credits; absent connection uses DeepSeek and normal billing; saved-connection failures return actionable errors without fallback. Search and extraction charges remain unchanged.
- Production Codex execution is constrained by the pinned hardened launcher, scrubbed environment, disabled tools, filesystem/syscall limits, authoritative process reaping, and fail-closed credential-home deletion. Pending device login capacity is fixed at one per API replica and separate from generation capacity.
- Dependencies are pinned to `ai-sdk-provider-codex-cli@2.1.2` and deduped `@openai/codex@0.149.1`.
- Verified: `npm run gatekeep` (83 API files / 686 tests; 53 web files / 337 tests), focused browser E2E for auth/text/structured output/zero credits/disconnect/fallback, negative container isolation and real Codex initialize/model-list smoke tests, independent security re-review, `git diff --check`, and one deduped Codex dependency.
- Remaining live check: user will authenticate a real ChatGPT account, then run one minimal model call and verify zero RethinkLoop LLM credits before disconnecting the test account. Container smoke testing covered arm64; x86_64 remains untested.
- One focused E2E invocation intermittently returned 404 on its first persisted-stream read; the unchanged test then passed four consecutive reruns and the final run. No reproducible application fault was found.

[[2026-08-26]] Wed 12:43
## Handoff — review findings fixed
- Worktree: /Users/florian/projects/deep-search-debate/.worktrees/codex-ticket-25-openai-subscription
- Branch: codex/ticket-25-openai-subscription; feature code remains uncommitted.
- Fixed: fail-closed credential-home rollback and teardown; abortable same-user reservation before global LLM admission; raw Codex interrupted/unknown finishes fail closed; stable actionable Codex codes survive durable completion; device-login expiry reports timeout while explicit cancel remains disconnected.
- Verified: npm run gatekeep (83 API files / 694 tests; 53 web files / 337 tests), focused 7 files / 91 tests, Playwright OpenAI auth/text/structured/zero-credit/disconnect/fallback flow, git diff --check, and three independent PASS reviews.

[[2026-08-27]] Thu 00:18
## Handoff — DeepSeek error redaction fixed
- Worktree: /Users/florian/projects/deep-search-debate/.worktrees/codex-ticket-25-openai-subscription
- Branch: codex/ticket-25-openai-subscription; feature code remains uncommitted.
- Fixed: emitted and thrown server-provider errors, including synchronous stream startup failures, are replaced with Text generation failed before live publication, durable persistence, owning-stage propagation, or replay. Codex actionable errors and untagged internal diagnostics remain unchanged.
- Regression coverage: llm_generations row, completion outcome, failure hook, replay, persisted debate snapshot, and browser UI all reject the injected raw DeepSeek payload.
- Verified: npm run gatekeep (83 API files / 696 tests; 53 web files / 337 tests), focused 3 files / 54 tests, headed Playwright DeepSeek retry-exhaustion workflow, git diff --check, and independent verifier PASS.
- Remaining live check: user will connect a real ChatGPT account and run the previously planned minimal zero-LLM-credit generation test.

[[2026-08-27]] Thu 00:52
## Handoff — entire OpenAI subscription implementation simplified

- Simplified provider resolution, generation cleanup, stream error capture, Codex finish classification, process-slot acquisition, pending-login state, auth response parsing, credential file reads, Coolify configuration lookup, and test-only production surface.
- Removed unused connection timestamps/indexes and redundant plaintext credential copies while preserving explicit AES-GCM fields, authenticated identity, credential zeroing, revision/CAS, disconnect/startup race protection, and all containment controls.
- Preserved product behavior: use Codex for every LLM call when connected; use DeepSeek only with no saved connection; connected failures do not fall back; Codex LLM usage records zero product credits; search/extraction charges remain unchanged.
- Verification: npm run gatekeep passed (83 API files / 699 tests; 53 web files / 337 tests); headed subscription and DeepSeek-redaction browser workflows passed; Docker isolation probe and real Codex launcher smoke passed; exact pinned Codex dependency is deduplicated; independent verifier PASS; git diff --check passed.
- Feature worktree: /Users/florian/projects/deep-search-debate/.worktrees/codex-ticket-25-openai-subscription. Branch codex/ticket-25-openai-subscription remains uncommitted for review. Remaining live check: connect the user’s real ChatGPT account and run one minimal zero-LLM-credit generation before disconnecting.

[[2026-08-29]] Sat 18:17
## Handoff — cohesion review and final gatekeep findings fixed

- Added a durable root gatekeep check for cohesive file ownership and updated AGENTS.md to require one dedicated subagent per applicable gatekeep.md checklist during final review.
- Split the OpenAI subscription implementation by responsibility: Codex session policy/home/process, native launcher/session/Landlock/seccomp/probe, Settings orchestration/status rendering, fake app-server auth/generation, and generation text/title/structured test suites. Longer lifecycle and transaction files remain intact where splitting would scatter invariants.
- Fixed review findings: synchronous Codex startup/release errors are sanitized before completion/SQLite/replay; FatalCodexContainmentError remains fail-closed through startup, outer cleanup, and stream exhaustion; SQLite now rejects blank connection IDs plus fractional, negative, and unsafe revisions.
- Verified exact final diff: npm run gatekeep passed (85 API files / 705 tests; 53 web files / 337 tests); headed OpenAI connection E2E passed; Docker codex-isolation-test target passed strict native compilation, negative isolation, and real launcher smoke; exact @openai/codex@0.149.1 is deduped under ai-sdk-provider-codex-cli@2.1.2; root/API/schema/web checklist reviewers all PASS; tracked and ticket-untracked whitespace checks passed.
- Feature worktree: /Users/florian/projects/deep-search-debate/.worktrees/codex-ticket-25-openai-subscription. Branch codex/ticket-25-openai-subscription remains uncommitted for user review. Unrelated user-owned .agents/skills artifacts were preserved and excluded.
- Remaining live check: user will connect a real ChatGPT account, run a minimal Codex generation, verify zero RethinkLoop LLM credits, then disconnect.

[[2026-08-29]] Sat 18:37
## Handoff — unnecessary credential versions removed

- Removed the persisted credential revision from the OpenAI connection schema, AES-GCM AAD, repository snapshot/update logic, tests, documentation, SQL migration, Drizzle snapshot, and DBML.
- Replaced revision-based refresh with a conditional update on user_id + connection_id. Regression tests prove stale work cannot overwrite a replacement or recreate a deleted connection.
- Removed the speculative .v1 credential-format marker while retaining a stable unversioned AES-GCM AAD domain bound to user and connection identity.
- Preserved the dedicated optional one-to-one table because it keeps the encrypted credential bundle atomic and isolated from Better Auth generic user/account reads. Preserved connectionId and the in-memory login/disconnect race fence because both have reachable correctness roles.
- Regenerated the unreleased 0001 migration, snapshot, journal, and DBML in place. Drizzle reports exactly five connection columns and no schema drift. Fresh and retained 0000 -> 0001 paths pass.
- Verified: npm run gatekeep passed (85 API files / 706 tests; 53 web files / 337 tests); focused schema/encryption/repository/generation/login tests passed; headed OpenAI browser workflow passed; git diff --check passed; root/API/schema/web checklist reviewers all PASS.
- Worktree: /Users/florian/projects/deep-search-debate/.worktrees/codex-ticket-25-openai-subscription; branch codex/ticket-25-openai-subscription remains uncommitted for user review. Unrelated user-owned .agents/skills files remain untouched.
- Remaining live check: user will connect a real ChatGPT account, run a minimal Codex generation, verify zero RethinkLoop LLM credits, then disconnect.

[[2026-09-02]] Wed 16:21
## Live validation handoff
- Current state: API and web app are running; the in-app browser is open on the private Settings page using the local debug account.
- Worktree and branch: /Users/florian/projects/deep-search-debate/.worktrees/codex-ticket-25-openai-subscription on codex/ticket-25-openai-subscription.
- Verified: http://127.0.0.1:3002/api/health and http://127.0.0.1:5175/settings both returned 200; Settings shows OpenAI as not connected.
- Next step: user clicks Connect OpenAI and completes the real ChatGPT device-code sign-in; then run one minimal generation, verify zero LLM-credit debit, and disconnect.
