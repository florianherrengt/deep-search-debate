import { createSearXNGFetchSearch } from "deep-search-core/search-extract"
import PQueue from "p-queue"
import { config } from "../config.ts"
import { addAbortableQueueTask } from "../helpers/addAbortableQueueTask.ts"
import { createBoundedFetch } from "./boundedFetch.ts"
import {
  normalizeWebSearchResults,
  type WebSearchResult,
} from "./types.ts"

const boundedFetch = createBoundedFetch(
  config.webSearch.maxResponseBytes,
  (input, init) => globalThis.fetch(input, init),
)

const search =
  config.webSearch.searxng.url === undefined
    ? undefined
    : createSearXNGFetchSearch({
        baseUrl: config.webSearch.searxng.url,
        fetch: (input, init) => {
          const inputUrl = input instanceof Request ? input.url : input.toString()
          const url = new URL(inputUrl)
          url.searchParams.set(
            "categories",
            config.webSearch.searxng.categories.join(","),
          )
          return boundedFetch(url, init)
        },
      })

const searchQueue = new PQueue({
  concurrency: config.webSearch.searxng.maxConcurrentRequests,
  ...(config.webSearch.searxng.minIntervalMs > 0
    ? {
        interval: config.webSearch.searxng.minIntervalMs,
        intervalCap: 1,
        carryoverConcurrencyCount: true,
      }
    : {}),
})

export async function searxng(params: {
  query: string
  signal?: AbortSignal
}): Promise<WebSearchResult[]> {
  if (search === undefined) throw new Error("SearXNG is not configured")
  const results = await addAbortableQueueTask(
    searchQueue,
    () => search(params.query, params.signal),
    params.signal,
  )
  const mappedResults = results.map((result) => ({
    title: result.title,
    shortText: result.description,
    link: result.url,
  }))
  // Results without snippets cannot provide fallback evidence. Unsupported or
  // duplicate URLs are likewise omitted before anything reaches persistence.
  return normalizeWebSearchResults(mappedResults)
}
