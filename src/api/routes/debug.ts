import type { Hono } from "hono"
import { z } from "zod"
import { webSearch } from "../web_search/index.ts"

const DebugSearchQuery = z.object({
  query: z.string(),
})

export const DebugSearchResponse = z.object({
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
    const parsed = DebugSearchQuery.parse({ query: c.req.query("query") })
    const results = await webSearch(parsed)
    return c.json(DebugSearchResponse.parse({ results }))
  })
}
