# Deep Search Debate

An npm workspaces monorepo with a Hono API and a Vite/React web client.

## Requirements

- Node.js 22 or newer
- A DeepSeek API key
- A running SearXNG instance

Create `src/api/.env` with:

```dotenv
DEEPSEEK_API_KEY=your-key
SEARXNG_URL=http://localhost:8080
DATABASE_URL=data.db
```

Install dependencies with `npm install`.

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

## Verification

Run the local quality gate:

```sh
npm run gatekeep
```

This runs linting, typechecking, unused-code analysis, and unit/integration tests.

Run the end-to-end test separately:

```sh
npm run test:e2e
```

The E2E test starts isolated API and Vite servers, makes a real DeepSeek request, consumes the live stream, and verifies that a later API read replays the same events. It requires valid API configuration and network access; no LLM or HTTP responses are mocked.
