# API runtime gotchas

High-signal facts about how the API starts and runs. Getting these wrong is the most common source of breakage.

## No build step

The API runs TypeScript directly via `node --experimental-strip-types`. Consequences:

- Imports keep the `.ts` extension **at runtime**, e.g. `./index.ts` (not `./index`). `allowImportingTsExtensions` is enabled in the api `tsconfig.json`.
- Do **not** strip extensions, add path alias rewrites, or introduce a compile/build step.
- Requires Node 26+ (the `--experimental-strip-types` flag).

## Workflow runtime boundary

The API pins `effect` to exactly `4.0.0-rc.109`. Do not float this prerelease
dependency: the small boundary in `workflowRuntime.ts` depends on its current
`Effect.runPromiseExit` and cause APIs. That boundary converts successful exits,
the tagged `WorkflowFailure`, Effect interruption, and defects into
Promise-facing results and errors. Hono, Drizzle, Zod, AI SDK provider policy,
and all process-wide `PQueue` scheduling remain outside Effect.

Each research-workflow manager owns the `AbortController`, completion promise,
and retained live event log for each active job entry. Debate cancellation
propagates through its idea job into child deep searches; an idea-root signal
likewise propagates into its child searches. These signals are internal workflow
signals, never Hono request signals, so disconnecting or closing the browser
does not cancel provider work. A tagged manager signal is classified as
`user-stop` or `parent-stop`; provider deadlines and ordinary abort-like
failures remain failures. Deep-search, idea, and debate workflows expose
owner-only root Stop routes. For either a direct root Stop or an inherited
parent Stop, deep-search and idea feeds publish `stop-requested`; already-started
result events may follow while cleanup settles, then the feeds end with
`interrupted` and `done`. The snapshot-driven debate feed publishes `updated`
after the request and terminalization, then `done`. Neither Stop path publishes
an ordinary error event. A Stop command persists the root's request before
aborting its manager-owned controller; descendants inherit the signal and event
presentation without storing their own stop timestamp. That presentation is
causal: a descendant that reached a terminal state before the root timestamp
does not gain `stopRequested` or a Stop event suffix after the fact.

`routes/deepSearch/pipeline.ts`, `routes/ideas/run.ts`, and
`routes/debates/run.ts` are the Effect-owned coordinators. Each has one
Promise-facing runtime boundary, sequences durable stages with `Effect.gen`,
and uses settle-all result-mode fan-outs where it launches concurrent work.
Debate rounds remain sequential, while each advocate pair and all matches in a
round settle concurrently in input order. The existing deterministic tournament
pairing, Elo, prompt-isolation, and bounded retry rules remain outside the
runtime bridge.

The same signal is forwarded through the existing LLM, web-search, extraction,
and queue boundaries. Waiting queue tasks are removed on interruption, while an
active task keeps its process-wide permit until its signal-aware cleanup settles.
The existing queue instances, concurrency, priority, SDK retry policy, and
provider timeout policy remain authoritative.

## Configuration validation at import time

`src/api/config.ts` reads and validates environment configuration before any
server or provider is constructed. `LLM_PROVIDER` and `LLM_MODEL_NAME` are
required. `LLM_PROVIDER=deepseek` requires `DEEPSEEK_API_KEY` and the priced
`deepseek-v4-flash` or `deepseek-v4-pro` model. Development alone may use
`LLM_PROVIDER=zen`, which requires `OPENCODE_ZEN_API_KEY`; the unselected key
may be absent or blank.
`SCRAPINGANT_API_KEY`, `BETTER_AUTH_SECRET`,
`GITHUB_CLIENT_ID`, and `GITHUB_CLIENT_SECRET` are always required. Production
also requires `SERPER_API_KEY`. A missing, blank, or whitespace-only
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
`BETTER_AUTH_URL` is also the public web origin used for canonical debate URLs
and social-preview images because authentication and the production web app are
served from the same origin.

