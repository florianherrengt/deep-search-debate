---
id: 18
title: Expose RethinkLoop as an MCP server via stdio CLI
status: backlog
priority: medium
created: 2026-08-25T08:33:46.360225+01:00
updated: 2026-08-25T08:33:46.360225+01:00
tags:
    - feature
    - mcp
class: standard
---

## Goal

Let coding agents (opencode, Claude Code, Codex, Cursor) start a deep search or debate through RethinkLoop and retrieve the results, via MCP.

## Architecture

```
Coding agent
    │ stdio (MCP)
    ▼
rethinkloop CLI  (new src/cli workspace, the MCP server)
    │ HTTPS  Authorization: Bearer rtl_xxxxx
    ▼
RethinkLoop API (existing REST endpoints + new cli-auth routes)
```

- The CLI binary itself is the MCP server (stdio transport). No remote HTTP MCP endpoint for v1 — stdio is the most widely supported transport and the CLI stays a thin shim: all work stays in the deployed API.
- New npm workspace `src/cli` in this monorepo, published as `rethinkloop`.

## CLI surface

```
rethinkloop login         # browser authorize, store token in OS keychain
rethinkloop logout
rethinkloop status
rethinkloop mcp           # run stdio MCP server (default)
rethinkloop mcp install   # install/update CLI, login if needed, detect agents, add MCP config, verify
rethinkloop mcp uninstall
```

`mcp install` configures ~/.codex, ~/.claude, ~/.config/opencode, Cursor with:

```json
{ "mcpServers": { "rethinkloop": { "command": "rethinkloop", "args": ["mcp"] } } }
```

## Tools (v1 core loop)

- `start_deep_search` — researchRequest, optional maxSearches/maxResultsPerSearch/maxRounds → { deepSearchJobId, slug }
- `start_debate` — prompt, optional numberOfIdeas/isPublic → { debateJobId, slug }
- `get_result` — job id/slug + kind (deep-search | debate) → status + final output when terminal; debate returns winner + bounded transcript summary (full transcript stays available via existing REST/URLs)
- `cancel_job` — job id → request cancellation

Jobs run for minutes: fire-and-poll. start_* returns immediately; agent polls get_result until terminal. Reuses existing ownership, quotas, credits, and rate limits.

## Auth (decided)

- Dedicated per-installation API tokens backed by Better Auth API Key plugin (defaultPrefix rtl_, hashed at rest, revocable, metadata for device name, customAPIKeyGetter reads `Authorization: Bearer rtl_...`).
- Browser authorization flow, never collect credentials in the CLI:
  1. CLI POST /cli/auth/start → { code, verificationUrl }
  2. CLI opens rethinkloop.com/cli/authorize?code=...; existing Better Auth/GitHub login approves
  3. CLI polls /cli/auth/status → server returns the rtl_ token once
  4. CLI stores it in the OS keychain; every MCP call sends Authorization: Bearer
- Long-lived and revocable (no forced expiry), per-installation (e.g. "MacBook – Codex"), listed in account UI with last-used + revoke.
- Why not bearer sessions (option 2): browser session lifecycle (logout/expiry) would leak into the MCP installation. Why not GitHub device flow (option 3): couples CLI auth to the identity provider.

---

# Repository context (investigated 2026-08-25 — read before implementing)

Everything below is verified against the code unless marked otherwise. Scoped docs indexed in root `AGENTS.md` are mandatory reading for their areas: `src/api/routes/docs/deep-search-jobs.md`, `src/api/routes/docs/idea-jobs.md`, `src/api/docs/runtime.md`, `src/api/docs/standards.md`, `src/api/docs/testing.md`, `src/api/db/docs/database.md`.

## Existing API surface the MCP tools will wrap

All routes mount under `/api` (`const api = app.basePath("/api")`, src/api/index.ts:92). Middleware/mount order in src/api/index.ts matters:

