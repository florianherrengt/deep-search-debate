import z from "zod"
import { generateWebSearchQueries } from "../../llms/generateWebSearchQueries.ts"
import { webSearch } from "../../web_search/index.ts"

const searchResultSchema = z.object({
  title: z.string(),
  shortText: z.string(),
  link: z.string(),
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
      }),
    ),
  )
  .implementAsync(async (params) => {
    const queries = await generateWebSearchQueries(params)

    const searchResults = await Promise.all(
      queries.map(async (query) => {
        const results = await webSearch({ query })
        return { query, results }
      }),
    )

    return searchResults
  })
