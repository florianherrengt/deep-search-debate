import { zValidator } from "@hono/zod-validator"
import type { Hono } from "hono"
import z from "zod"
import { webExtract } from "../web_search/webExtract.ts"
import { webSearch } from "../web_search/index.ts"
import type { AppEnv } from "../types/auth.ts"

const debugSearchQuerySchema = z.object({
  query: z.string(),
})

const debugExtractQuerySchema = z.object({
  url: z.url(),
})

export function debug(app: Hono<AppEnv>) {
  app.use("/debug/*", async (c, next) => {
    if (!c.get("isDebugUser")) {
      return c.json({ error: "Not found" }, 404)
    }
    await next()
  })

  app.get(
    "/debug/search",
    zValidator("query", debugSearchQuerySchema),
    async (c) => {
      try {
        const results = await webSearch(c.req.valid("query"))
        return c.json({ results })
      } catch (error) {
        console.error("Debug search failed", error)
        return c.json({ error: "Search failed" }, 500)
      }
    },
  )

  app.get(
    "/debug/extract",
    zValidator("query", debugExtractQuerySchema),
    async (c) => {
      const { url } = c.req.valid("query")
      try {
        const result = await webExtract({ url })
        return c.json({
          url: result.url,
          content: result.content,
          contentLength: result.content.length,
          retrievalMethod: result.retrievalMethod,
        })
      } catch (error) {
        console.error("Debug extraction failed", error)
        return c.json({ error: "Extraction failed" }, 500)
      }
    },
  )
}
