import { zValidator } from "@hono/zod-validator"
import type { Hono } from "hono"
import { extractPage } from "deep-search-core/search-extract"
import z from "zod"
import { extractDeps } from "../web_search/webExtract.ts"
import { webSearch } from "../web_search/index.ts"

const debugSearchQuerySchema = z.object({
  query: z.string(),
})

const debugExtractQuerySchema = z.object({
  url: z.url(),
})

export function debug(app: Hono) {
  app.get(
    "/debug/search",
    zValidator("query", debugSearchQuerySchema),
    async (c) => {
      const results = await webSearch(c.req.valid("query"))
      return c.json({ results })
    },
  )

  app.get(
    "/debug/extract",
    zValidator("query", debugExtractQuerySchema),
    async (c) => {
      const { url } = c.req.valid("query")
      try {
        const result = await extractPage(url, undefined, extractDeps)
        return c.json({
          url: result.url,
          content: result.content,
          contentLength: result.content.length,
          summary: result.summary,
          method: result.method,
          usedCustomExtractor: result.usedCustomExtractor,
          extractorName: result.extractorName,
          warnings: result.warnings ?? [],
          htmlLength: result.html?.length ?? 0,
        })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        const stack = error instanceof Error ? error.stack : undefined
        return c.json({ error: message, stack }, 500)
      }
    },
  )
}
