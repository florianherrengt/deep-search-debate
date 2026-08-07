import { createBraveSearch } from "deep-search-core/search-extract"
import { config } from "../config.ts"
import { webSearchResultsSchema, type WebSearchResult } from "./types.ts"

const search =
  config.webSearch.brave.apiKey === undefined
    ? undefined
    : createBraveSearch({
        apiKey: config.webSearch.brave.apiKey,
        fetch: (input, init) => globalThis.fetch(input, init),
      })

export async function brave(params: {
  query: string
}): Promise<WebSearchResult[]> {
  if (search === undefined) throw new Error("Brave Search is not configured")
  const results = await search(params.query)
  return webSearchResultsSchema.parse(
    results.map((result) => ({
      title: result.title,
      shortText: result.description,
      link: result.url,
    })),
  )
}
