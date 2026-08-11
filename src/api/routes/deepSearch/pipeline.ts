import PQueue from "p-queue"
import { answerResearchRequest } from "../../agents/deep_search/finalAnswer.ts"
import { generateWebSearchQueries } from "../../agents/deep_search/queries.ts"
import { summarizeSearchQuery } from "../../agents/deep_search/querySummaries.ts"
import { startRoundReview } from "../../agents/deep_search/reviewRound.ts"
import type {
  DeepSearchEvent,
  DeepSearchSearch,
} from "../../agents/deep_search/schemas.ts"
import { selectWebSearchResults } from "../../agents/deep_search/selection.ts"
import { startPageSummary } from "../../agents/deep_search/summaries.ts"
import { getErrorMessage } from "../../helpers/getErrorMessage.ts"
import { webSearch } from "../../web_search/index.ts"
import { config } from "../../config.ts"
import { completeDeepSearchJob } from "./jobLifecycle.ts"
import type {
  ExecutedQuery,
  SearchRound,
  SelectedPage,
} from "./records.ts"
import {
  attachFinalAnswerGeneration,
  attachPageSummaryGeneration,
  createSearchRound,
  attachQuerySummaryGeneration,
  attachRoundReviewGeneration,
  attachSelectionGeneration,
  completePageSummaryGeneration,
  completeEmptySearchQuery,
  completeQuerySummaryGeneration,
  failPageSummaryGeneration,
  failQuerySummaryGeneration,
  savePageFailure,
  savePlannedQueries,
  saveRoundReviewCompletion,
  saveRoundReviewFailure,
  saveSearchResults,
  saveSelectedResults,
} from "./store.ts"

export type DeepSearchPipelineInput = {
  userId: string
  deepSearchJobId: string
  researchRequest: string
  maxSearches?: number
  maxResultsPerSearch?: number
  maxRounds?: number
  publish: (event: DeepSearchEvent) => void
}

const pageSummaryQueue = new PQueue({
  concurrency: config.deepSearch.maxConcurrentPageTasks,
})

const EMPTY_SEARCH_SUMMARY =
  "The web search returned no usable results for this query."

function toPublicSearch(search: ExecutedQuery): DeepSearchSearch {
  return {
    query: search.query,
    results: search.results.map((result) => ({
      title: result.title,
      shortText: result.shortText,
      link: result.url,
    })),
  }
}

async function settleAll<Result>(
  promises: readonly Promise<Result>[],
): Promise<Result[]> {
  const settled = await Promise.allSettled(promises)
  // allSettled preserves input order, so concurrent failures have a stable
  // winner instead of depending on provider response timing.
  const failure = settled.find(
    (result): result is PromiseRejectedResult =>
      result.status === "rejected",
  )
  if (failure) throw failure.reason
  return settled.map((result) => {
    if (result.status === "rejected") throw result.reason
    return result.value
  })
}

async function summarizeSelectedPage(
  params: DeepSearchPipelineInput,
  page: SelectedPage,
): Promise<string | undefined> {
  const pageSummary = await startPageSummary({
    userId: params.userId,
    deepSearchJobId: params.deepSearchJobId,
    researchRequest: params.researchRequest,
    url: page.url,
    onRegistered: (generationId, transaction) => {
      attachPageSummaryGeneration(transaction, {
        jobId: params.deepSearchJobId,
        pageId: page.pageId,
        generationId,
      })
    },
    onCompleted: (completed, transaction) => {
      completePageSummaryGeneration(transaction, {
        jobId: params.deepSearchJobId,
        pageId: page.pageId,
        generationId: completed.id,
      })
    },
    onFailed: (failed, transaction) => {
      failPageSummaryGeneration(transaction, {
        jobId: params.deepSearchJobId,
        pageId: page.pageId,
        generationId: failed.id,
        message: failed.error,
      })
    },
  })
  if (pageSummary.status === "failed") {
    savePageFailure({
      jobId: params.deepSearchJobId,
      pageId: page.pageId,
      stage: pageSummary.stage,
      message: pageSummary.message,
    })
    params.publish({
      type: "page-summary-error",
      url: page.url,
      stage: pageSummary.stage,
      message: pageSummary.message,
    })
    return
  }

  try {
    params.publish({
      type: "page-summary-stream",
      url: page.url,
      streamId: pageSummary.streamId,
    })
  } catch (error) {
    await pageSummary.summary.catch(() => undefined)
    throw error
  }
  return pageSummary.summary
}