- :94–97 `seoPages`, `ping`, `health`, `authRoutes(api)` — registered **before** middleware, so they bypass both middlewares below.
- :98 `api.use("*", requireTrustedOrigin)` (src/api/middleware/requireTrustedOrigin.ts)
- :99 `api.use("*", loadOptionalSession)` — sets `viewerUserId` (or null) via Better Auth `auth.api.getSession`
- :114–118 anonymous-capable **read** routes: `streamReads`, `deepSearchJobReads`, `ideaJobReads`, `debateJobReads`
- :119 `api.use("*", requireSession)` — everything after requires a session; handlers read the owner via `c.get("userId")`
- :120–125 mutation routes: `creditRoutes`, `debug` (dev only), `streams`, `deepSearchJobs`, `ideaJobs`, `debateJobs`

### Deep search (src/api/routes/deepSearch/index.ts)

- `POST /api/deep-search-jobs` (`deepSearchJobs()`) → manager.start (src/api/routes/deepSearch/manager.ts:215) → **202** `{ deepSearchJobId, slug }` with `Location: /api/deep-search-jobs/<slug>`.
- Input Zod schema `createDeepSearchJobInputSchema` (= `deepSearchExecutionInputSchema`, src/api/routes/deepSearch/resourceLimits.ts:82): `researchRequest` string 1..10k chars; `maxSearches` int 1..5 default 3; `maxResultsPerSearch` int 1..5 default 3; `maxRounds` int 1..2 default 2; aggregate budget refines vs `config.deepSearch.maxSelectedUrlsPerRound` (15) / `maxSelectedPagesPerRootJob` (200).
- Status/result: `GET /api/deep-search-jobs/:slug` (`deepSearchJobReads`, index.ts:90) returns `{ deepSearchJob: {...row, feedback, creditsUsed, stopRequested, canStop, canResume, ...} }`. **There is NO GET-by-UUID detail/status endpoint** — UUIDs address only `/events` and mutation routes. Detail JSON does NOT contain the answer text (see Retrieving results).
- History: `GET /api/deep-search-jobs?source=manual|automated&limit=` (owner-scoped).
- Cancel: `POST /api/deep-search-jobs/:deepSearchJobId/cancel` → 202 `{"status":"cancellation-requested", cancelRequestedAt}`; idempotent; children/debate-owned → 409 `not-root`; terminal → 409 `not-cancellable`; foreign → 404. Resume: `POST .../resume`.
- Events feed: `GET /api/deep-search-jobs/:deepSearchJobId/events` (NDJSON; live replay+follow, closes after one terminal suffix then `done`). Event union `DeepSearchJobEvent` in src/api/routes/deepSearch/schemas.ts:6.

### Debates (src/api/routes/debates/index.ts) — distinct from ideas

- `POST /api/debate-jobs` → **202** `{ debateJobId, slug }`, `Location: /api/debate-jobs/<slug>`. Input `createDebateJobInputSchema` (src/api/routes/debates/schemas.ts:13): extends idea-job schema with `numberOfIdeas` int 6..`config.debate.maxIdeaCount` (default 8), `deepSearchCount` max 1, `maxSearches` max 3 default 2, `maxResultsPerSearch` max 3 default 2, `maxRounds` max 1 default 1, `isPublic` boolean default false, plus `prompt`.
- **The returned `slug` is the owning idea job's slug** — `debate_jobs` has no title/slug columns; resolution joins `idea_jobs.slug` (index.ts:106–111). Same slug addresses `GET /api/idea-jobs/:slug` (pipeline detail) and `GET /api/debate-jobs/:slug` (tournament snapshot).
- Snapshot/result: `GET /api/debate-jobs/:slug` → `getDebateJobSnapshot()` (src/api/routes/debates/snapshot.ts:105) returning `stage`, `status`, `rounds[].matches[]` (each with `firstIdea`/`secondIdea`, `winnerIdeaId`, full judge-parsed transcript `messages[]` with `speakerSlot` 0/1/2; judge verdict schema `judgeVerdictSchema {winner:"candidate_a"|"candidate_b", explanation}` in schemas.ts:101), `standings[]` (`deriveSwissStandings()`, tournament.ts:306), `winnerWebsiteIdeaId`, `creditsUsed`. There is no dedicated winner column — winner is derived from the final-round match's `winnerIdeaId`.
- Cancel/resume mirror deep search: `POST /api/debate-jobs/:debateJobId/cancel|resume` (`requestDebateStop`, src/api/routes/debates/cancellation.ts:14).
- Debate events feed is minimal (`DebateJobEvent` = `updated | error | done`, debates/schemas.ts:120) — progress must come from polling the snapshot.

