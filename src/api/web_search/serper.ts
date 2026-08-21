import PQueue from "p-queue"
import z from "zod"
import { config } from "../config.ts"
import { addAbortableQueueTask } from "../helpers/addAbortableQueueTask.ts"
import { createBoundedFetch } from "./boundedFetch.ts"
import {
  MAX_WEB_SEARCH_RESULTS,
  normalizeWebSearchResults,
  type WebSearchResult,
} from "./types.ts"

const serperSearchResponseSchema = z.object({
  organic: z.array(
    z.object({
      title: z.string(),
      snippet: z.string().optional().default(""),
      link: z.string(),
    }),
  ).optional().default([]),
})

const boundedFetch = createBoundedFetch(
  config.webSearch.maxResponseBytes,
  (input, init) => globalThis.fetch(input, init),
)

const searchQueue = new PQueue({
  interval: 1_000,
  intervalCap: config.webSearch.serper.maxQueriesPerSecond,
  strict: true,
})

export async function serper(params: {
  query: string
  signal?: AbortSignal
}): Promise<WebSearchResult[]> {
  const apiKey = config.webSearch.serper.apiKey
  if (apiKey === undefined) throw new Error("Serper is not configured")

  return addAbortableQueueTask(
    searchQueue,
    async () => {
      const response = await boundedFetch("https://google.serper.dev/search", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-API-KEY": apiKey,
        },
        body: JSON.stringify({ q: params.query, num: MAX_WEB_SEARCH_RESULTS }),
        signal: params.signal,
      })

      if (!response.ok) {
        throw new Error(
          `Serper search failed with status ${response.status} ${response.statusText}`,
        )
      }

      const parsedResponse = serperSearchResponseSchema.safeParse(
        await response.json(),
      )
      if (!parsedResponse.success) {
        throw new Error("Serper returned an invalid search response", {
          cause: parsedResponse.error,
        })
      }

      return normalizeWebSearchResults(
        parsedResponse.data.organic.map((result) => ({
          title: result.title,
          shortText: result.snippet,
          link: result.link,
        })),
      )
    },
    params.signal,
  )
}