function persistRoundReviewFailure(
  params: DeepSearchPipelineInput,
  round: SearchRound,
  error: unknown,
): void {
  const message = getErrorMessage(error, "Round review failed")
  saveRoundReviewFailure({
    jobId: params.deepSearchJobId,
    roundId: round.roundId,
    message,
  })
  params.publish({
    type: "round-review-error",
    round: round.position,
    message,
  })
}

/** Coordinates the complete deep-search workflow and persists each stage before publishing it. */
export async function runDeepSearchPipeline(
  params: DeepSearchPipelineInput,
): Promise<string> {
  const maxSearches = params.maxSearches ?? 3
  const maxResultsPerSearch = params.maxResultsPerSearch ?? 3
  const maxRounds = params.maxRounds ?? 3
  const pageSummaryTasks = new Map<string, Promise<string | undefined>>()
  const previousQueries: string[] = []
  const searchSummaries: { round: number; query: string; content: string }[] = []

  for (let round = 0; round < maxRounds; round += 1) {
    const queryGeneration = await generateWebSearchQueries({
      userId: params.userId,
      deepSearchJobId: params.deepSearchJobId,
      researchRequest: params.researchRequest,
      maxSearches,
      round,
      previousQueries: [...previousQueries],
      previousSearchSummaries: [...searchSummaries],
    })
    let persistedRound: SearchRound
    try {
      persistedRound = createSearchRound({
        jobId: params.deepSearchJobId,
        position: round,
        generationId: queryGeneration.streamId,
      })
      params.publish({
        type: "query-stream",
        round,
        streamId: queryGeneration.streamId,
      })
    } catch (error) {
      await queryGeneration.queries.catch(() => undefined)
      throw error
    }

    const queries = await queryGeneration.queries
    const plannedQueries = savePlannedQueries({
      jobId: params.deepSearchJobId,
      roundId: persistedRound.roundId,
      queries,
    })
    const searchedQueries = await settleAll(
      plannedQueries.map(async (plannedQuery) => ({
        plannedQuery,
        results: await webSearch({ query: plannedQuery.query }),
      })),
    )
    const executedQueries = saveSearchResults({
      jobId: params.deepSearchJobId,
      roundId: persistedRound.roundId,
      searches: searchedQueries,
    })
    if (executedQueries.length === 0) break
    params.publish({
      type: "search-results",
      round,
      searches: executedQueries.map(toPublicSearch),
    })
    previousQueries.push(...executedQueries.map(({ query }) => query))

    const pagesToSummarize = new Map<string, SelectedPage>()
    for (const search of executedQueries) {
      if (search.results.length === 0) {
        completeEmptySearchQuery({
          jobId: params.deepSearchJobId,
          queryId: search.queryId,
        })
        params.publish({
          type: "selected-search-results",
          round,
          query: search.query,
          selectedLinks: [],
        })
        continue
      }
      const selectionGeneration = await selectWebSearchResults({
        userId: params.userId,
        deepSearchJobId: params.deepSearchJobId,
        userQuery: params.researchRequest,
        searchQuery: search.query,
        results: search.results.map((result) => ({
          id: result.resultId,
          title: result.title,
          url: result.url,
          snippet: result.shortText,
        })),
        maxResultsToExplore: maxResultsPerSearch,
      })
      try {
        attachSelectionGeneration({
          jobId: params.deepSearchJobId,
          queryId: search.queryId,
          generationId: selectionGeneration.streamId,
        })
        params.publish({
          type: "selection-stream",
          round,
          query: search.query,
          streamId: selectionGeneration.streamId,
        })
      } catch (error) {
        await selectionGeneration.selectedIds.catch(() => undefined)
        throw error
      }

      const resultsById = new Map(
        search.results.map((result) => [result.resultId, result]),
      )
      const selectedResults = (await selectionGeneration.selectedIds)
        .map((id) => resultsById.get(id))
        .filter((result) => result !== undefined)
      const selectedPages = saveSelectedResults({
        jobId: params.deepSearchJobId,
        queryId: search.queryId,
        selectionGenerationId: selectionGeneration.streamId,
        selectedResultIds: [
          ...new Set(selectedResults.map(({ resultId }) => resultId)),
        ],
      })
      params.publish({
        type: "selected-search-results",
        round,
        query: search.query,
        selectedLinks: selectedResults.map(({ url }) => url),
      })

      for (const page of selectedPages) {
        if (pageSummaryTasks.has(page.url) || pagesToSummarize.has(page.url)) {
          continue
        }
        pagesToSummarize.set(page.url, page)
      }
    }

    for (const page of pagesToSummarize.values()) {
      pageSummaryTasks.set(
        page.url,
        pageSummaryQueue.add(() => summarizeSelectedPage(params, page)),
      )
    }

    const pageSummaries = new Map(
      await settleAll(
        [...pageSummaryTasks].map(async ([url, task]) => {
          const summary = await task
          return [url, summary] as const
        }),
      ),
    )

    const roundSummaries = await settleAll(
      executedQueries.map(async (search) => {
        if (search.results.length === 0) {
          return {
            round,
            query: search.query,
            content: EMPTY_SEARCH_SUMMARY,
          }
        }
        const generation = await summarizeSearchQuery({
          userId: params.userId,
          deepSearchJobId: params.deepSearchJobId,
          researchRequest: params.researchRequest,
          query: search.query,
          results: search.results.map((result) => ({
            title: result.title,
            url: result.url,
            content: pageSummaries.get(result.url) || result.shortText,
          })),
          onRegistered: (generationId, transaction) => {
            attachQuerySummaryGeneration(transaction, {
              jobId: params.deepSearchJobId,
              queryId: search.queryId,
              generationId,
            })
          },
          onCompleted: (completed, transaction) => {
            completeQuerySummaryGeneration(transaction, {
              jobId: params.deepSearchJobId,
              queryId: search.queryId,
              generationId: completed.id,
            })
          },
          onFailed: (failed, transaction) => {
            failQuerySummaryGeneration(transaction, {
              jobId: params.deepSearchJobId,
              queryId: search.queryId,
              generationId: failed.id,
              message: failed.error,
            })
          },
        })
        try {
          params.publish({
            type: "query-summary-stream",
            round,
            query: search.query,
            streamId: generation.streamId,
          })
        } catch (error) {
          await generation.summary.catch(() => undefined)
          throw error
        }
        return {
          round,
          query: search.query,
          content: (await generation.summary).trim(),
        }
      }),
    )
    searchSummaries.push(...roundSummaries)

    if (round + 1 >= maxRounds) break

    let review: Awaited<ReturnType<typeof startRoundReview>>
    try {
      review = await startRoundReview({
        userId: params.userId,
        deepSearchJobId: params.deepSearchJobId,
        researchRequest: params.researchRequest,
        completedRound: round,
        maxRounds,
        searchSummaries,
        onCompleted: (completed, transaction) => {
          saveRoundReviewCompletion(transaction, {
            jobId: params.deepSearchJobId,
            roundId: persistedRound.roundId,
            generationId: completed.id,
            review: completed.output,
          })
        },
        onRegistered: (streamId, transaction) => {
          attachRoundReviewGeneration(transaction, {
            jobId: params.deepSearchJobId,
            roundId: persistedRound.roundId,
            generationId: streamId,
          })
        },
      })
    } catch (error) {
      persistRoundReviewFailure(params, persistedRound, error)
      break
    }

    try {
      params.publish({
        type: "round-review-stream",
        round,
        streamId: review.streamId,
      })
    } catch (error) {
      await review.review.catch(() => undefined)
      throw error
    }

    let decision
    try {
      decision = await review.review
    } catch (error) {
      persistRoundReviewFailure(params, persistedRound, error)
      break
    }
    params.publish({ type: "round-review", round, ...decision })
    if (decision.decision === "stop") break
  }

  const finalAnswer = await answerResearchRequest({
    userId: params.userId,
    deepSearchJobId: params.deepSearchJobId,
    researchRequest: params.researchRequest,
    searchSummaries: searchSummaries.map(({ query, content }) => ({
      query,
      content,
    })),
    onRegistered: (generationId, transaction) => {
      attachFinalAnswerGeneration(transaction, {
        jobId: params.deepSearchJobId,
        generationId,
      })
    },
    onCompleted: (completed, transaction) => {
      completeDeepSearchJob(transaction, {
        jobId: params.deepSearchJobId,
        generationId: completed.id,
      })
    },
  })
  try {
    params.publish({
      type: "final-answer-stream",
      streamId: finalAnswer.streamId,
    })
  } catch (error) {
    await finalAnswer.answer.catch(() => undefined)
    throw error
  }
  return finalAnswer.answer
}