### Job lifecycle (shared)

- Statuses defined once in src/api/db/schema/statuses.ts:1: `jobStatuses = ["running","completed","failed","interrupted"]`. Terminal = anything ≠ running (`hasDurableTerminalState()` in deepSearch/manager.ts:86 and debates/manager.ts:62).
- Client learns completion by re-GETting the slug detail (status flips off `running`, `completedAt`/`error` populate) or holding the NDJSON events feed until close. No webhooks/callbacks exist.

### Retrieving results (critical for `get_result`)

- **Deep search final answer text is NOT in the detail JSON.** It lives in `llm_generations.text` linked via `deep_search_jobs.finalAnswerGenerationId` (`promoteRoundAnswer()` deepSearch/jobLifecycle.ts:231, `attachFinalAnswerGeneration()` store.ts:1978). Over HTTP: replay `GET /api/deep-search-jobs/:uuid/events` until the `final-answer-stream` event yields a `streamId`, then `GET /api/streams/:streamId` (src/api/routes/streams.ts:22) which replays persisted NDJSON `text` events containing the full answer. Structured analysis arrives inline in the `research-analysis` event (`{facts, disagreements, gaps, assumptions}`).
- Debate result comes entirely from the snapshot above (transcript included; winner derived). Winner website: `GET /api/idea-jobs/:ideaJobId/ideas/:ideaId/website` (+ `/website/screenshot.png`).

### Ownership, read access, quotas, credits

- Read routes resolve slugs anonymously through SQL scopes in src/api/routes/readAccess.ts (`deepSearchJobReadScope`, `ideaJobReadScope`, `debateJobReadScope`, `llmGenerationReadScope`): owner OR rows descending from a public debate (`isPublic=true`); everything else 404. Owner id is never exposed.
- Admission control `reserveRootResearchCapacity(userId, kind)` (src/api/routes/researchCapacity.ts:68) inside the creation transaction: max ~2 active root jobs per user (`RESEARCH_MAX_ACTIVE_ROOT_JOBS_PER_USER`) and rolling-window quotas (default 24h: 5 total; per-kind defaults deep-search 4 / idea 2 / **debate 1**) → HTTPException 429 with `Retry-After`. An MCP-driven agent can hit these quickly — worth surfacing 429/Retry-After through the tool errors.
- Credits are charged during execution, not admission; exhaustion mid-run surfaces as `OutOfCreditsError` → **402** `{ error: "Insufficient credits", remainingCredits }` (src/api/index.ts:45–53).

## Current auth implementation

