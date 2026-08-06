import { createSearXNGFetchSearch } from "deep-search-core/search-extract"
import z from "zod"
import { config } from "../config.ts"

const webSearchResultsSchema = z.array(
  z.object({
    title: z.string().trim().min(1),
    shortText: z.string().trim().min(1),
    link: z.url(),
  }),
)

export type WebSearchResult = z.infer<typeof webSearchResultsSchema>[number]

const search = createSearXNGFetchSearch({
  baseUrl: config.webSearch.searxng.url,
  fetch: (input, init) => globalThis.fetch(input, init),
})

export async function searxng(params: {
  query: string
}): Promise<WebSearchResult[]> {
  const results = await search(params.query)
  return webSearchResultsSchema.parse(
    results.map((result) => ({
      title: result.title,
      shortText: result.description,
      link: result.url,
    })),
  )
}
