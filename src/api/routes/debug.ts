import type { Hono } from "hono"
import { z } from "zod"
import { webSearch } from "../web_search/index.ts"

const debugSearchQuerySchema = z.object({
  query: z.string(),
})

const debugSearchResponseSchema = z.object({
  results: z.array(
    z.object({
      title: z.string(),
      shortText: z.string(),
      link: z.string(),
    }),
  ),
})

export function debug(app: Hono) {
  app.get("/debug/search", async (c) => {
    const parsed = debugSearchQuerySchema.parse({ query: c.req.query("query") })
    const results = await webSearch(parsed)
    return c.json(debugSearchResponseSchema.parse({ results }))
  })
}
