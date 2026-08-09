# RethinkLoop

An npm workspaces monorepo with a Hono API and a Vite/React web client.

## Requirements

- Node.js 26 or newer
- A running SearXNG instance for local development
- A GitHub OAuth app

The API reads secrets exclusively from environment variables and validates them
at startup:

| Environment variable | Required when |
| --- | --- |
| `LLM_PROVIDER` | Always; `deepseek` or `zen` |
| `LLM_MODEL_NAME` | Always |
| `DEEPSEEK_API_KEY` | `LLM_PROVIDER=deepseek` |
| `OPENCODE_ZEN_API_KEY` | `LLM_PROVIDER=zen` |
| `SCRAPINGANT_API_KEY` | Always |
| `BETTER_AUTH_SECRET` | Always; at least 32 characters |
| `GITHUB_CLIENT_ID` | Always |
| `GITHUB_CLIENT_SECRET` | Always |
| `BRAVE_SEARCH_API_KEY` | Production only |
| `AUTH_DEBUG_USER_PASSWORD` | Debug sign-in is enabled; at least 12 characters |

Create the ignored local environment file from the tracked template and fill in
the required secrets:

```sh
cp src/api/.env.example src/api/.env
```

The template contains:

```dotenv
NODE_ENV=development
PORT=3000
BETTER_AUTH_URL=http://localhost:5173
SEARXNG_URL=http://127.0.0.1:8090
LLM_PROVIDER=deepseek
LLM_MODEL_NAME=deepseek-v4-flash
DEEPSEEK_API_KEY=
OPENCODE_ZEN_API_KEY=
SCRAPINGANT_API_KEY=
SCRAPINGANT_QUEUE_WAIT_TIMEOUT_MS=120000
SCRAPINGANT_REQUEST_TIMEOUT_MS=35000
SCRAPINGANT_MAX_RESPONSE_BYTES=2000000
BETTER_AUTH_SECRET=
GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=
AUTH_DEBUG_USER_ENABLED=false
AUTH_DEBUG_USER_EMAIL=debug@local.invalid
```

Do not put real credentials in `.env.example`; set them only in the ignored
`src/api/.env` or the deployment platform. The selected LLM provider's key is
required; the unselected provider's key may be absent or blank. A missing,
blank, or whitespace-only required secret fails startup.

`NODE_ENV` selects the application defaults. Development and test use
`BETTER_AUTH_URL=http://localhost:5173` and `DATABASE_URL=data.db`; production
uses `BETTER_AUTH_URL=https://rethinkloop.com` and
`DATABASE_URL=/app/data/data.db`. Explicit environment values still override
the URL or database path for isolated tests and alternate deployments.

The tracked `src/api/secrets/dev.kdbx` and `src/api/secrets/prod.kdbx` files are
retained as operator-managed credential vaults only. The application does not
open them, and Docker excludes them from the build context and runtime image.

Configure the GitHub OAuth callback as
`http://localhost:5173/api/auth/callback/github`. Debug sign-in is optional and
is accepted only when both the API binding and `BETTER_AUTH_URL` are loopback
addresses.

Page retrieval always starts with ScrapingAnt's cheap non-browser request and
escalates once to browser rendering through a US datacenter proxy when the
result is clearly unusable. A failed browser render remains an individual page
failure; there are no residential proxies or provider retries. All ScrapingAnt
requests share one process-wide queue with concurrency fixed at exactly one;
pending attempts expire after `SCRAPINGANT_QUEUE_WAIT_TIMEOUT_MS`.

Install dependencies with `npm install`.

Start the local SearXNG dependency with:

```sh
docker compose up -d searxng
```

The development Compose service listens only on `127.0.0.1:8090` and enables the JSON search format used by the API.

Production uses Brave Search and does not read `SEARXNG_URL`. See
[the Coolify operations guide](coolify/README.md) for the container, persistent
SQLite volume, required runtime variables, and deployment procedure.

## Development

Run the API and web client in separate terminals:

```sh
npm run dev
npm run dev:web
```

The API listens on `127.0.0.1:3000` by default. Vite serves the web client and
proxies `/api` requests to it. API startup applies pending Drizzle migrations
before serving. A network deployment can override `API_HOST`, but must define an
authorization policy plus quotas, request-size limits, and concurrency controls
at its gateway before exposing the API.

The API port can be overridden with `PORT`. The Vite port and proxy target can
be overridden with `VITE_PORT` and `VITE_API_TARGET`; Vite exits instead of
silently choosing another port when the configured port is occupied.

### Worktrees

Create an isolated worktree and branch from the current commit with:

```sh
npm run worktree:create -- codex/my-change
```

Pass a second argument to use another start point, or name an existing local
branch to attach it instead:

```sh
npm run worktree:create -- codex/my-change origin/main
```

Worktrees live under the `main` worktree's `.worktrees/` directory. The command
reserves a unique API/Vite port pair, copies the `main` worktree's ignored
`src/api/.env` without printing its secrets, sets the matching
`BETTER_AUTH_URL`, and creates `src/web/.env` with the Vite port and API proxy
target. The command fails if `main` is not checked out in a worktree or its API
environment file does not exist.

From the new worktree, start the API and web client in separate terminals as
usual:

```sh
npm run dev
npm run dev:web
```

## Text streams

Each LLM generation is a retained stream identified by a UUID:

1. `POST /api/streams` starts generation immediately and returns `{ "id": "<uuid>" }`.
2. `GET /api/streams/:id` returns NDJSON events, replaying everything buffered before following live output.

Stream events are `reasoning`, `text`, `error`, and `done`. Reads are non-destructive, so reconnects and concurrent readers receive the same retained history.

Live deltas are retained in memory. When generation terminates, complete text and reasoning are written once to SQLite and remain replayable after restart. See [the full streaming contract](src/api/routes/docs/text-streaming.md).

## Deep search

Open `/deep-search` to start a deep-search job or reopen a previous one. Creation
generates a short title and returns both its internal UUID and readable slug.
Browser and detail URLs use the slug; `GET
/api/deep-search-jobs/:deepSearchJobId/events` keeps using the internal UUID to
replay and follow the NDJSON feed.

After the page summaries settle, every executed query receives a query-level Markdown synthesis. All returned results are included: successfully explored results contribute their full page summaries, while unselected results and failed extractions fall back to their search descriptions. The synthesis receives one uniform content field and is not told which form was used.

The page displays the research request, generated queries, result-selection output, model reasoning, query summaries, and page summaries. Results are grouped by executed search query. Sources explored in depth are distinguished from listings represented by their search descriptions. Queries and results are priority ordered; the client currently runs at most three searches and explores at most three results per search.

The history page lists durable jobs newest first. Structural progress is stored in normalized typed SQLite tables; no JSON snapshot or event log is stored. See [the deep-search job contract](src/api/routes/docs/deep-search-jobs.md).

## Ideas

Open `/ideas` and enter a prompt to start a researched idea run. The UI requests
12 ideas by default, and the API accepts 6 through 100 through
`numberOfIdeas`. Runs use two parallel deep searches by default; the API also
accepts `deepSearchCount`, `maxSearches`, and `maxResultsPerSearch`.

The pipeline uses six visible phases:

1. One planning generation creates exactly one distinct prompt per requested deep search.
2. Every deep search starts in parallel. Its existing `/deep-search/:id` page opens in a new tab from the Ideas run.
3. A fresh generation combines only the child searches' final-answer text into one research briefing.
4. A fresh generation receives the user prompt and briefing, then streams the requested title-and-description ideas.
5. Every persisted idea receives an independent critique using the original
   request and final research briefing. Critiques start concurrently, and the
   pipeline waits for all of them to settle.
6. One structured selector receives the request, briefing, every idea, and each
   critique's final text. It returns an unordered, unique, even set of 6 through
   100 idea IDs. The UI retains the selector's reasoning and marks every idea as
   selected or rejected.

The run is all-or-nothing: a planning, child-search, summary, idea-generation,
critique, or selection failure fails the parent run and prevents later stages.
Individual blocked, challenged, paywalled, unavailable, or unsupported pages
remain non-fatal inside a child search because their search snippets can still
support its synthesis.

Runs and their generated output are durable and appear newest first under "Previous idea runs." See [the idea-job contract](src/api/routes/docs/idea-jobs.md).

## Debates

Open `/debates` to run the researched idea pipeline and an automatic tournament.
The generated candidate count defaults to 12 and is configurable from 6 through
100. Only ideas admitted by the selector enter the tournament.

Every admitted idea plays five Swiss rounds without repeat opponents; losing a
Swiss match does not eliminate it. Later-round matchmaking uses deterministic
score-ordered backtracking, which finds the first complete non-repeating round
without attempting the factorial exhaustive search that becomes impossible for
large fields. The top four by wins, Elo, two-way head-to-head, and seeded order
advance to two semifinals and one final.

Match transcripts, verdicts, standings, and the final winner are durable. The
selected field produces `5 × ideas ÷ 2 + 3` matches, so the minimum six-idea run
contains 18 matches and the default 12-idea run contains 33. See [the debate-job
contract](src/api/routes/docs/debate-jobs.md).

## Verification

Run the local quality gate:

```sh
npm run gatekeep
```

This runs linting, typechecking, unused-code analysis, and unit/integration tests.

ESLint uses type-aware TypeScript rules and rejects deprecated APIs. React rules apply to the web workspace, Vitest rules apply to `*.test.ts(x)`, and Playwright rules apply to `src/web/e2e`.

Run or build Storybook to inspect isolated component states and full-page fixtures:

```sh
npm run storybook
npm run storybook:build
```

The Deep Search stories include standalone streaming, completed, and failed search findings and source findings, plus page-level result fixtures for the summary-first hierarchy. The Ideas stories cover planning, active research, idea generation, and a completed run.

Run the end-to-end test separately:

```sh
npm run test:e2e
```

The E2E tests start isolated API and Vite servers with a migrated temporary SQLite database. Deterministic process-level mocks replace only outbound DeepSeek, SearXNG, and ScrapingAnt responses; the Hono routes, extraction pipeline, persistence, NDJSON streams, React UI, replay, and history remain real. The Deep Search scenario covers query generation through final synthesis. The Ideas scenario covers planning, parallel child searches, research summarization, exact-count idea generation, child-search links, durable replay, and history. No provider credentials or network access are required.
