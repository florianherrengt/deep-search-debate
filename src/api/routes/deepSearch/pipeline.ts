import PQueue from "p-queue"
import { Effect, Result } from "effect"
import { answerResearchRequest } from "../../agents/deep_search/finalAnswer.ts"
import { generateWebSearchQueries } from "../../agents/deep_search/queries.ts"
import { summarizeSearchQuery } from "../../agents/deep_search/querySummaries.ts"
import { analyzeResearchAnswer } from "../../agents/deep_search/researchAnalysis.ts"
import {
  startRoundReview,
  type RoundReview,
} from "../../agents/deep_search/reviewRound.ts"
import type {
  DeepSearchEvent,
  DeepSearchSearch,
} from "../../agents/deep_search/schemas.ts"
import { selectWebSearchResults } from "../../agents/deep_search/selection.ts"
import { startPageSummary } from "../../agents/deep_search/summaries.ts"
import { getErrorMessage } from "../../helpers/getErrorMessage.ts"
import { addAbortableQueueTask } from "../../helpers/addAbortableQueueTask.ts"
import { webSearch } from "../../web_search/index.ts"
import { config } from "../../config.ts"
import {
  runWorkflowEffect,
  WorkflowFailure,
  WorkflowInterruptedError,
} from "../../workflowRuntime.ts"
import { promoteRoundAnswer } from "./jobLifecycle.ts"
import type {
  ExecutedQuery,
  SearchRound,
  SelectedPage,
} from "./records.ts"
import {
  attachPageSummaryGeneration,
  createSearchRound,
  attachQuerySummaryGeneration,
  attachRoundAnswerGeneration,
  attachRoundReviewGeneration,
  attachResearchAnalysisGeneration,
  attachSelectionGeneration,
  completePageSummaryGeneration,
  completeEmptySearchQuery,
  completeQuerySummaryGeneration,
  failPageSummaryGeneration,
  failQuerySummaryGeneration,
  interruptPageSummaryGeneration,
  interruptQuerySummaryGeneration,
  interruptRoundReviewGeneration,
  savePageFailure,
  settlePageExtractionCredits,
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
  workflowSignal?: AbortSignal
}

const pageSummaryQueue = new PQueue({
  concurrency: config.deepSearch.maxConcurrentPageTasks,
})

const EMPTY_SEARCH_SUMMARY =
  "The web search returned no usable results for this query."

type SearchSummary = {
  round: number
  query: string
  content: string
}

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

function workflowEffect<Value>(
  run: () => Value | PromiseLike<Value>,
  fallback = "Deep-search work failed",
): Effect.Effect<Value, WorkflowFailure> {
  return Effect.uninterruptible(
    Effect.tryPromise({
      try: () => Promise.resolve().then(run),
      catch: (cause) =>
        cause instanceof WorkflowFailure
          ? cause
          : new WorkflowFailure({
              message: getErrorMessage(cause, fallback),
              cause,
            }),
    }),
  )
}

