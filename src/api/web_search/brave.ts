import { createBraveSearch } from "deep-search-core/search-extract"
import { config } from "../config.ts"
import { createBoundedFetch } from "./boundedFetch.ts"
import {
  normalizeWebSearchResults,
  type WebSearchResult,
} from "./types.ts"

const search =
  config.webSearch.brave.apiKey === undefined
    ? undefined
    : createBraveSearch({
        apiKey: config.webSearch.brave.apiKey,
        fetch: createBoundedFetch(
          config.webSearch.maxResponseBytes,
          (input, init) => globalThis.fetch(input, init),
        ),
      })

export async function brave(params: {
  query: string
  signal?: AbortSignal
}): Promise<WebSearchResult[]> {
  if (search === undefined) throw new Error("Brave Search is not configured")
  const results = await search(params.query, params.signal)
  return normalizeWebSearchResults(
    results.map((result) => ({
      title: result.title,
      shortText: result.description,
      link: result.url,
    })),
  )
}
