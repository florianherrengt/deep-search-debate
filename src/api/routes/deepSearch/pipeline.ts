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
import {
  researchAnalysisSchema,
  type DeepSearchEvent,
  type DeepSearchSearch,
} from "../../agents/deep_search/schemas.ts"
import { selectWebSearchResults } from "../../agents/deep_search/selection.ts"
import {
  startPageSummary,
  summarizePage,
} from "../../agents/deep_search/summaries.ts"
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
  DeepSearchExecutionSnapshot,
  ExecutedQuery,
  PersistedGeneration,
  PlannedQuery,
  SearchRound,
  SelectedPage,
} from "./records.ts"
import {
  attachPageSummaryGeneration,
  attachQuerySummaryGeneration,
  attachRoundAnswerGeneration,
  attachRoundReviewGeneration,
  attachResearchAnalysisGeneration,
  completePageSummaryGeneration,
  completeEmptySearchQuery,
  completeQuerySummaryGeneration,
  failPageSummaryGeneration,
  failQuerySummaryGeneration,
  interruptPageSummaryGeneration,
  interruptQuerySummaryGeneration,
  interruptRoundReviewGeneration,
  loadDeepSearchExecutionSnapshot,
  registerSearchRound,
  registerSelectionGeneration,
  replacePageSummaryGeneration,
  replaceQuerySelectionGeneration,
  replaceQuerySummaryGeneration,
  replaceResearchAnalysisGeneration,
  replaceRoundAnswerGeneration,
  replaceRoundPlanningGeneration,
  replaceRoundReviewGeneration,
  resetWebSearchQuery,
  savePageFailure,
  savePlannedQueries,
  saveRoundReviewCompletion,
  saveRoundReviewFailure,
  saveSelectedResults,
  settlePageExtraction,
  settleWebSearchQuery,
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

type SnapshotRound = DeepSearchExecutionSnapshot["rounds"][number]
type SnapshotQuery = SnapshotRound["queries"][number]
type SnapshotPage = DeepSearchExecutionSnapshot["pages"][number]

const STALE_GENERATION_MESSAGE =
  "Interrupted generation replaced while resuming persisted research"

function loadSnapshot(jobId: string): DeepSearchExecutionSnapshot {
  const snapshot = loadDeepSearchExecutionSnapshot(jobId)
  if (!snapshot) throw new Error("Deep-search execution snapshot was not found")
  return snapshot
}

function parseStringArray(generation: PersistedGeneration): string[] {
  if (generation.status !== "completed" || generation.text === null) {
    throw new Error("Completed structured generation output was not persisted")
  }
  const parsed: unknown = JSON.parse(generation.text)
  if (!Array.isArray(parsed) || !parsed.every((item) => typeof item === "string")) {
    throw new Error("Persisted structured generation output is invalid")
  }
  return parsed
}

function completedText(generation: PersistedGeneration): string {
  if (generation.status !== "completed" || generation.text === null) {
    throw new Error("Completed generation text was not persisted")
  }
  return generation.text
}

function replacementInput(
  jobId: string,
  oldGeneration: PersistedGeneration,
  newGenerationId: string,
) {
  return {
    jobId,
    oldGenerationId: oldGeneration.generationId,
    newGenerationId,
    ...(oldGeneration.status === "running"
      ? { staleRunningMessage: STALE_GENERATION_MESSAGE }
      : {}),
  }
}

function toExecutedQuery(query: SnapshotQuery): ExecutedQuery {
  return {
    queryId: query.queryId,
    position: query.position,
    query: query.query,
    results: query.results.map(({ selectedWebPageId: _, ...result }) => result),
  }
}

function selectedPagesFromSnapshot(
  query: SnapshotQuery,
  pagesById: ReadonlyMap<string, SnapshotPage>,
): SelectedPage[] {
  return query.results.flatMap(({ selectedWebPageId }) => {
    if (selectedWebPageId === null) return []
    const page = pagesById.get(selectedWebPageId)
    if (!page) throw new Error("Selected web page was not persisted")
    return [{ pageId: page.pageId, url: page.url }]
  })
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
  page: SnapshotPage,
  strictQuality: boolean,
): Promise<string | undefined> {
  if (
    page.status === "completed" &&
    page.summaryGeneration?.status === "completed"
  ) {
    return completedText(page.summaryGeneration).trim() || undefined
  }
  if (page.status === "failed" && page.errorStage === "extraction") return
  if (
    page.status === "failed" &&
    page.errorStage === "summary" &&
    !strictQuality
  ) {
    return
  }

  const previousGeneration = page.summaryGeneration
  const callbacks = {
    onRegistered: (generationId, transaction) => {
      if (previousGeneration) {
        replacePageSummaryGeneration(transaction, {
          ...replacementInput(
            params.deepSearchJobId,
            previousGeneration,
            generationId,
          ),
          pageId: page.pageId,
        })
      } else {
        attachPageSummaryGeneration(transaction, {
          jobId: params.deepSearchJobId,
          pageId: page.pageId,
          generationId,
        })
      }
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
  } satisfies Pick<
    Parameters<typeof startPageSummary>[0],
    "onRegistered" | "onCompleted" | "onFailed" | "onInterrupted"
  >

  const pageSummary = page.extractedContent === null
    ? await startPageSummary({
        userId: params.userId,
        deepSearchJobId: params.deepSearchJobId,
        researchRequest: params.researchRequest,
        url: page.url,
        workflowSignal: params.workflowSignal,
        onExtractionSettled: ({ content, creditsUsed }) => {
          settlePageExtraction({
            userId: params.userId,
            jobId: params.deepSearchJobId,
            pageId: page.pageId,
            content,
            creditsUsed,
          })
        },
        ...callbacks,
      })
    : await summarizePage({
        userId: params.userId,
        deepSearchJobId: params.deepSearchJobId,
        researchRequest: params.researchRequest,
        url: page.url,
        content: page.extractedContent,
        workflowSignal: params.workflowSignal,
        ...callbacks,
      }).then((generation) => ({
        status: "started" as const,
        streamId: generation.streamId,
        completion: generation.completion,
        summary: generation.completion.then((outcome) =>
          outcome.status === "completed"
            ? outcome.text.trim() || undefined
            : undefined,
        ),
      }))
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
    if (strictQuality && pageSummary.stage === "summary") {
      throw new Error(pageSummary.message)
    }
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
  const summary = await pageSummary.summary
  const outcome = await pageSummary.completion
  if (outcome.status !== "completed") {
    params.publish({
      type: "page-summary-error",
      url: page.url,
      stage: "summary",
      message: outcome.error,
    })
    if (strictQuality) throw new Error(outcome.error)
  }
  return summary
}

function persistRoundReviewFailure(
  params: DeepSearchPipelineInput,
  round: SearchRound,
  generationId: string,
  error: unknown,
): void {
  const message = getErrorMessage(error, "Round review failed")
  saveRoundReviewFailure({
    jobId: params.deepSearchJobId,
    roundId: round.roundId,
    generationId,
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
  previousGeneration?: PersistedGeneration,
): Promise<RoundReview | undefined> {
  let startedGenerationId: string | undefined
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
      startedGenerationId = streamId
      if (previousGeneration) {
        replaceRoundReviewGeneration(transaction, {
          ...replacementInput(
            params.deepSearchJobId,
            previousGeneration,
            streamId,
          ),
          roundId: round.roundId,
        })
      } else {
        attachRoundReviewGeneration(transaction, {
          jobId: params.deepSearchJobId,
          roundId: round.roundId,
          generationId: streamId,
        })
      }
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
    if (!startedGenerationId) throw error
    persistRoundReviewFailure(params, round, startedGenerationId, error)
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
    persistRoundReviewFailure(params, round, startedReview.streamId, error)
    return undefined
  })
}

async function promoteCandidateAnswer(
  params: DeepSearchPipelineInput,
  round: SearchRound,
  generationId: string,
  candidateAnswer: string,
  searchSummaries: readonly SearchSummary[],
  previousAnalysis?: PersistedGeneration,
): Promise<void> {
  const researchAnalysisGeneration = await analyzeResearchAnswer({
    userId: params.userId,
    deepSearchJobId: params.deepSearchJobId,
    researchRequest: params.researchRequest,
    finalAnswer: candidateAnswer,
    searchSummaries: [...searchSummaries],
    workflowSignal: params.workflowSignal,
    onRegistered: (analysisGenerationId, transaction) => {
      if (previousAnalysis) {
        replaceResearchAnalysisGeneration(transaction, {
          ...replacementInput(
            params.deepSearchJobId,
            previousAnalysis,
            analysisGenerationId,
          ),
        })
      } else {
        attachResearchAnalysisGeneration(transaction, {
          jobId: params.deepSearchJobId,
          generationId: analysisGenerationId,
        })
      }
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
    const initialSnapshot = yield* workflowEffect(() =>
      loadSnapshot(params.deepSearchJobId),
    )
    const durableParams: DeepSearchPipelineInput = {
      ...params,
      userId: initialSnapshot.userId,
      researchRequest: initialSnapshot.researchRequest,
      maxSearches: initialSnapshot.maxSearches,
      maxResultsPerSearch: initialSnapshot.maxResultsPerSearch,
      maxRounds: initialSnapshot.maxRounds,
    }
    const maxSearches = initialSnapshot.maxSearches
    const maxResultsPerSearch = initialSnapshot.maxResultsPerSearch
    const maxRounds = initialSnapshot.maxRounds
    const strictQuality = initialSnapshot.strictQuality
    const previousQueries: string[] = []
    const searchSummaries: SearchSummary[] = []
    const pageSummaries = new Map<string, string | undefined>(
      initialSnapshot.pages.map((page) => [
        page.url,
        page.status === "completed" &&
            page.summaryGeneration?.status === "completed"
          ? completedText(page.summaryGeneration).trim() || undefined
          : undefined,
      ]),
    )
    let previousCandidateAnswer: string | undefined
    let previousReviewReason: string | undefined

    const promotePersistedCandidate = (
      round: SearchRound,
      answerGenerationId: string,
      candidateAnswer: string,
    ): Effect.Effect<void, WorkflowFailure> =>
      workflowEffect(async () => {
        const snapshot = loadSnapshot(params.deepSearchJobId)
        const previousAnalysis = snapshot.researchAnalysisGeneration
        if (previousAnalysis?.status === "completed") {
          const analysis = researchAnalysisSchema.parse(
            JSON.parse(completedText(previousAnalysis)),
          )
          promoteRoundAnswer({
            jobId: params.deepSearchJobId,
            roundId: round.roundId,
            generationId: answerGenerationId,
            researchAnalysisGenerationId: previousAnalysis.generationId,
          })
          params.publish({
            type: "final-answer-stream",
            streamId: answerGenerationId,
          })
          params.publish({ type: "research-analysis", analysis })
          return
        }
        await promoteCandidateAnswer(
          durableParams,
          round,
          answerGenerationId,
          candidateAnswer,
          searchSummaries,
          previousAnalysis ?? undefined,
        )
      })

    for (let roundPosition = 0; roundPosition < maxRounds; roundPosition += 1) {
      let snapshot = yield* workflowEffect(() =>
        loadSnapshot(params.deepSearchJobId),
      )
      let snapshotRound = snapshot.rounds.find(
        ({ position }) => position === roundPosition,
      )
      let persistedRound: SearchRound

      if (snapshotRound?.planningGeneration.status === "completed") {
        persistedRound = {
          roundId: snapshotRound.roundId,
          position: snapshotRound.position,
          generationId: snapshotRound.planningGeneration.generationId,
        }
        if (snapshotRound.queries.length === 0) {
          yield* workflowEffect(() =>
            savePlannedQueries({
              jobId: params.deepSearchJobId,
              roundId: snapshotRound!.roundId,
              queries: parseStringArray(snapshotRound!.planningGeneration),
            }),
          )
        }
      } else {
        const previousPlanning = snapshotRound?.planningGeneration
        let registeredRound: SearchRound | undefined
        const queryGeneration = yield* workflowEffect(() =>
          generateWebSearchQueries({
            userId: durableParams.userId,
            deepSearchJobId: durableParams.deepSearchJobId,
            researchRequest: durableParams.researchRequest,
            maxSearches,
            round: roundPosition,
            previousQueries: [...previousQueries],
            previousSearchSummaries: [...searchSummaries],
            previousCandidateAnswer,
            previousReviewReason,
            workflowSignal: durableParams.workflowSignal,
            onRegistered: (generationId, transaction) => {
              if (snapshotRound && previousPlanning) {
                replaceRoundPlanningGeneration(transaction, {
                  ...replacementInput(
                    params.deepSearchJobId,
                    previousPlanning,
                    generationId,
                  ),
                  roundId: snapshotRound.roundId,
                })
                registeredRound = {
                  roundId: snapshotRound.roundId,
                  position: snapshotRound.position,
                  generationId,
                }
              } else {
                registeredRound = registerSearchRound(transaction, {
                  jobId: params.deepSearchJobId,
                  position: roundPosition,
                  generationId,
                })
              }
            },
            onCompleted: (completed, transaction) => {
              if (!registeredRound) {
                throw new Error("Search round generation was not registered")
              }
              savePlannedQueries(transaction, {
                jobId: params.deepSearchJobId,
                roundId: registeredRound.roundId,
                queries: completed.output,
              })
            },
          }),
        )
        persistedRound = yield* workflowEffect(async () => {
          if (!registeredRound) {
            await queryGeneration.queries.catch(() => undefined)
            throw new Error("Search round generation was not registered")
          }
          try {
            params.publish({
              type: "query-stream",
              round: roundPosition,
              streamId: queryGeneration.streamId,
            })
            return registeredRound
          } catch (error) {
            await queryGeneration.queries.catch(() => undefined)
            throw error
          }
        })
        const queries = yield* workflowEffect(() => queryGeneration.queries)
        const completedRound = yield* workflowEffect(() =>
          loadSnapshot(params.deepSearchJobId).rounds.find(
            ({ roundId }) => roundId === persistedRound.roundId,
          ),
        )
        if (
          !completedRound ||
          (completedRound.queries.length === 0 && queries.length > 0)
        ) {
          yield* workflowEffect(() =>
            savePlannedQueries({
              jobId: params.deepSearchJobId,
              roundId: persistedRound.roundId,
              queries,
            }),
          )
        }
      }

      snapshot = yield* workflowEffect(() =>
        loadSnapshot(params.deepSearchJobId),
      )
      snapshotRound = snapshot.rounds.find(
        ({ position }) => position === roundPosition,
      )
      if (!snapshotRound) {
        throw new WorkflowFailure({ message: "Round was not persisted" })
      }
      const plannedQueries: PlannedQuery[] = snapshotRound.queries.map(
        ({ queryId, position, query }) => ({ queryId, position, query }),
      )
      let performedProviderSearch = false
      const executedQueries = yield* settleAll(
        plannedQueries.map((plannedQuery) =>
          workflowEffect(async () => {
            const current = loadSnapshot(params.deepSearchJobId)
              .rounds.find(({ roundId }) => roundId === persistedRound.roundId)
              ?.queries.find(({ queryId }) => queryId === plannedQuery.queryId)
            if (!current) throw new Error("Search query was not persisted")
            if (current.creditsUsed !== null) return toExecutedQuery(current)
            if (current.status === "failed" && current.errorStage === "search") {
              resetWebSearchQuery({
                jobId: params.deepSearchJobId,
                queryId: current.queryId,
              })
            }
            performedProviderSearch = true
            const search = await webSearch({
              userId: durableParams.userId,
              query: plannedQuery.query,
              signal: durableParams.workflowSignal,
            })
            const settlement = Array.isArray(search)
              ? { plannedQuery, results: search, creditsUsed: 0 }
              : { plannedQuery, ...search }
            return settleWebSearchQuery({
              userId: durableParams.userId,
              jobId: params.deepSearchJobId,
              roundId: persistedRound.roundId,
              ...settlement,
            })
          }),
        ),
      )
      yield* workflowEffect(() => {
        if (performedProviderSearch && executedQueries.length > 0) {
          params.publish({
            type: "search-results",
            round: roundPosition,
            searches: executedQueries.map(toPublicSearch),
          })
        }
      })
      previousQueries.push(...executedQueries.map(({ query }) => query))

      const pagesToSummarize = new Map<string, SelectedPage>()
      for (const search of executedQueries) {
        snapshot = yield* workflowEffect(() =>
          loadSnapshot(params.deepSearchJobId),
        )
        const persistedQuery = snapshot.rounds
          .find(({ roundId }) => roundId === persistedRound.roundId)
          ?.queries.find(({ queryId }) => queryId === search.queryId)
        if (!persistedQuery) {
          throw new WorkflowFailure({
            message: "Search query was not persisted",
          })
        }
        if (search.results.length === 0) {
          if (persistedQuery.status !== "completed") {
            yield* workflowEffect(() => {
              completeEmptySearchQuery({
                jobId: params.deepSearchJobId,
                queryId: search.queryId,
              })
              params.publish({
                type: "selected-search-results",
                round: roundPosition,
                query: search.query,
                selectedLinks: [],
              })
            })
          }
          continue
        }

        let selectedPages: SelectedPage[]
        if (
          persistedQuery.status !== "selecting" &&
          !(
            persistedQuery.status === "failed" &&
            persistedQuery.errorStage === "selection"
          )
        ) {
          const pagesById = new Map(
            snapshot.pages.map((page) => [page.pageId, page]),
          )
          selectedPages = selectedPagesFromSnapshot(persistedQuery, pagesById)
        } else {
          const previousSelection = persistedQuery.selectionGeneration
          let selectedIds: string[]
          let selectionGenerationId: string
          let completedSelectedPages: SelectedPage[] | undefined
          if (previousSelection?.status === "completed") {
            selectedIds = parseStringArray(previousSelection)
            selectionGenerationId = previousSelection.generationId
          } else {
            const selectionGeneration = yield* workflowEffect(() =>
              selectWebSearchResults({
                userId: durableParams.userId,
                deepSearchJobId: durableParams.deepSearchJobId,
                userQuery: durableParams.researchRequest,
                searchQuery: search.query,
                results: search.results.map((result) => ({
                  id: result.resultId,
                  title: result.title,
                  url: result.url,
                  snippet: result.shortText,
                })),
                maxResultsToExplore: maxResultsPerSearch,
                workflowSignal: durableParams.workflowSignal,
                onRegistered: (generationId, transaction) => {
                  if (previousSelection) {
                    replaceQuerySelectionGeneration(transaction, {
                      ...replacementInput(
                        params.deepSearchJobId,
                        previousSelection,
                        generationId,
                      ),
                      queryId: search.queryId,
                    })
                  } else {
                    registerSelectionGeneration(transaction, {
                      jobId: params.deepSearchJobId,
                      queryId: search.queryId,
                      generationId,
                    })
                  }
                },
                onCompleted: (completed, transaction) => {
                  completedSelectedPages = saveSelectedResults(transaction, {
                    jobId: params.deepSearchJobId,
                    queryId: search.queryId,
                    selectionGenerationId: completed.id,
                    selectedResultIds: completed.output,
                  })
                },
              }),
            )
            yield* workflowEffect(async () => {
              try {
                params.publish({
                  type: "selection-stream",
                  round: roundPosition,
                  query: search.query,
                  streamId: selectionGeneration.streamId,
                })
              } catch (error) {
                await selectionGeneration.selectedIds.catch(() => undefined)
                throw error
              }
            })
            selectedIds = yield* workflowEffect(
              () => selectionGeneration.selectedIds,
            )
            selectionGenerationId = selectionGeneration.streamId
          }
          const selectedResultIds = [
            ...new Set(
              selectedIds.filter((id) =>
                search.results.some(({ resultId }) => resultId === id),
              ),
            ),
          ]
          selectedPages = completedSelectedPages ??
            (yield* workflowEffect(() => {
              const completedQuery = loadSnapshot(params.deepSearchJobId)
                .rounds.find(
                  ({ roundId }) => roundId === persistedRound.roundId,
                )
                ?.queries.find(({ queryId }) => queryId === search.queryId)
              if (!completedQuery) {
                throw new Error("Search query was not persisted")
              }
              if (completedQuery.status !== "selecting") {
                const completedPagesById = new Map(
                  loadSnapshot(params.deepSearchJobId).pages.map((page) => [
                    page.pageId,
                    page,
                  ]),
                )
                return selectedPagesFromSnapshot(
                  completedQuery,
                  completedPagesById,
                )
              }
              return saveSelectedResults({
                jobId: params.deepSearchJobId,
                queryId: search.queryId,
                selectionGenerationId,
                selectedResultIds,
              })
            }))
          yield* workflowEffect(() => {
            params.publish({
              type: "selected-search-results",
              round: roundPosition,
              query: search.query,
              selectedLinks: selectedPages.map(({ url }) => url),
            })
          })
        }

        for (const page of selectedPages) {
          if (pagesToSummarize.has(page.url)) continue
          pagesToSummarize.set(page.url, page)
        }
      }

      snapshot = yield* workflowEffect(() =>
        loadSnapshot(params.deepSearchJobId),
      )
      const pagesById = new Map(
        snapshot.pages.map((page) => [page.pageId, page]),
      )
      const pageSummaryTasks = new Map<string, Promise<string | undefined>>()
      for (const page of pagesToSummarize.values()) {
        const snapshotPage = pagesById.get(page.pageId)
        if (!snapshotPage) {
          throw new WorkflowFailure({
            message: "Selected page was not persisted",
          })
        }
        pageSummaryTasks.set(
          page.url,
          addAbortableQueueTask(
            pageSummaryQueue,
            () =>
              summarizeSelectedPage(
                durableParams,
                snapshotPage,
                strictQuality,
              ),
            durableParams.workflowSignal,
          ),
        )
      }

      const settledPageSummaries = yield* settleAll(
        [...pageSummaryTasks].map(([url, task]) =>
          workflowEffect(async () => {
            const summary = await task
            return [url, summary] as const
          }),
        ),
      )
      for (const [url, summary] of settledPageSummaries) {
        pageSummaries.set(url, summary)
      }

      const roundSummaries = yield* settleAll(
        executedQueries.map((search) =>
          workflowEffect(async () => {
            if (search.results.length === 0) {
              return {
                round: roundPosition,
                query: search.query,
                content: EMPTY_SEARCH_SUMMARY,
              }
            }
            const current = loadSnapshot(params.deepSearchJobId)
              .rounds.find(({ roundId }) => roundId === persistedRound.roundId)
              ?.queries.find(({ queryId }) => queryId === search.queryId)
            if (!current) throw new Error("Search query was not persisted")
            if (
              current.status === "completed" &&
              current.summaryGeneration?.status === "completed"
            ) {
              return {
                round: roundPosition,
                query: search.query,
                content: completedText(current.summaryGeneration).trim(),
              }
            }
            const previousSummary = current.summaryGeneration
            const generation = await summarizeSearchQuery({
              userId: durableParams.userId,
              deepSearchJobId: durableParams.deepSearchJobId,
              researchRequest: durableParams.researchRequest,
              query: search.query,
              results: search.results.map((result) => ({
                title: result.title,
                url: result.url,
                content: pageSummaries.get(result.url) || result.shortText,
              })),
              workflowSignal: durableParams.workflowSignal,
              onRegistered: (generationId, transaction) => {
                if (previousSummary) {
                  replaceQuerySummaryGeneration(transaction, {
                    ...replacementInput(
                      params.deepSearchJobId,
                      previousSummary,
                      generationId,
                    ),
                    queryId: search.queryId,
                  })
                } else {
                  attachQuerySummaryGeneration(transaction, {
                    jobId: params.deepSearchJobId,
                    queryId: search.queryId,
                    generationId,
                  })
                }
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
                round: roundPosition,
                query: search.query,
                streamId: generation.streamId,
              })
            } catch (error) {
              await generation.summary.catch(() => undefined)
              throw error
            }
            return {
              round: roundPosition,
              query: search.query,
              content: (await generation.summary).trim(),
            }
          }),
        ),
      )
      searchSummaries.push(...roundSummaries)

      snapshot = yield* workflowEffect(() =>
        loadSnapshot(params.deepSearchJobId),
      )
      snapshotRound = snapshot.rounds.find(
        ({ roundId }) => roundId === persistedRound.roundId,
      )
      if (!snapshotRound) {
        throw new WorkflowFailure({ message: "Round was not persisted" })
      }
      let answerGenerationId: string
      let candidateAnswer: string
      if (snapshotRound.answerGeneration?.status === "completed") {
        answerGenerationId = snapshotRound.answerGeneration.generationId
        candidateAnswer = completedText(snapshotRound.answerGeneration)
      } else {
        const previousAnswer = snapshotRound.answerGeneration
        const candidate = yield* workflowEffect(() =>
          answerResearchRequest({
            userId: durableParams.userId,
            deepSearchJobId: durableParams.deepSearchJobId,
            researchRequest: durableParams.researchRequest,
            searchSummaries: [...searchSummaries],
            workflowSignal: durableParams.workflowSignal,
            onRegistered: (generationId, transaction) => {
              if (previousAnswer) {
                replaceRoundAnswerGeneration(transaction, {
                  ...replacementInput(
                    params.deepSearchJobId,
                    previousAnswer,
                    generationId,
                  ),
                  roundId: persistedRound.roundId,
                })
              } else {
                attachRoundAnswerGeneration(transaction, {
                  jobId: params.deepSearchJobId,
                  roundId: persistedRound.roundId,
                  generationId,
                })
              }
            },
          }),
        )
        yield* workflowEffect(async () => {
          try {
            params.publish({
              type: "round-answer-stream",
              round: roundPosition,
              streamId: candidate.streamId,
            })
          } catch (error) {
            await candidate.answer.catch(() => undefined)
            throw error
          }
        })
        candidateAnswer = yield* workflowEffect(() => candidate.answer)
        answerGenerationId = candidate.streamId
      }

      if (roundPosition + 1 >= maxRounds) {
        yield* promotePersistedCandidate(
          persistedRound,
          answerGenerationId,
          candidateAnswer,
        )
        return candidateAnswer
      }

      snapshot = yield* workflowEffect(() =>
        loadSnapshot(params.deepSearchJobId),
      )
      snapshotRound = snapshot.rounds.find(
        ({ roundId }) => roundId === persistedRound.roundId,
      )
      if (!snapshotRound) {
        throw new WorkflowFailure({ message: "Round was not persisted" })
      }
      let decision: RoundReview | undefined
      let decisionWasPersisted = false
      if (snapshotRound.reviewError !== null) {
        decision = undefined
      } else if (
        snapshotRound.reviewDecision !== null &&
        snapshotRound.reviewReason !== null
      ) {
        decision = {
          decision: snapshotRound.reviewDecision,
          reason: snapshotRound.reviewReason,
        }
        decisionWasPersisted = true
      } else {
        decision = yield* workflowEffect(() =>
          reviewSearchRound(
            durableParams,
            persistedRound,
            maxRounds,
            searchSummaries,
            candidateAnswer,
            snapshotRound.reviewGeneration ?? undefined,
          ),
        )
      }
      if (!decision) {
        yield* promotePersistedCandidate(
          persistedRound,
          answerGenerationId,
          candidateAnswer,
        )
        return candidateAnswer
      }

      if (!decisionWasPersisted) {
        yield* workflowEffect(() =>
          params.publish({
            type: "round-review",
            round: roundPosition,
            ...decision,
          }),
        )
      }
      if (decision.decision === "stop") {
        yield* promotePersistedCandidate(
          persistedRound,
          answerGenerationId,
          candidateAnswer,
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
