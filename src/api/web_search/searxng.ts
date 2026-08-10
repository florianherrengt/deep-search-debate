import { createSearXNGFetchSearch } from "deep-search-core/search-extract"
import { config } from "../config.ts"
import { webSearchResultsSchema, type WebSearchResult } from "./types.ts"

const resultIdentitySchema = webSearchResultsSchema.element.omit({
  shortText: true,
})

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
  const mappedResults = results.map((result) => ({
    title: result.title,
    shortText: result.description,
    link: result.url,
  }))
  // Snippet absence is allowed by SearXNG, but malformed identity fields are
  // still provider-contract violations and must not be silently discarded.
  for (const result of mappedResults) resultIdentitySchema.parse(result)
  return webSearchResultsSchema.parse(
    mappedResults
      // SearXNG legitimately includes results without snippets. They cannot
      // provide the fallback evidence required when page extraction fails, so
      // omit them at the provider boundary instead of rejecting usable peers.
      .filter((result) => result.shortText.trim().length > 0),
  )
}
