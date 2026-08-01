import z from "zod"
import { generateSearchResults } from "./queries.ts"
import { deepSearchInputSchema } from "./schemas.ts"
import { selectSearchResults } from "./selection.ts"
import { startPageSummary } from "./summaries.ts"

export type { DeepSearchEvent } from "./schemas.ts"

/**
 * Runs the deep-search pipeline and emits progress events as each stage starts or
 * completes. It returns once every selected page has registered a summary stream
 * or emitted a non-fatal page error; the registered streams continue independently.
 */
export const deepSearch = z
  .function()
  .input(z.tuple([deepSearchInputSchema]))
  .output(z.void())
  .implementAsync(async (params) => {
    const searchResults = await generateSearchResults(params)
    params.onEvent({ type: "search-results", searches: searchResults })

    const summarizedUrls = new Set<string>()
    const pageSummaryTasks: Promise<void>[] = []
    for (const search of searchResults) {
      const selected = await selectSearchResults({
        researchRequest: params.researchRequest,
        maxResultsPerSearch: params.maxResultsPerSearch,
        search,
        onEvent: params.onEvent,
      })

      params.onEvent({
        type: "selected-search-results",
        query: selected.query,
        selectedLinks: selected.selectedLinks,
      })

      for (const url of selected.selectedLinks) {
        if (summarizedUrls.has(url)) continue
        summarizedUrls.add(url)
        pageSummaryTasks.push(startPageSummary({ ...params, url }))
      }
    }

    await Promise.all(pageSummaryTasks)
  })
