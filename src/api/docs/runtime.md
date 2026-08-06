# API runtime gotchas

High-signal facts about how the API starts and runs. Getting these wrong is the most common source of breakage.

## No build step

The API runs TypeScript directly via `node --experimental-strip-types`. Consequences:

- Imports keep the `.ts` extension **at runtime**, e.g. `./index.ts` (not `./index`). `allowImportingTsExtensions` is enabled in the api `tsconfig.json`.
- Do **not** strip extensions, add path alias rewrites, or introduce a compile/build step.
- Requires Node 22+ (the `--experimental-strip-types` flag).

## Required env vars throw at import time

`src/api/config.ts` throws on import if `NODE_ENV`, the search, extraction, LLM,
Better Auth, or GitHub OAuth credentials are missing or malformed. Copy the tracked
`src/api/.env.example` to the ignored `src/api/.env`, then replace every
placeholder before `npm run dev` / `npm run start` will boot. The API
`vitest.config.ts` injects test-only values, so tests pass without real
credentials.

`BETTER_AUTH_SECRET` must contain at least 32 characters and production config
rejects tracked placeholder values. GitHub OAuth uses
`GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET`; its local callback is derived
from `BETTER_AUTH_URL` and ends in `/api/auth/callback/github`.
`BETTER_AUTH_URL` must use HTTPS when `NODE_ENV=production` so session cookies
cannot be deployed over plaintext transport.

Debug sign-in is disabled unless `AUTH_DEBUG_USER_ENABLED=true`. When enabled,
`AUTH_DEBUG_USER_PASSWORD` is required. Config validation rejects debug sign-in
in `NODE_ENV=production`, when `API_HOST` is not loopback, or when
`BETTER_AUTH_URL` is not loopback. Generic email sign-up, sign-in, and
password-reset HTTP endpoints are blocked; password auth exists only behind the
trusted local debug sign-in endpoint. Provider-debug routes are registered only
when debug auth is enabled and accept only the configured debug user's session.

All application routes after `/api/auth/*` require an opaque database-backed
Better Auth session. The middleware stores the authenticated `user.id` in the
Hono context. Job and stream routes then enforce that ID in their database query;
foreign UUIDs return 404 rather than disclosing resource existence.
Unsafe application requests carrying a foreign browser `Origin` (or an explicit
cross-site fetch marker) are rejected before session or provider work, adding a
CSRF boundary around job creation. Non-browser API clients may omit `Origin`.

## Local database initialization

SQLite database files are ignored. Drizzle migrations are the schema source of
truth. Both `npm run dev` and `npm run start` apply pending migrations through
their API workspace lifecycle scripts before the server imports the database.

## Real external services in dev

A SearXNG instance, a DeepSeek API key, and a ScrapingAnt API key are real runtime dependencies, not mocked outside tests:

- **SearXNG:** HTTP `/search?format=json`. Configure its URL via `SEARXNG_URL`.
- **DeepSeek:** used by the LLM layer (`src/api/llms/`). Key via `DEEPSEEK_API_KEY`.
- **ScrapingAnt:** headless-browser renderer used for page extraction. Without it the Reddit/Amazon/Shopify/Trustpilot/GitHub/YouTube/Hacker News custom extractors can't run (they require a renderer), and any page whose plain-fetch text falls under ~200 chars falls back to a ScrapingAnt render. Key via `SCRAPINGANT_API_KEY`. Renders are serialized for the free-plan concurrency cap. HTTP 423 anti-bot detections are retried twice with exponential backoff by default; configure this with `SCRAPINGANT_MAX_RETRIES` and `SCRAPINGANT_RETRY_DELAY_MS`. `SCRAPINGANT_PROXY_TYPE` defaults to `datacenter`; `residential` has a higher success rate on protected sites and a much higher credit cost.

## Network binding

The API binds to `127.0.0.1` by default through `API_HOST`. This keeps the local
development API and its paid provider integrations off the LAN. A deployment
may override the host only when authentication, quotas,
request-size limits, and concurrency controls are enforced by its gateway.
