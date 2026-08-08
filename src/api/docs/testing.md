# API testing

- vitest; test files use the `.test.ts` suffix. Web uses `.test.tsx`.
- **Single test file:** run `npx vitest run <file>` inside the relevant workspace, or `npm run test:watch -w @rethinkloop/api`.
- API tests run against an in-memory SQLite (`DATABASE_URL=:memory:`) with stubbed env, so no external services or real keys are required.
- Vitest supplies fake provider and auth secrets through `vitest.config.ts`; tests must never read operator credentials.

## Module mocks must include the `.ts` extension

Because the API executes TypeScript directly (see `runtime.md`), source imports use `.ts` extensions. Test mocks must match, or the mock won't intercept the import:

```ts
vi.mock("../web_search/index.ts", () => ({
  webSearch: vi.fn(),
}))
```

Use the exact same path (including `.ts`) as the `import` statement under test.

## Browser E2E tests

Playwright starts the real API and Vite app on dedicated ports. `src/api/e2e/mockExternalServices.mjs` is loaded into the API process through `NODE_OPTIONS`; before application imports, it creates a unique migrated SQLite database in the OS temp directory and sets `DATABASE_URL` for that process. This test bootstrap is an intentional direct environment write because it must run before `config.ts` is imported. Fake provider and auth secrets are supplied by `src/web/playwright.config.ts`.

The same preload replaces only outbound DeepSeek, SearXNG, and page HTTP responses. Unrecognized outbound requests fail the test instead of reaching the network.

Do not mock Hono routes or browser API requests in these scenarios. The tests must continue to exercise real database writes, stream/event managers, extraction orchestration, NDJSON subscriptions, reducers, replay, and history. Provider-specific response fixtures belong in the preload module.
