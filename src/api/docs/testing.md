# API testing

- vitest; test files use the `.test.ts` suffix. Web uses `.test.tsx`.
- **Single test file:** run `npx vitest run <file>` inside the relevant workspace, or `npm run test:watch -w @deep-search-debate/api`.
- API tests run against an in-memory SQLite (`DATABASE_URL=:memory:`) with stubbed env, so no external services or real keys are required.

## Module mocks must include the `.ts` extension

Because the API executes TypeScript directly (see `runtime.md`), source imports use `.ts` extensions. Test mocks must match, or the mock won't intercept the import:

```ts
vi.mock("../web_search/index.ts", () => ({
  webSearch: vi.fn(),
}))
```

Use the exact same path (including `.ts`) as the `import` statement under test.
