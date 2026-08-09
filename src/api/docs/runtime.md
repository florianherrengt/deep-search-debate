# API runtime gotchas

High-signal facts about how the API starts and runs. Getting these wrong is the most common source of breakage.

## No build step

The API runs TypeScript directly via `node --experimental-strip-types`. Consequences:

- Imports keep the `.ts` extension **at runtime**, e.g. `./index.ts` (not `./index`). `allowImportingTsExtensions` is enabled in the api `tsconfig.json`.
- Do **not** strip extensions, add path alias rewrites, or introduce a compile/build step.
- Requires Node 26+ (the `--experimental-strip-types` flag).

## Configuration validation at import time

`src/api/config.ts` reads and validates environment configuration before any
server or provider is constructed. `LLM_PROVIDER` and `LLM_MODEL_NAME` are
required. `LLM_PROVIDER=deepseek` requires `DEEPSEEK_API_KEY`, while
`LLM_PROVIDER=zen` requires `OPENCODE_ZEN_API_KEY`; the unselected key may be
absent or blank. `SCRAPINGANT_API_KEY`, `BETTER_AUTH_SECRET`,
`GITHUB_CLIENT_ID`, and `GITHUB_CLIENT_SECRET` are always required. Production
also requires `BRAVE_SEARCH_API_KEY`. A missing, blank, or whitespace-only
required secret fails startup.

`BETTER_AUTH_SECRET` must contain at least 32 characters and production config
rejects placeholder values. GitHub OAuth resolves both `GITHUB_CLIENT_ID` and
`GITHUB_CLIENT_SECRET` from the environment. Its callback is derived from
`BETTER_AUTH_URL` and ends in `/api/auth/callback/github`.
`BETTER_AUTH_URL` must use HTTPS when `NODE_ENV=production` so session cookies
cannot be deployed over plaintext transport.

`NODE_ENV` also selects non-secret defaults. Development and test use
`BETTER_AUTH_URL=http://localhost:5173` and `DATABASE_URL=data.db`; production
uses `BETTER_AUTH_URL=https://rethinkloop.com` and
`DATABASE_URL=/app/data/data.db`. Explicit environment overrides remain
available for tests and alternate deployments.

Debug sign-in is disabled unless `AUTH_DEBUG_USER_ENABLED=true`. When enabled,
`AUTH_DEBUG_USER_PASSWORD` is required. Config validation rejects debug sign-in
in `NODE_ENV=production`, when `API_HOST` is not loopback, or when
`BETTER_AUTH_URL` is not loopback. Generic email sign-up, sign-in, and
password-reset HTTP endpoints are blocked; password auth exists only behind the
trusted local debug sign-in endpoint. Provider-debug routes are registered only
when debug auth is enabled and accept only the configured debug user's session.

Application mutations and history routes after `/api/auth/*` require an opaque
database-backed Better Auth session. The middleware stores the authenticated
`user.id` in the Hono context. Debate, nested idea/deep-search, and owned-stream
detail reads also accept anonymous requests when the debate is public. Private,
revoked, foreign, and unknown UUIDs return 404 rather than disclosing resource
existence, and public responses omit creator identity. Reusable Drizzle read
scopes put ownership and inherited public access into the query retrieving each
protected root row; routes do not load a resource and then recursively query its
parents to authorize it.
Unsafe application requests carrying a foreign browser `Origin` (or an explicit
cross-site fetch marker) are rejected before session or provider work, adding a
CSRF boundary around job creation. Non-browser API clients may omit `Origin`.

## Local database initialization

SQLite database files are ignored. Drizzle migrations are the schema source of
truth. Both `npm run dev` and `npm run start` apply pending migrations through
their API workspace lifecycle scripts before the server imports the database.

## Search providers by environment

Development and test use the configured SearXNG instance. Production instead
requires the `BRAVE_SEARCH_API_KEY` environment variable and does not require or
use `SEARXNG_URL`. This is an explicit environment policy in the typed config
module, not an operator-selected fallback.

## Real external services in dev

A SearXNG instance, the selected LLM provider credential, and a ScrapingAnt API
key are real runtime dependencies, not mocked outside tests:

- **SearXNG:** HTTP `/search?format=json`. Configure its URL via `SEARXNG_URL`.
- **LLM:** `deepseek` uses the native DeepSeek AI SDK provider and
  `DEEPSEEK_API_KEY`. `zen` uses OpenCode Zen's OpenAI-compatible
  `/chat/completions` endpoint and `OPENCODE_ZEN_API_KEY`. Configure the model
  ID with `LLM_MODEL_NAME`; Zen model IDs are sent without an `opencode/`
  prefix. The selected Zen model must be listed for the
  `@ai-sdk/openai-compatible` package and support the structured output used by
  the application.
- **ScrapingAnt:** the only page-retrieval provider. Every selected URL first uses
  its cheap non-browser request. Empty, trivial, challenged, or obvious error
  content escalates once to headless-browser rendering through a US datacenter
  proxy; failure there remains a page-level failure so deep research can use the
  search snippet. Both tiers pass through the same local content extraction and
  cheap validation. HTML uses the shared visible-text cleanup, while bounded PDF
  responses use the existing memory-limited PDF parser. There are no provider
  retries, residential proxies, domain rules, or caches. Configure
  `SCRAPINGANT_API_KEY`, `SCRAPINGANT_QUEUE_WAIT_TIMEOUT_MS` (default 120
  seconds),
  `SCRAPINGANT_REQUEST_TIMEOUT_MS` (default 35 seconds, including five seconds
  of client-side headroom), and `SCRAPINGANT_MAX_RESPONSE_BYTES` (default 2 MB).
  Every ScrapingAnt request, across all URLs and both tiers, shares one
  process-wide queue with concurrency fixed at exactly one for free-plan
  compatibility. Pending work that cannot acquire the slot before its queue
  deadline fails as an individual page attempt. A failed or timed-out active
  request releases the slot.
  Retrieval emits one flat structured console record per attempt with its
  latency, outcome, provider status on failures, and ScrapingAnt credit cost when
  the provider reports it.

## Network binding

The API binds to `127.0.0.1` by default through `API_HOST`. This keeps the local
development API and its paid provider integrations off the LAN. A deployment
may override the host only when authentication, quotas,
request-size limits, and concurrency controls are enforced by its gateway.
The listening port is parsed from `PORT` and defaults to `3000`.

## Container runtime

The root `Dockerfile` builds the Vite client and runs the API TypeScript directly
on Node.js 26. In production, the Hono process serves the built client and its SPA
fallback in addition to `/api`. `/api/health` is public so container and Coolify
health checks do not depend on a browser session.

The container stores SQLite at `/app/data/data.db`. Production must mount
persistent storage at `/app/data`; without it, deployments replace the database.
The retained `src/api/secrets/*.kdbx` operator vaults are excluded from the
Docker build context. The application does not read them. All runtime secrets
must be supplied through the deployment environment and must never be baked
into the image.
