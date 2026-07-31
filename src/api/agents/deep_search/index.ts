import z from "zod"
import { generateWebSearchQueries } from "../../llms/generateWebSearchQueries.ts"
import { selectWebSearchResults } from "../../llms/selectWebSearchResults.ts"
import { webSearch } from "../../web_search/index.ts"
import { webExtract } from "../../web_search/webExtract.ts"

const searchResultSchema = z.object({
  title: z.string(),
  shortText: z.string(),
  link: z.string(),
})

const extractedPageSchema = z.object({
  url: z.string(),
  content: z.string(),
})

export const deepSearch = z
  .function()
  .input(
    z.tuple([
      z.object({
        researchRequest: z.string(),
      }),
    ]),
  )
  .output(
    z.array(
      z.object({
        query: z.string(),
        results: z.array(searchResultSchema),
        extractedPages: z.array(extractedPageSchema),
      }),
    ),
  )
  .implementAsync(async (params) => {
    const queries = await generateWebSearchQueries(params)

    const searchResults = await Promise.all(
      queries.map(async (query) => {
        const results = await webSearch({ query })

        const withIds = results.map((r, i) => ({
          id: `result-${i}`,
          title: r.title,
          url: r.link,
          snippet: r.shortText,
        }))

        const selectedIds = await selectWebSearchResults({
          userQuery: params.researchRequest,
          searchQuery: query,
          results: withIds,
        })

        const idToUrl = new Map(withIds.map((r) => [r.id, r.url]))
        const selectedUrls = selectedIds
          .map((id) => idToUrl.get(id))
          .filter((url): url is string => url != null)

        const extractedPages = await Promise.all(
          selectedUrls.map(async (url) => {
            try {
              return await webExtract({ url })
            } catch {
              return { url, content: "" }
            }
          }),
        )

        return { query, results, extractedPages }
      }),
    )

    return searchResults
  })
