# API runtime gotchas

High-signal facts about how the API starts and runs. Getting these wrong is the most common source of breakage.

## No build step

The API runs TypeScript directly via `node --experimental-strip-types`. Consequences:

- Imports keep the `.ts` extension **at runtime**, e.g. `./index.ts` (not `./index`). `allowImportingTsExtensions` is enabled in the api `tsconfig.json`.
- Do **not** strip extensions, add path alias rewrites, or introduce a compile/build step.
- Requires Node 22+ (the `--experimental-strip-types` flag).

## Required env vars throw at import time

`src/api/config.ts` throws on import if `SEARXNG_URL`, `DEEPSEEK_API_KEY`, or `SCRAPINGANT_API_KEY` is missing or empty. Copy the tracked `src/api/.env.example` to the ignored `src/api/.env`, then replace its provider-key placeholders before `npm run dev` / `npm run start` will boot. The API `vitest.config.ts` injects the required values, so tests pass without real credentials.

## Real external services in dev

A SearXNG instance, a DeepSeek API key, and a ScrapingAnt API key are real runtime dependencies, not mocked outside tests:

- **SearXNG:** HTTP `/search?format=json`. Configure its URL via `SEARXNG_URL`.
- **DeepSeek:** used by the LLM layer (`src/api/llms/`). Key via `DEEPSEEK_API_KEY`.
- **ScrapingAnt:** headless-browser renderer used for page extraction. Without it the Reddit/Amazon/Shopify/Trustpilot/GitHub/YouTube/Hacker News custom extractors can't run (they require a renderer), and any page whose plain-fetch text falls under ~200 chars falls back to a ScrapingAnt render. Key via `SCRAPINGANT_API_KEY`. Renders are serialized for the free-plan concurrency cap. HTTP 423 anti-bot detections are retried twice with exponential backoff by default; configure this with `SCRAPINGANT_MAX_RETRIES` and `SCRAPINGANT_RETRY_DELAY_MS`. `SCRAPINGANT_PROXY_TYPE` defaults to `datacenter`; `residential` has a higher success rate on protected sites and a much higher credit cost.

## Network binding

The API binds to `127.0.0.1` by default through `API_HOST`. This keeps the
unauthenticated local development API and its paid provider integrations off the
LAN. A deployment may override the host only when authentication, quotas,
request-size limits, and concurrency controls are enforced by its gateway.
