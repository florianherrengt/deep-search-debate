import { createSearXNGFetchSearch } from "deep-search-core/search-extract"
import { config } from "../config.ts"

export type WebSearchResult = {
  title: string
  shortText: string
  link: string
}

const search = createSearXNGFetchSearch({
  baseUrl: config.webSearch.searxng.url,
  fetch: (input, init) => globalThis.fetch(input, init),
})

export async function searxng(params: {
  query: string
}): Promise<WebSearchResult[]> {
  const results = await search(params.query)
  return results.map((result) => ({
    title: result.title,
    shortText: result.description,
    link: result.url,
  }))
}
