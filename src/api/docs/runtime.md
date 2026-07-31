# API runtime gotchas

High-signal facts about how the API starts and runs. Getting these wrong is the most common source of breakage.

## No build step

The API runs TypeScript directly via `node --experimental-strip-types`. Consequences:

- Imports keep the `.ts` extension **at runtime**, e.g. `./index.ts` (not `./index`). `allowImportingTsExtensions` is enabled in the api `tsconfig.json`.
- Do **not** strip extensions, add path alias rewrites, or introduce a compile/build step.
- Requires Node 22+ (the `--experimental-strip-types` flag).

## Required env vars throw at import time

`src/api/config.ts` throws on import if `SEARXNG_URL` or `DEEPSEEK_API_KEY` is missing or empty. The committed `.env` is a stub (empty key, no `SEARXNG_URL`) — fill both before `npm run dev` / `npm run start` will boot. The api `vitest.config.ts` injects both, so tests pass without real values.

## Real external services in dev

A SearXNG instance and a DeepSeek API key are real runtime dependencies, not mocked outside tests:

- **SearXNG:** HTTP `/search?format=json`. Configure its URL via `SEARXNG_URL`.
- **DeepSeek:** used by the LLM layer (`src/api/llms/`). Key via `DEEPSEEK_API_KEY`.
