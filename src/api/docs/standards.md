# API coding standards

Conventions that hold across the API. Follow existing patterns rather than introducing alternatives.

## Validate at trust boundaries

[Zod 4](https://zod.dev) is the single source of truth for runtime validation and parsing on the API. Use it for:

- request bodies, query strings, and route parameters via `@hono/zod-validator`
- untrusted third-party responses and persisted JSON
- config schemas and LLM structured output (e.g. `Output.array({ element: z.string() })`)

Use ordinary TypeScript types for values passed between trusted in-process modules.
Do not wrap internal functions, callbacks, maps, iterators, or objects in
`z.function()` or `z.custom()` merely to repeat compile-time types at runtime.
Validate once when data enters the application, then pass the parsed value through
typed functions.

Prefer the **default import**:

```ts
import z from "zod"
```

This is the majority style in the codebase. Don't mix in `import { z } from "zod"`.

### Hono request validation

Use `zValidator` as route middleware and read the parsed value with
`c.req.valid(...)`:

```ts
app.post(
  "/streams",
  zValidator("json", createTextStreamInputSchema),
  async (c) => {
    const input = c.req.valid("json")
    // ...
  },
)
```

Response schemas are useful when validating untrusted data or documenting a public
contract. Do not parse constants or objects assembled entirely from already typed
values immediately before passing them to `c.json()`.

## Hono routes

Every route module exports a function that takes the app and registers its handlers:

```ts
import type { Hono } from "hono"

export function streams(app: Hono) {
  app.post("/streams", async (c) => { /* ... */ })
}
```

- Use `import type { Hono } from "hono"` (type-only) for the parameter — never a value import.
- The function is mounted in `src/api/index.ts` by calling it with the basePath app: `chat(api)`. All routes live under `/api`; don't add a second basePath.

## Type-only imports

Use `import type { ... }` for types-only imports (see the `Hono` convention above). Inline type specifiers (`import { foo, type Bar }`) are also fine.

## Cross-workspace boundary

The web workspace stays **deliberately decoupled** from the api workspace — no cross-workspace imports. Shared shapes are mirrored by hand as plain TS types on the web side (e.g. the stream event types in `src/web/lib/textStreams.ts`). Don't add a dependency from web → api; update both sides when the contract changes.