`EXAMPLE_DEBATE_IDS` optionally contains an ordered, comma-separated list of up
to 50 debate job UUIDs. The public examples endpoint and sitemap include only
configured debates that still exist, are public, and have completed. Invalid
UUIDs fail startup; duplicates are removed while preserving their first
position. Missing, private, and unfinished debates are omitted at request time,
so revoking a debate's visibility also removes it from public discovery.

Deep-search work is bounded in application configuration. Defaults allow at
most 5 searches, 5 explored results per search, 15 selected URLs per round,
2 rounds, 200 selected pages across one complete root workflow, and 10,000
characters per research request. Accumulated query, result, idea, evaluation, and
debate context is rebuilt in memory under a 100,000-character ceiling while
retaining a bounded entry for every item. Internally synthesized refined-idea
requests allocate that same external request budget across the original prompt
and generated fields before a child can start. Idea jobs generate at most 12
candidates and may request at most 2 initial child searches by default. Debate
jobs generate at most 8 candidates, start one initial briefing search, allow one
research round per child, and select at most 81 pages across the complete
debate-owned research tree. At most two root research workflows per user may be active, two
deep-search pipelines execute per process, and four selected page
extraction-plus-summary tasks execute per process. Four LLM generations execute
per process across all workflows by default. Root capacity is reserved
before asynchronous title generation, and an admitted root takes priority over
waiting children without pre-empting running work. Operators may adjust
these ceilings within the hard safety ranges
validated by `config.ts` through `DEEP_SEARCH_MAX_SEARCHES`,
`DEEP_SEARCH_MAX_RESULTS_PER_SEARCH`,
`DEEP_SEARCH_MAX_SELECTED_URLS_PER_ROUND`, `DEEP_SEARCH_MAX_ROUNDS`,
`DEEP_SEARCH_MAX_REQUEST_CHARS`, `DEEP_SEARCH_MAX_SUMMARY_CONTEXT_CHARS`,
`DEEP_SEARCH_MAX_CONCURRENT_JOBS`,
`DEEP_SEARCH_MAX_CONCURRENT_PAGE_TASKS`,
`LLM_MAX_CONCURRENT_GENERATIONS`,
`RESEARCH_MAX_ACTIVE_ROOT_JOBS_PER_USER`,
`RESEARCH_MAX_SELECTED_PAGES_PER_ROOT_JOB`, `IDEA_JOB_MAX_IDEA_COUNT`,
`IDEA_JOB_MAX_DEEP_SEARCH_COUNT`, and the `DEBATE_MAX_*` workload settings.

Root creation also uses a durable rolling-window quota before title generation
or any other provider work. The default 24-hour window permits five total root
attempts per user: at most four standalone deep searches, two standalone idea
runs, and one debate. A charged admission remains after a later preflight
failure, preventing cheap validation failures from becoming a provider-cost
bypass. A rate rejection returns `429` with `Retry-After`. Configure the window
and ceilings with `RESEARCH_JOB_CREATION_WINDOW_MS`,
`RESEARCH_MAX_ROOT_JOB_CREATIONS_PER_WINDOW`,
`DEEP_SEARCH_MAX_ROOT_JOB_CREATIONS_PER_WINDOW`,
`IDEA_JOB_MAX_ROOT_JOB_CREATIONS_PER_WINDOW`, and
`DEBATE_MAX_ROOT_JOB_CREATIONS_PER_WINDOW`.