- src/api/auth.ts: single `export const auth = betterAuth({...})` — drizzle adapter over `* as schema` from src/api/db/schema/index.ts, GitHub social provider, `trustedOrigins: [config.auth.trustedOrigin]` (derived as origin of `BETTER_AUTH_URL`, src/api/config.ts:621; prod default https://rethinkloop.com per src/api/runtimeDefaults.ts). **No plugins array exists today.**
- HTTP surface: src/api/routes/auth.ts (`authRoutes`) — public `GET /api/auth/config`, dev-only debug sign-in, catch-all `app.on(["GET","POST"], "/auth/*", (c) => auth.handler(c.req.raw))` (:87).
- Session shape consumed downstream: `session.user.id` (loadOptionalSession.ts:13–14); env typing in src/api/types/auth.ts (`viewerUserId`, `userId`, `isAdmin`, `isDebugUser`).
- Schema (src/api/db/schema/auth.ts): tables `user` (has `credits int default 500`, `isAdmin`), `session`, `account`, `verification`. **No api-key table exists.**
- Frontend: src/web/lib/authClient.ts (`createAuthClient` from better-auth/react, no plugins); authenticated calls in src/web/lib/api.ts rely on implicit cookies — no Authorization-header logic anywhere in src/web. **No Account/Settings page exists** (`src/web/pages/`: About, AdminCredits, Debates, DeepSearch, Examples, Home, Ideas, Legal) — the token-list/revoke UI in the ticket does not exist yet.

## Better Auth API Key plugin — verification of the ticket's open note

Verified against installed code and upstream sources:

- **better-auth 1.6.26 (installed, node_modules/better-auth) does NOT contain an api-key plugin** — no `dist/plugins/api-key`, no `./plugins/api-key` export subpath, no `createApiKey` anywhere, none of the option names (`customAPIKeyGetter`, `prefix`, `enableMetadata`, …) exist. Closest thing present is the unrelated `plugins/bearer` (converts an existing *session* token in `Authorization:` into the session cookie).
- **Upstream, the API key plugin is a separate package: `@better-auth/api-key`** exporting `apiKey()` (server) + `apiKeyClient()`. Docs: https://better-auth.com/docs/plugins/api-key/reference and /advanced. Verified from source (github.com/better-auth/better-auth, packages/api-key/src/index.ts):
  - `customAPIKeyGetter: (ctx) => string | null` **exists** — the ticket's approach is supportable; alternatively `apiKeyHeaders: string | string[]` (default `"x-api-key"`).
  - Options matching the ticket's design exist: hashed at rest (SHA-256 base64url `defaultKeyHasher`), `prefix` on create (`maximumPrefixLength` 32), `enableMetadata` (metadata off by default), `keyExpiration.defaultExpiresIn: null` (no forced expiry), per-key `rateLimit`, revocation via `enabled:false`/delete, DB table name `apikey`.
  - Endpoints/methods: `auth.api.createApiKey | verifyApiKey | getApiKey | updateApiKey | deleteApiKey | listApiKeys` (+ client equivalents).
  - **Key nuance:** the plugin's session-mocking hook (so `auth.api.getSession` authenticates an API key) only engages when `enableSessionForAPIKeys: true` — without it, `loadOptionalSession`/`requireSession` would never see CLI requests. Keys are created with a user session (or server-side `userId` body).
- Unverified: which minimum better-auth version `@better-auth/api-key` requires (installed core is 1.6.26); whether the plugin's Drizzle/SQLite schema generation fits src/api/db conventions (schema merging via plugin `schema` option exists). Adding the dependency requires approval per repo rules (see AGENTS.md "Libraries and dependencies").

## requireTrustedOrigin vs CLI requests — verified

src/api/middleware/requireTrustedOrigin.ts: safe methods (GET/HEAD/OPTIONS) always pass. Unsafe methods reject 403 only when `origin !== config.auth.trustedOrigin`, or when `origin` is absent **and** `sec-fetch-site: cross-site`. A CLI/fetch client sending no `Origin` and no `Sec-Fetch-Site` header **already passes** for all methods — no change strictly required for bearer-token REST calls. Precedent for mounting outside the middleware nonetheless exists: `authRoutes(api)` sits before `api.use("*", requireTrustedOrigin)` (index.ts:97–98). The real CLI integration point is `loadOptionalSession` (auth.api.getSession recognizing the API key), not origin checking.

## Adding the `src/cli` workspace — wiring checklist (files that hardcode the two-workspace shape)

- Root `package.json`: `workspaces: ["src/api","src/web"]`; `"test": "npm run test -w @rethinkloop/api && npm run test -w @rethinkloop/web"` (hardcoded chain — gatekeep's `npm test` will NOT run CLI tests unless edited); `test:e2e` similar; proxy-script convention `-w @rethinkloop/<name>`; root is `"private": true`, `"type": "module"`, `engines.node >=26` (+ `devEngines.runtime` onFail error).
- TypeScript: no project references/composite. Root tsconfig.json (`include: ["src"]`, `moduleResolution: "bundler"`, `allowImportingTsExtensions`, `noEmit`, strict) typechecks everything; src/api/tsconfig.json mirrors it minus jsx (used by ESLint `projectService`, which picks nearest tsconfig). A new workspace should get its own tsconfig mirroring these options. Runtime model: **no build step**, imports keep `.ts` extensions, run via `node --experimental-strip-types` (src/api/docs/runtime.md).
- ESLint (eslint.config.js): typed block targets `src/**/*.{ts,tsx}` via projectService — a `src/cli` is covered automatically; global ignores dist/node_modules/etc.
- Knip (knip.json): explicit `workspaces` map with per-workspace `entry` lists (e.g. src/api entries `db/index.ts`, `e2e/mockExternalServices.mjs`) — a new workspace entry with its bin entry must be added or knip misreports.
- Vitest: per-workspace configs (src/api/vitest.config.ts fakes the whole required-env block inline; setupFiles db/testSetup.ts). Root `npm test` chains workspaces sequentially.
- Dagger (dagger/src/index.ts): `gatekeep()` just runs the four root scripts in `node:26-bookworm-slim`; `buildEnv()` copies manifests **by explicit path** (root package.json, lockfile, src/api/package.json, src/web/package.json) before `npm ci` — `src/cli/package.json` must be added there. `publish()` builds/pushes the Docker image only (`docker.io/florianherrengt/rethinkloop`, tag from git SHA; token `DOCKER_HUB_TOKEN` in `.env`). No GitHub Actions exist.
- Production Dockerfile (root): copies manifests explicitly, `npm ci`, builds web, runtime stage copies `/app/src/api` wholesale + `src/web/dist`; CMD `npm run start -w @rethinkloop/api`; migrations via prestart. A CLI workspace needs explicit COPY lines only if it must ship in the image (probably not — it ships to npm instead; unresolved, see Open questions).
- `scripts/create-worktree.mjs` writes exactly two env-file paths (src/api/.env, src/web/.env) — not covering a third workspace.
- Env loading pattern: `import "dotenv/config"` first line; dotenv resolves `.env` relative to process cwd.

## Publishing constraints (conflict to resolve before release)

- Root package is named `rethinkloop` and `private: true` — npm refuses to publish private packages, and a workspace cannot publish a package whose name collides with the private root's name. **Resolved:** the root package will be renamed so `src/cli` can publish as `rethinkloop` (see Decisions).
- No npm-publish machinery exists anywhere in the repo today (CI publishes Docker images only). Publishing workflow/provenance/registry auth is greenfield.

## Naming collision warning

`src/api/cli.ts` already exists (plus `"cli"` script in src/api/package.json): an offline admin utility that regenerates idea websites by hitting SQLite directly (`--generate-idea-website <ideaId>`). It is unrelated to this feature but occupies the "cli" name in the API workspace and knip/docs references.

## Verified external package facts (for planning, not decisions)

- `@modelcontextprotocol/sdk` current version 1.30.0 on npm (official TS MCP SDK; stdio transport supported). Nothing MCP-related exists in this repo yet — zero occurrences in any package.json/lockfile/src.
- `@napi-rs/keyring` current version 1.3.0 on npm (Node bindings for keyring-rs) — maintained candidate for the OS-keychain storage the ticket mentions. `keytar` is deprecated (context for why the ticket names an alternative).

## Testing conventions relevant here

- API tests: vitest, colocated `*.test.ts`, in-memory SQLite (`DATABASE_URL: ":memory:"`), mocked provider env (see src/api/vitest.config.ts and src/api/docs/testing.md). Route tests exist per area (e.g. src/api/routes/deepSearch/index.test.ts).
- E2E through real MCP path: the ticket points at the `ai-app-e2e` skill (real MCP client → CLI → API → provider). Web e2e is Playwright under src/web/e2e.

---

# Decisions (confirmed by Florian 2026-08-25)

1. **Auth dependency:** use `@better-auth/api-key` (upstream plugin), pinned to **1.6.26** — compatibility with installed better-auth@1.6.26 verified, see "Pre-implementation checks" below.
2. **Publishing:** rename the root `package.json` (e.g. to a non-colliding private name) so the `src/cli` workspace can publish as `rethinkloop`.
3. **CLI distribution:** raw TypeScript, no build step — same convention as the repo (`node --experimental-strip-types`, `.ts` import extensions). Implication: the published package must declare an appropriate `engines.node` floor (type stripping needs recent Node) and users' MCP clients must launch it accordingly.
4. **Scope:** everything in one ticket — CLI workspace + `/cli/auth/start|status` API routes + `rethinkloop.com/cli/authorize` frontend page + account tokens UI (list/last-used/revoke).
5. **get_result addressing:** add a new REST GET-by-UUID status endpoint(s) so agents can poll with the opaque ids returned by start_*. Slug detail routes remain as-is.
6. **Deep-search result retrieval:** add a direct read in the API (new field on the detail response or a dedicated endpoint) rather than composing events-replay + streams fetch in the CLI. The existing `finalAnswerGenerationId` → `llm_generations.text` chain is the data source; respect `llmGenerationReadScope` ownership rules.
7. **Debate transcript summary:** compact digest only — winner idea, judge verdicts/explanations, standings. Full transcript stays behind REST/URLs.
8. **mcp install targets:** standard paths — Codex `~/.codex/config.toml`, Claude Code `~/.claude.json` (`mcpServers`), opencode `~/.config/opencode/opencode.json`, Cursor `~/.cursor/mcp.json`.
9. **API base URL:** env var `RETHINKLOOP_API_URL`, default `https://rethinkloop.com`; overridable for dev/self-host.
10. **Device-flow parameters:** sensible defaults — code TTL ~5 min, CLI polls every 2s with ~5 min overall timeout; code is single-use and deleted once the token is minted at `/cli/auth/status`.
11. **Docker image:** the production image does NOT ship the CLI; it keeps serving API+web only. The CLI ships to npm independently.

## Pre-implementation checks — VERIFIED 2026-08-25

- **`@better-auth/api-key` compatibility: RESOLVED — no better-auth upgrade needed.** The plugin ships a version line matching core minors: `@better-auth/api-key@1.6.26` declares peerDependencies `better-auth: ^1.6.26`, `@better-auth/core: ^1.6.26`, `better-call: 1.3.7` (satisfied by installed better-auth@1.6.26 / @better-auth/core@1.6.26; zod ^4.3.6 already in repo). Pin the plugin to **1.6.26** — plugin versions ≥1.6.27 peer `^1.6.27`+ and would force a core upgrade; latest 1.7.1 peers `^1.7.1`. Schema integration follows existing conventions: add a hand-written Drizzle `apikey` table to src/api/db/schema/auth.ts (fields per plugin's `apiKeySchema`: id, name, key hash, prefix, referenceId, configId, enabled, rateLimit*/refill*/requestCount/remaining/lastRequest/lastRefillAt, expiresAt, createdAt, updatedAt, permissions, metadata) + drizzle-kit migration, same pattern as the `user`/`session`/`account`/`verification` tables.
- **Root package rename impact: LOW RISK.** `"name": "rethinkloop"` appears only in root package.json, package-lock.json (regenerated), and dagger/dagger.json — the last being the Dagger *module* name, independent of npm publishing. No script, Dockerfile, or docs reference uses the unscoped root npm name (`-w` flags all use `@rethinkloop/*`). Renaming the root package breaks nothing else.
- **Raw-TS CLI distribution floor: Node ≥ 22.18.0** (LTS backport) or ≥ 23.6.0, where type stripping is enabled by default — verified against nodejs.org release notes/docs (stable since v24.12/v25.2). Local smoke test on installed v26.5.1: `.ts` files with `.ts`-extension imports run flagless. Constraints for CLI code: erasable syntax only (no enums/namespaces/parameter properties — transform-types support removed in v26), no tsconfig-path resolution. Shebang `#!/usr/bin/env node` suffices (no flags needed), so MCP clients spawning `rethinkloop mcp` need nothing special beyond a compatible Node on PATH. Published package should declare its own `engines.node` (≥22.18) independent of the repo dev requirement of ≥26.
