import { createSearXNGFetchSearch } from "deep-search-core/search-extract"
import { config } from "../config.ts"
import { webSearchResultsSchema, type WebSearchResult } from "./types.ts"

const search =
  config.webSearch.searxng.url === undefined
    ? undefined
    : createSearXNGFetchSearch({
        baseUrl: config.webSearch.searxng.url,
        fetch: (input, init) => globalThis.fetch(input, init),
      })

export async function searxng(params: {
  query: string
}): Promise<WebSearchResult[]> {
  if (search === undefined) throw new Error("SearXNG is not configured")
  const results = await search(params.query)
  return webSearchResultsSchema.parse(
    results.map((result) => ({
      title: result.title,
      shortText: result.description,
      link: result.url,
    })),
  )
}
