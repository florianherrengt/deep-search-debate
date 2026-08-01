# Deep Search Debate

An npm workspaces monorepo with a Hono API and a Vite/React web client.

## Requirements

- Node.js 22 or newer
- A DeepSeek API key
- A running SearXNG instance
- A ScrapingAnt API key for rendered page extraction

Create `src/api/.env` with:

```dotenv
DEEPSEEK_API_KEY=your-key
SEARXNG_URL=http://127.0.0.1:8090
SCRAPINGANT_API_KEY=your-key
DATABASE_URL=data.db
```

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

The API runs on port 3000. Vite serves the web client and proxies `/api` requests to it.

## Text streams

Each LLM generation is a retained stream identified by a UUID:

1. `POST /api/streams` starts generation immediately and returns `{ "id": "<uuid>" }`.
2. `GET /api/streams/:id` returns NDJSON events, replaying everything buffered before following live output.

Stream events are `reasoning`, `text`, `error`, and `done`. Reads are non-destructive, so reconnects and concurrent readers receive the same retained history.

The registry is currently in memory. Streams survive reader disconnects but are lost when the API process restarts. See [the full streaming contract](src/api/routes/docs/text-streaming.md).

## Deep search

Open `/deep-search` to start a deep-search job. `POST /api/deep-search` returns its UUID immediately, and `GET /api/deep-search/:id` replays and follows the job's NDJSON events. The pipeline generates search queries, searches through SearXNG, selects results for extraction, and streams summaries of the selected pages.

After the page summaries settle, every executed query receives a query-level Markdown synthesis. All returned results are included: successfully explored results contribute their full page summaries, while unselected results and failed extractions fall back to their search descriptions. The synthesis receives one uniform content field and is not told which form was used.

The page follows the LLM streams for query generation, result selection, page summaries, and query summaries. Each result group is collapsible, with its query summary above the detailed results and subtle green or red borders distinguishing selected and rejected results. Queries and results are priority ordered; the client currently runs at most three searches and selects at most three results per search.

Deep-search jobs are also retained only for the lifetime of the API process. See [the deep-search job contract](src/api/routes/docs/deep-search-jobs.md).

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

The Deep Search stories include standalone streaming, completed, and failed query summaries, plus page-level result fixtures.

Run the end-to-end test separately:

```sh
npm run test:e2e
```

The E2E tests start isolated API and Vite servers. They exercise real DeepSeek query generation, selection, page summarization, and query synthesis plus SearXNG search and page extraction. They consume live streams and job feeds, then verify rendered selections, mixed-result query summaries, and replayed events. Valid API configuration and network access are required; no LLM, search, extraction, or HTTP responses are mocked.
