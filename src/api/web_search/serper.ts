import { setTimeout as delay } from "node:timers/promises"
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
  ).optional(),
  retryAfter: z.number().nonnegative().optional(),
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

function isGoogleRedirect(link: string): boolean {
  try {
    const url = new URL(link)
    const hostname = url.hostname.replace(/\.+$/, "")
    return (hostname === "google.com" || hostname.endsWith(".google.com")) &&
      (url.pathname === "/goto" || url.pathname === "/goto/")
  } catch {
    return false
  }
}

export async function serper(params: {
  query: string
  signal?: AbortSignal
  deadlineSignal?: AbortSignal
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

      let responseBody: unknown = await response.json()
      const parsedResponse = serperSearchResponseSchema.safeParse(responseBody)
      if (!parsedResponse.success) {
        throw new Error("Serper returned an invalid search response", {
          cause: parsedResponse.error,
        })
      }

      let results = parsedResponse.data.organic ?? []
      try {
        while (results.some((result) => isGoogleRedirect(result.link))) {
          params.signal?.throwIfAborted()
          const resolvedResponse = await boundedFetch("https://google.serper.dev/resolve", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-API-KEY": apiKey,
            },
            // Serper requires the complete response, including provider metadata.
            body: JSON.stringify(responseBody),
            signal: params.signal,
          })
          if (!resolvedResponse.ok) break

          const resolvedBody: unknown = await resolvedResponse.json()
          const parsed = serperSearchResponseSchema.safeParse(resolvedBody)
          if (!parsed.success || !parsed.data.organic) break

          responseBody = resolvedBody
          results = parsed.data.organic
          if (!results.some((result) => isGoogleRedirect(result.link)) ||
            parsed.data.retryAfter === undefined) break

          // Waits share the search deadline; a zero retry hint must not busy-loop.
          await delay(
            Math.min(Math.max(1, parsed.data.retryAfter) * 1_000, config.webSearch.timeoutMs),
            undefined,
            { signal: params.signal },
          )
        }
      } catch {
        // Resolution is best-effort. Keep real URLs from the latest valid response.
      }
      // Only our search deadline permits partial success; caller cancellation wins.
      if (params.signal?.aborted && params.signal.reason !== params.deadlineSignal?.reason) {
        params.signal.throwIfAborted()
      }

      return normalizeWebSearchResults(
        results.filter((result) => !isGoogleRedirect(result.link)).map((result) => ({
          title: result.title,
          shortText: result.snippet,
          link: result.link,
        })),
      )
    },
    params.signal,
  )
}