function settleAll<Value>(
  effects: readonly Effect.Effect<Value, WorkflowFailure>[],
): Effect.Effect<Value[], WorkflowFailure> {
  return Effect.gen(function*() {
    const settled = yield* Effect.all(effects, {
      concurrency: "unbounded",
      mode: "result",
    })
    // Result mode waits for every started effect and preserves input order.
    // Inspecting in that order keeps concurrent failure selection stable.
    const firstFailure = settled.find(Result.isFailure)
    if (firstFailure) yield* Effect.fail(firstFailure.failure)
    return settled.map((result) => {
      if (Result.isFailure(result)) throw result.failure
      return result.success
    })
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
    workflowSignal: params.workflowSignal,
    onExtractionSettled: (creditsUsed) => {
      settlePageExtractionCredits({
        userId: params.userId,
        jobId: params.deepSearchJobId,
        pageId: page.pageId,
        creditsUsed,
      })
    },
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
    onInterrupted: (interrupted, transaction) => {
      interruptPageSummaryGeneration(transaction, {
        jobId: params.deepSearchJobId,
        pageId: page.pageId,
        generationId: interrupted.id,
        message: interrupted.error,
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

async function reviewSearchRound(
  params: DeepSearchPipelineInput,
  round: SearchRound,
  maxRounds: number,
  searchSummaries: readonly SearchSummary[],
  candidateAnswer: string,
): Promise<RoundReview | undefined> {
  const startedReview = await startRoundReview({
    userId: params.userId,
    deepSearchJobId: params.deepSearchJobId,
    researchRequest: params.researchRequest,
    candidateAnswer,
    completedRound: round.position,
    maxRounds,
    searchSummaries: [...searchSummaries],
    workflowSignal: params.workflowSignal,
    onCompleted: (completed, transaction) => {
      saveRoundReviewCompletion(transaction, {
        jobId: params.deepSearchJobId,
        roundId: round.roundId,
        generationId: completed.id,
        review: completed.output,
      })
    },
    onRegistered: (streamId, transaction) => {
      attachRoundReviewGeneration(transaction, {
        jobId: params.deepSearchJobId,
        roundId: round.roundId,
        generationId: streamId,
      })
    },
    onInterrupted: (interrupted, transaction) => {
      interruptRoundReviewGeneration(transaction, {
        jobId: params.deepSearchJobId,
        roundId: round.roundId,
        generationId: interrupted.id,
        message: interrupted.error,
      })
    },
  }).catch((error: unknown) => {
    if (error instanceof WorkflowInterruptedError) throw error
    persistRoundReviewFailure(params, round, error)
    return undefined
  })
  if (!startedReview) return undefined

  try {
    params.publish({
      type: "round-review-stream",
      round: round.position,
      streamId: startedReview.streamId,
    })
  } catch (error) {
    await startedReview.review.catch(() => undefined)
    throw error
  }

  return startedReview.review.catch((error: unknown) => {
    persistRoundReviewFailure(params, round, error)
    return undefined
  })
}

async function promoteCandidateAnswer(
  params: DeepSearchPipelineInput,
  round: SearchRound,
  generationId: string,
  candidateAnswer: string,
  searchSummaries: readonly SearchSummary[],
): Promise<void> {
  const researchAnalysisGeneration = await analyzeResearchAnswer({
    userId: params.userId,
    deepSearchJobId: params.deepSearchJobId,
    researchRequest: params.researchRequest,
    finalAnswer: candidateAnswer,
    searchSummaries: [...searchSummaries],
    workflowSignal: params.workflowSignal,
    onRegistered: (analysisGenerationId, transaction) => {
      attachResearchAnalysisGeneration(transaction, {
        jobId: params.deepSearchJobId,
        generationId: analysisGenerationId,
      })
    },
  })
  const analysis = await researchAnalysisGeneration.analysis
  promoteRoundAnswer({
    jobId: params.deepSearchJobId,
    roundId: round.roundId,
    generationId,
    researchAnalysisGenerationId:
      researchAnalysisGeneration.generationId,
  })
  params.publish({ type: "final-answer-stream", streamId: generationId })
  params.publish({ type: "research-analysis", analysis })
}

/** Coordinates the complete deep-search workflow and persists each stage before publishing it. */
function deepSearchPipelineEffect(
  params: DeepSearchPipelineInput,
): Effect.Effect<string, WorkflowFailure> {
  return Effect.gen(function*() {
    const maxSearches = params.maxSearches ?? 3
    const maxResultsPerSearch = params.maxResultsPerSearch ?? 3
    const maxRounds = params.maxRounds ?? 3
    const pageSummaryTasks = new Map<string, Promise<string | undefined>>()
    const previousQueries: string[] = []
    const searchSummaries: SearchSummary[] = []
    let previousCandidateAnswer: string | undefined
    let previousReviewReason: string | undefined

    for (let round = 0; round < maxRounds; round += 1) {
      const queryGeneration = yield* workflowEffect(() =>
        generateWebSearchQueries({
          userId: params.userId,
          deepSearchJobId: params.deepSearchJobId,
          researchRequest: params.researchRequest,
          maxSearches,
          round,
          previousQueries: [...previousQueries],
          previousSearchSummaries: [...searchSummaries],
          previousCandidateAnswer,
          previousReviewReason,
          workflowSignal: params.workflowSignal,
        }),
      )
      const persistedRound = yield* workflowEffect(async () => {
        try {
          const storedRound = createSearchRound({
            jobId: params.deepSearchJobId,
            position: round,
            generationId: queryGeneration.streamId,
          })
          params.publish({
            type: "query-stream",
            round,
            streamId: queryGeneration.streamId,
          })
          return storedRound
        } catch (error) {
          await queryGeneration.queries.catch(() => undefined)
          throw error
        }
      })

      const queries = yield* workflowEffect(() => queryGeneration.queries)
      const plannedQueries = yield* workflowEffect(() =>
        savePlannedQueries({
          jobId: params.deepSearchJobId,
          roundId: persistedRound.roundId,
          queries,
        }),
      )
      const searchedQueries = yield* settleAll(
        plannedQueries.map((plannedQuery) =>
          workflowEffect(async () => {
            const search = await webSearch({
              userId: params.userId,
              query: plannedQuery.query,
              signal: params.workflowSignal,
            })
            // Preserve the array-shaped test seam used by provider mocks while
            // production returns settled cost metadata.
            return Array.isArray(search)
              ? { plannedQuery, results: search, creditsUsed: 0 }
              : { plannedQuery, ...search }
          }),
        ),
      )
      // Product policy: if this search batch fails, none of its successful
      // sibling requests are charged. Customers are not billed for this failed
      // stage.
      const executedQueries = yield* workflowEffect(() => {
        const storedQueries = saveSearchResults({
          userId: params.userId,
          jobId: params.deepSearchJobId,
          roundId: persistedRound.roundId,
          searches: searchedQueries,
        })
        if (storedQueries.length > 0) {
          params.publish({
            type: "search-results",
            round,
            searches: storedQueries.map(toPublicSearch),
          })
        }
        return storedQueries
      })
      previousQueries.push(...executedQueries.map(({ query }) => query))

      const pagesToSummarize = new Map<string, SelectedPage>()
      for (const search of executedQueries) {
        if (search.results.length === 0) {
          yield* workflowEffect(() => {
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
          })
          continue
        }
        const selectionGeneration = yield* workflowEffect(() =>
          selectWebSearchResults({
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
            workflowSignal: params.workflowSignal,
          }),
        )
        yield* workflowEffect(async () => {
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
        })

        const resultsById = new Map(
          search.results.map((result) => [result.resultId, result]),
        )
        const selectedIds = yield* workflowEffect(
          () => selectionGeneration.selectedIds,
        )
        const selectedResults = selectedIds
          .map((id) => resultsById.get(id))
          .filter((result) => result !== undefined)
        const selectedPages = yield* workflowEffect(() => {
          const storedPages = saveSelectedResults({
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
          return storedPages
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
          addAbortableQueueTask(
            pageSummaryQueue,
            () => summarizeSelectedPage(params, page),
            params.workflowSignal,
          ),
        )
      }

      const pageSummaries = new Map(
        yield* settleAll(
          [...pageSummaryTasks].map(([url, task]) =>
            workflowEffect(async () => {
              const summary = await task
              return [url, summary] as const
            }),
          ),
        ),
      )

      const roundSummaries = yield* settleAll(
        executedQueries.map((search) =>
          workflowEffect(async () => {
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
              workflowSignal: params.workflowSignal,
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
              onInterrupted: (interrupted, transaction) => {
                interruptQuerySummaryGeneration(transaction, {
                  jobId: params.deepSearchJobId,
                  queryId: search.queryId,
                  generationId: interrupted.id,
                  message: interrupted.error,
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
        ),
      )
      searchSummaries.push(...roundSummaries)

      const candidate = yield* workflowEffect(() =>
        answerResearchRequest({
          userId: params.userId,
          deepSearchJobId: params.deepSearchJobId,
          researchRequest: params.researchRequest,
          searchSummaries: [...searchSummaries],
          workflowSignal: params.workflowSignal,
          onRegistered: (generationId, transaction) => {
            attachRoundAnswerGeneration(transaction, {
              jobId: params.deepSearchJobId,
              roundId: persistedRound.roundId,
              generationId,
            })
          },
        }),
      )
      yield* workflowEffect(async () => {
        try {
          params.publish({
            type: "round-answer-stream",
            round,
            streamId: candidate.streamId,
          })
        } catch (error) {
          await candidate.answer.catch(() => undefined)
          throw error
        }
      })
      const candidateAnswer = yield* workflowEffect(() => candidate.answer)

      if (round + 1 >= maxRounds) {
        yield* workflowEffect(() =>
          promoteCandidateAnswer(
            params,
            persistedRound,
            candidate.streamId,
            candidateAnswer,
            searchSummaries,
          ),
        )
        return candidateAnswer
      }

      const decision = yield* workflowEffect(() =>
        reviewSearchRound(
          params,
          persistedRound,
          maxRounds,
          searchSummaries,
          candidateAnswer,
        ),
      )
      if (!decision) {
        yield* workflowEffect(() =>
          promoteCandidateAnswer(
            params,
            persistedRound,
            candidate.streamId,
            candidateAnswer,
            searchSummaries,
          ),
        )
        return candidateAnswer
      }

      yield* workflowEffect(() =>
        params.publish({ type: "round-review", round, ...decision }),
      )
      if (decision.decision === "stop") {
        yield* workflowEffect(() =>
          promoteCandidateAnswer(
            params,
            persistedRound,
            candidate.streamId,
            candidateAnswer,
            searchSummaries,
          ),
        )
        return candidateAnswer
      }
      previousCandidateAnswer = candidateAnswer
      previousReviewReason = decision.reason
    }

    return yield* Effect.fail(
      new WorkflowFailure({
        message: "Deep-search pipeline exhausted without a candidate answer",
      }),
    )
  })
}

/** Effect-owned coordinator with a single Promise-facing runtime boundary. */
export async function runDeepSearchPipeline(
  params: DeepSearchPipelineInput,
): Promise<string> {
  return runWorkflowEffect(
    deepSearchPipelineEffect(params),
    params.workflowSignal,
  )
}
