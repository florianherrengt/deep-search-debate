# API coding standards

Conventions that hold across the API. Follow existing patterns rather than introducing alternatives.

## Zod is the validation layer

[Zod 4](https://zod.dev) is the single source of truth for runtime validation and parsing on the API. Use it for:

- request body parsing — `const Body = z.object({...}); const body = Body.parse(await c.req.json())`
- response shape validation — `c.json(ResponseSchema.parse(payload))`
- config schemas and LLM structured output (e.g. `Output.array({ element: z.string() })`)

Prefer the **default import**:

```ts
import z from "zod"
```

This is the majority style in the codebase. Don't mix in `import { z } from "zod"`.

### Type-safe functions via `z.function`

Domain functions are defined as input/output-validated implementations rather than plain `async` functions:

```ts
export const webSearch = z
  .function()
  .input(z.tuple([z.object({ query: z.string() })]))
  .output(z.array(webSearchResultSchema))
  .implementAsync(async (params) => { /* ... */ })
```

This pattern (`z.function().input(...).output(...).implementAsync(...)`) is used for `webSearch`, `searxng`, `generateWebSearchQueries`, and `generateTextStream`. Follow it for new domain/service functions so their inputs and outputs stay runtime-validated and the types are inferred from the schemas.

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
