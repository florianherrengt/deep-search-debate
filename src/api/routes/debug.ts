import type { Hono } from "hono"
import { extractPage } from "deep-search-core/search-extract"
import { z } from "zod"
import { extractDeps } from "../web_search/webExtract.ts"
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

const debugExtractQuerySchema = z.object({
  url: z.string().url(),
})

const debugExtractResponseSchema = z.object({
  url: z.string(),
  content: z.string(),
  contentLength: z.number(),
  summary: z.string().optional(),
  method: z.enum(["fetch", "render", "custom"]),
  usedCustomExtractor: z.boolean(),
  extractorName: z.string().optional(),
  warnings: z.array(z.string()),
  htmlLength: z.number(),
})

export function debug(app: Hono) {
  app.get("/debug/search", async (c) => {
    const parsed = debugSearchQuerySchema.parse({ query: c.req.query("query") })
    const results = await webSearch(parsed)
    return c.json(debugSearchResponseSchema.parse({ results }))
  })

  app.get("/debug/extract", async (c) => {
    const parsed = debugExtractQuerySchema.parse({ url: c.req.query("url") })
    try {
      const result = await extractPage(parsed.url, undefined, extractDeps)
      return c.json(
        debugExtractResponseSchema.parse({
          url: result.url,
          content: result.content,
          contentLength: result.content.length,
          summary: result.summary,
          method: result.method,
          usedCustomExtractor: result.usedCustomExtractor,
          extractorName: result.extractorName,
          warnings: result.warnings ?? [],
          htmlLength: result.html?.length ?? 0,
        }),
      )
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const stack = error instanceof Error ? error.stack : undefined
      return c.json({ error: message, stack }, 500)
    }
  })
}