Every LLM stream has total, first-content, and inter-content deadlines. The
defaults are 300, 120, and 60 seconds and are configured with
`LLM_GENERATION_TIMEOUT_MS`, `LLM_FIRST_CHUNK_TIMEOUT_MS`, and
`LLM_CHUNK_TIMEOUT_MS`. `LLM_MAX_OUTPUT_TOKENS` is an 8,192-token operator
ceiling by default; stages send smaller explicit budgets when their outputs are
known to be short. This avoids both provider-specific implicit limits and
oversized structured responses. Provider-request failures use two SDK retries by default,
configured through `LLM_MAX_RETRIES`, so dependency upgrades cannot silently
change retry cost or latency. The short title generation retains its narrower
per-call limit. Evidence-transformation and prose-only stages—including
page/query/final research synthesis, structured research analysis, idea
briefing, idea evaluation, and debate advocacy—disable hidden reasoning so it
cannot consume that budget without producing the required durable output. Web searches have a 30-second deadline
configured by `WEB_SEARCH_TIMEOUT_MS` and charge the fixed product-credit amount
configured by `WEB_SEARCH_CREDITS_COST` (default 1) after a successful provider
response. Production Serper calls are limited process-wide by
`SERPER_MAX_QUERIES_PER_SECOND` (default and maximum 50 for the configured
plan). Direct `POST /api/streams` calls reuse the research
request length limit and permit two active standalone generations per user by
default, configurable through
`LLM_MAX_ACTIVE_STANDALONE_GENERATIONS_PER_USER`. The process-wide provider
queue is configured through `LLM_MAX_CONCURRENT_GENERATIONS`.

Debug sign-in is disabled unless `AUTH_DEBUG_USER_ENABLED=true`. When enabled,
`AUTH_DEBUG_USER_PASSWORD` is required. Config validation rejects debug sign-in
in `NODE_ENV=production`, when `API_HOST` is not loopback, or when
`BETTER_AUTH_URL` is not loopback. Generic email sign-up, sign-in, and
password-reset HTTP endpoints are blocked; password auth exists only behind the
trusted local debug sign-in endpoint. Provider-debug routes are registered only
when debug auth is enabled and accept only the configured debug user's session.

Application mutations and owner-only history routes after `/api/auth/*` require
an opaque database-backed Better Auth session. The middleware stores the
authenticated `user.id` in the Hono context. The curated `/api/examples` read is
public. Debate, nested idea/deep-search, and owned-stream detail reads also
accept anonymous requests when the debate is public. Private,
revoked, foreign, and unknown UUIDs return 404 rather than disclosing resource
existence, and public responses omit creator identity. Reusable Drizzle read
scopes put ownership and inherited public access into the query retrieving each
protected root row; routes do not load a resource and then recursively query its
parents to authorize it. Anonymous viewers cannot start provider-backed streams,
searches, idea runs, or debates.
Unsafe application requests carrying a foreign browser `Origin` (or an explicit
cross-site fetch marker) are rejected before session or provider work, adding a
CSRF boundary around job creation. Non-browser API clients may omit `Origin`.

## Local database initialization

SQLite database files are ignored. Drizzle migrations are the schema source of
truth. Both `npm run dev` and `npm run start` apply pending migrations through
their API workspace lifecycle scripts before the server imports the database.
The current migration history is a deliberately replaced fresh baseline, not an
upgrade from the superseded history. Any database created from that old history
must be discarded and recreated before startup; the application does not
preserve or migrate its data.

## Search providers by environment

Development and test use the configured SearXNG instance. Production instead
requires the `SERPER_API_KEY` environment variable and does not require or
use `SEARXNG_URL`. This is an explicit environment policy in the typed config
module, not an operator-selected fallback.

Production calls Serper's Google Search endpoint through one process-wide rate
limit. `SERPER_MAX_QUERIES_PER_SECOND` accepts 1 through 50 and defaults to the
production plan limit of 50.

## Real external services in dev

A SearXNG instance, the selected LLM provider credential, and a ScrapingAnt API
key are real runtime dependencies, not mocked outside tests:

- **SearXNG:** HTTP `/search?format=json`. Configure its URL via `SEARXNG_URL`.
  `SEARXNG_CATEGORIES` defaults to `general,science`, so evidence-oriented
  searches retain academic results when general engines throttle. Requests pass
  through one process-wide queue; `SEARXNG_MAX_CONCURRENT_REQUESTS` defaults to
  `1` and `SEARXNG_MIN_INTERVAL_MS` to `1000` to avoid burst-blocking the
  upstream engines aggregated by a local instance.
  Search-provider responses are bounded by `WEB_SEARCH_MAX_RESPONSE_BYTES`
  (default 2 MB), then capped to 30 validated, canonical, unique public HTTPS
  results per query before persistence or prompting.
- **LLM:** `deepseek` uses the native DeepSeek AI SDK provider and
  `DEEPSEEK_API_KEY`. Development-only `zen` uses OpenCode Zen's OpenAI-compatible
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
  responses use the existing memory-limited PDF parser. Declared non-document
  media and binary-looking untyped bodies are rejected rather than decoded as
  text. There are no provider
  retries, residential proxies, domain rules, or caches. Configure
  `SCRAPINGANT_API_KEY`, `SCRAPINGANT_QUEUE_WAIT_TIMEOUT_MS` (default 120
  seconds),
  `SCRAPINGANT_REQUEST_TIMEOUT_MS` (default 35 seconds, including five seconds
  of client-side headroom), and `SCRAPINGANT_MAX_RESPONSE_BYTES` (default 2 MB).
  Every ScrapingAnt request, across all URLs and both tiers, shares one
  process-wide queue with concurrency fixed at exactly one for free-plan
  compatibility. Pending work that cannot acquire the slot before its queue
  deadline fails as an individual page attempt. A failed or timed-out active
  request releases the slot. The higher-level page-task queue prevents every
  selected URL from entering this single provider queue at once while still
  allowing extraction and LLM summarization to overlap.
  Retrieval emits one flat structured console record per attempt with its
  latency, outcome, provider status on failures, and ScrapingAnt credit cost when
  the provider reports it.

## Credit accounting

Users start with 500 credits. One product credit represents $0.001. Every paid
provider call checks that the initiating user's signed balance is positive
before it starts; there is no reservation, so concurrent calls may all pass and
overspend. After a successful call, the resource row and user debit commit
together and the balance may become negative. Failed provider calls are
deliberately not charged. Development-only Zen calls charge one product credit
per successful generation for use of RethinkLoop and still require a positive
balance before starting. Completed usage remains charged; stopped in-progress
attempts do not debit RethinkLoop credits. This application guarantee does not
promise that an upstream provider will waive its own charge. Successful
ScrapingAnt extractions accumulate every reported `ant-credits-cost` across both
retrieval modes. Its $19 / 100,000 provider-credit plan is converted with
`ceil(providerCredits * 19 / 100)`.

DeepSeek Flash V4 generation cost uses the AI SDK's cache-hit, cache-miss, and
output token counts with the model-specific pricing function. The resulting
micro-USD cost is rounded up to product credits. A model change requires a new
pricing function; operational token prices are deliberately not environment
configuration.

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

The production fallback resolves application routes before returning the built
SPA shell. It uses the optional Better Auth session plus the same durable
ownership, inherited visibility, and root-debate completion facts as API reads.
Known private resources return the shell only to their owner and carry
`noindex`; anonymous and foreign requests receive a hard 404. Public completed
debates and their idea/deep-search descendants receive route-specific title,
description, canonical, Open Graph, Twitter, and JSON-LD metadata in the initial
HTML. Unknown routes return a hard 404. Dynamic HTML is not cached because a
public debate can later be revoked. `robots.txt` and `sitemap.xml` are generated
at the application origin; the sitemap contains the home and examples pages plus
completed public resources whose root debate is selected by
`EXAMPLE_DEBATE_IDS`, with path segments URL-encoded before XML escaping.

The container stores SQLite at `/app/data/data.db`. Production must mount
persistent storage at `/app/data`; without it, deployments replace the database.
The retained `src/api/secrets/*.kdbx` operator vaults are excluded from the
Docker build context. The application does not read them. All runtime secrets
must be supplied through the deployment environment and must never be baked
into the image.
