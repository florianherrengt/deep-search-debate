# Deep Search Debate

An npm workspaces monorepo with a Hono API and a Vite/React web client.

## Requirements

- Node.js 22 or newer
- A DeepSeek API key
- A running SearXNG instance
- A ScrapingAnt API key for rendered page extraction
- A GitHub OAuth app

Create the ignored local environment file from the tracked template:

```sh
cp src/api/.env.example src/api/.env
```

Then replace every placeholder in `src/api/.env`. The template contains:

```dotenv
NODE_ENV=development
DEEPSEEK_API_KEY=your-key
SEARXNG_URL=http://127.0.0.1:8090
SCRAPINGANT_API_KEY=your-key
SCRAPINGANT_PROXY_TYPE=datacenter
SCRAPINGANT_MAX_RETRIES=2
SCRAPINGANT_RETRY_DELAY_MS=1000
DATABASE_URL=data.db
API_HOST=127.0.0.1
PORT=3000
BETTER_AUTH_URL=http://localhost:5173
BETTER_AUTH_SECRET=replace-with-at-least-32-random-characters
GITHUB_CLIENT_ID=replace-with-your-github-oauth-client-id
GITHUB_CLIENT_SECRET=replace-with-your-github-oauth-client-secret
AUTH_DEBUG_USER_ENABLED=false
AUTH_DEBUG_USER_EMAIL=debug@local.invalid
AUTH_DEBUG_USER_PASSWORD=replace-with-a-local-debug-password
```

Configure the GitHub OAuth callback as
`http://localhost:5173/api/auth/callback/github`. Debug sign-in is optional and
is accepted only when both the API binding and `BETTER_AUTH_URL` are loopback
addresses.

Set `SCRAPINGANT_PROXY_TYPE=residential` for sites that repeatedly return HTTP
423 anti-bot detections. Residential browser renders use substantially more
ScrapingAnt credits than the default datacenter proxy.

Install dependencies with `npm install`.

Start the local SearXNG dependency with:

```sh
docker compose up -d searxng
```

The development Compose service listens only on `127.0.0.1:8090` and enables the JSON search format used by the API.

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

## Text streams

Each LLM generation is a retained stream identified by a UUID:

1. `POST /api/streams` starts generation immediately and returns `{ "id": "<uuid>" }`.
2. `GET /api/streams/:id` returns NDJSON events, replaying everything buffered before following live output.

Stream events are `reasoning`, `text`, `error`, and `done`. Reads are non-destructive, so reconnects and concurrent readers receive the same retained history.

Live deltas are retained in memory. When generation terminates, complete text and reasoning are written once to SQLite and remain replayable after restart. See [the full streaming contract](src/api/routes/docs/text-streaming.md).

## Deep search

Open `/deep-search` to start a deep-search job or reopen a previous one. `POST /api/deep-search-jobs` returns its UUID immediately. `GET /api/deep-search-jobs/:deepSearchJobId/events` replays and follows the NDJSON feed. The UUID is also part of the browser URL.

After the page summaries settle, every executed query receives a query-level Markdown synthesis. All returned results are included: successfully explored results contribute their full page summaries, while unselected results and failed extractions fall back to their search descriptions. The synthesis receives one uniform content field and is not told which form was used.

The page displays the research request, generated queries, result-selection output, model reasoning, query summaries, and page summaries. Results are grouped by executed search query. Sources explored in depth are distinguished from listings represented by their search descriptions. Queries and results are priority ordered; the client currently runs at most three searches and explores at most three results per search.

The history page lists durable jobs newest first. Structural progress is stored in normalized typed SQLite tables; no JSON snapshot or event log is stored. See [the deep-search job contract](src/api/routes/docs/deep-search-jobs.md).

## Ideas

Open `/ideas` and enter a prompt to start a researched idea run. The current UI requests 12 ideas backed by two parallel deep searches. The API also accepts `numberOfIdeas`, `deepSearchCount`, `maxSearches`, and `maxResultsPerSearch`; the UI will expose those controls later.

The pipeline uses four visible stages:

1. One planning generation creates exactly one distinct prompt per requested deep search.
2. Every deep search starts in parallel. Its existing `/deep-search/:id` page opens in a new tab from the Ideas run.
3. A fresh generation combines only the child searches' final-answer text into one research briefing.
4. A fresh generation receives the user prompt and briefing, then streams the requested title-and-description ideas.

The run is all-or-nothing: a planning, child-search, summary, or idea-generation failure fails the parent run and prevents later stages. Individual blocked, challenged, paywalled, unavailable, or unsupported pages remain non-fatal inside a child search because their search snippets can still support its synthesis.

Runs and their generated output are durable and appear newest first under "Previous idea runs." See [the idea-job contract](src/api/routes/docs/idea-jobs.md).

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

The E2E tests start isolated API and Vite servers with a migrated temporary SQLite database. Deterministic process-level mocks replace only outbound DeepSeek, SearXNG, and page HTTP responses; the Hono routes, extraction pipeline, persistence, NDJSON streams, React UI, replay, and history remain real. The Deep Search scenario covers query generation through final synthesis. The Ideas scenario covers planning, parallel child searches, research summarization, exact-count idea generation, child-search links, durable replay, and history. No provider credentials or network access are required.
