import { collectStreamText } from "../../helpers/index.ts"
import { answerResearchRequest } from "./finalAnswer.ts"
import { generateSearchResults } from "./queries.ts"
import { summarizeSearchQuery } from "./querySummaries.ts"
import type { DeepSearchInput } from "./schemas.ts"
import { selectSearchResults } from "./selection.ts"
import { startPageSummary } from "./summaries.ts"

export type { DeepSearchEvent } from "./schemas.ts"

/**
 * Runs the deep-search pipeline and emits progress events as each stage starts or
 * completes. It returns after query summaries resolve and the final-answer stream
 * has been registered; that final stream continues independently.
 */
export async function deepSearch(params: DeepSearchInput): Promise<void> {
  const maxSearches = params.maxSearches ?? 3
  const maxResultsPerSearch = params.maxResultsPerSearch ?? 3
  const searchResults = await generateSearchResults({
    ...params,
    maxSearches,
  })
  params.onEvent({ type: "search-results", searches: searchResults })

  const pageSummaryTasks = new Map<string, Promise<string | undefined>>()
  const selectedSearches = []
  for (const search of searchResults) {
    const selected = await selectSearchResults({
      researchRequest: params.researchRequest,
      maxResultsPerSearch,
      search,
      onEvent: params.onEvent,
      maxRetries: params.maxRetries,
    })

    params.onEvent({
      type: "selected-search-results",
      query: selected.query,
      selectedLinks: selected.selectedLinks,
    })
    selectedSearches.push(selected)

    for (const url of selected.selectedLinks) {
      if (pageSummaryTasks.has(url)) continue
      pageSummaryTasks.set(url, startPageSummary({ ...params, url }))
    }
  }

  const pageSummaries = new Map(
    await Promise.all(
      [...pageSummaryTasks].map(async ([url, task]) => {
        const summary = await task
        return [url, summary] as const
      }),
    ),
  )

  const searchSummaries = await Promise.all(
    selectedSearches.map(async (search) => {
      const streamId = await summarizeSearchQuery({
        researchRequest: params.researchRequest,
        query: search.query,
        results: search.results.map((result) => ({
          title: result.title,
          url: result.link,
          content: pageSummaries.get(result.link) || result.shortText,
        })),
        maxRetries: params.maxRetries,
      })
      params.onEvent({
        type: "query-summary-stream",
        query: search.query,
        streamId,
      })
      return {
        query: search.query,
        content: (await collectStreamText({ id: streamId })).trim(),
      }
    }),
  )

  const finalAnswerStreamId = await answerResearchRequest({
    researchRequest: params.researchRequest,
    searchSummaries,
    maxRetries: params.maxRetries,
  })
  params.onEvent({
    type: "final-answer-stream",
    streamId: finalAnswerStreamId,
  })
}
