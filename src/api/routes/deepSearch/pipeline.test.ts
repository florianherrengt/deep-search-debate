import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  analyzeResearchAnswer: vi.fn<
    typeof import("../../agents/deep_search/researchAnalysis.ts").analyzeResearchAnswer
  >(),
  answerResearchRequest: vi.fn<
    typeof import("../../agents/deep_search/finalAnswer.ts").answerResearchRequest
  >(),
  attachPageSummaryGeneration: vi.fn<
    typeof import("./store.ts").attachPageSummaryGeneration
  >(),
  attachQuerySummaryGeneration: vi.fn<
    typeof import("./store.ts").attachQuerySummaryGeneration
  >(),
  attachRoundAnswerGeneration: vi.fn<
    typeof import("./store.ts").attachRoundAnswerGeneration
  >(),
  attachRoundReviewGeneration: vi.fn<
    typeof import("./store.ts").attachRoundReviewGeneration
  >(),
  attachResearchAnalysisGeneration: vi.fn<
    typeof import("./store.ts").attachResearchAnalysisGeneration
  >(),
  completePageSummaryGeneration: vi.fn<
    typeof import("./store.ts").completePageSummaryGeneration
  >(),
  completeEmptySearchQuery: vi.fn<
    typeof import("./store.ts").completeEmptySearchQuery
  >(),
  completeQuerySummaryGeneration: vi.fn<
    typeof import("./store.ts").completeQuerySummaryGeneration
  >(),
  failPageSummaryGeneration: vi.fn(),
  failQuerySummaryGeneration: vi.fn(),
  generateWebSearchQueries: vi.fn<
    typeof import("../../agents/deep_search/queries.ts").generateWebSearchQueries
  >(),
  interruptPageSummaryGeneration: vi.fn(),
  interruptQuerySummaryGeneration: vi.fn(),
  interruptRoundReviewGeneration: vi.fn(),
  loadDeepSearchExecutionSnapshot: vi.fn<
    typeof import("./store.ts").loadDeepSearchExecutionSnapshot
  >(),
  promoteRoundAnswer: vi.fn(),
  registerSearchRound: vi.fn<
    typeof import("./store.ts").registerSearchRound
  >(),
  registerSelectionGeneration: vi.fn<
    typeof import("./store.ts").registerSelectionGeneration
  >(),
  replacePageSummaryGeneration: vi.fn<
    typeof import("./store.ts").replacePageSummaryGeneration
  >(),
  replaceQuerySelectionGeneration: vi.fn(),
  replaceQuerySummaryGeneration: vi.fn(),
  replaceResearchAnalysisGeneration: vi.fn(),
  replaceRoundAnswerGeneration: vi.fn(),
  replaceRoundPlanningGeneration: vi.fn(),
  replaceRoundReviewGeneration: vi.fn(),
  resetPageExtraction: vi.fn(),
  resetWebSearchQuery: vi.fn(),
  savePageFailure: vi.fn<typeof import("./store.ts").savePageFailure>(),
  savePlannedQueries: vi.fn<typeof import("./store.ts").savePlannedQueries>(),
  saveRoundReviewCompletion: vi.fn<
    typeof import("./store.ts").saveRoundReviewCompletion
  >(),
  saveRoundReviewFailure: vi.fn<
    typeof import("./store.ts").saveRoundReviewFailure
  >(),
  saveSelectedResults: vi.fn<typeof import("./store.ts").saveSelectedResults>(),
  selectWebSearchResults: vi.fn<
    typeof import("../../agents/deep_search/selection.ts").selectWebSearchResults
  >(),
  settlePageExtraction: vi.fn<
    typeof import("./store.ts").settlePageExtraction
  >(),
  settleWebSearchQuery: vi.fn<
    typeof import("./store.ts").settleWebSearchQuery
  >(),
  startPageSummary: vi.fn<
    typeof import("../../agents/deep_search/summaries.ts").startPageSummary
  >(),
  startRoundReview: vi.fn<
    typeof import("../../agents/deep_search/reviewRound.ts").startRoundReview
  >(),
  summarizePage: vi.fn<
    typeof import("../../agents/deep_search/summaries.ts").summarizePage
  >(),
  summarizeSearchQuery: vi.fn(),
  webSearch: vi.fn(),
}))

vi.mock("../../agents/deep_search/finalAnswer.ts", () => ({
  answerResearchRequest: mocks.answerResearchRequest,
}))

vi.mock("../../agents/deep_search/researchAnalysis.ts", () => ({
  analyzeResearchAnswer: mocks.analyzeResearchAnswer,
}))

vi.mock("../../agents/deep_search/queries.ts", () => ({
  generateWebSearchQueries: mocks.generateWebSearchQueries,
}))

vi.mock("../../agents/deep_search/selection.ts", () => ({
  selectWebSearchResults: mocks.selectWebSearchResults,
}))

vi.mock("../../agents/deep_search/summaries.ts", () => ({
  startPageSummary: mocks.startPageSummary,
  summarizePage: mocks.summarizePage,
}))

vi.mock("../../agents/deep_search/querySummaries.ts", () => ({
  summarizeSearchQuery: mocks.summarizeSearchQuery,
}))

vi.mock("../../agents/deep_search/reviewRound.ts", () => ({
  startRoundReview: mocks.startRoundReview,
}))

vi.mock("../../web_search/index.ts", () => ({
  webSearch: mocks.webSearch,
}))

vi.mock("./store.ts", () => ({
  attachPageSummaryGeneration: mocks.attachPageSummaryGeneration,
  attachQuerySummaryGeneration: mocks.attachQuerySummaryGeneration,
  attachRoundAnswerGeneration: mocks.attachRoundAnswerGeneration,
  attachRoundReviewGeneration: mocks.attachRoundReviewGeneration,
  attachResearchAnalysisGeneration: mocks.attachResearchAnalysisGeneration,
  completePageSummaryGeneration: mocks.completePageSummaryGeneration,
  completeEmptySearchQuery: mocks.completeEmptySearchQuery,
  completeQuerySummaryGeneration: mocks.completeQuerySummaryGeneration,
  failPageSummaryGeneration: mocks.failPageSummaryGeneration,
  failQuerySummaryGeneration: mocks.failQuerySummaryGeneration,
  interruptPageSummaryGeneration: mocks.interruptPageSummaryGeneration,
  interruptQuerySummaryGeneration: mocks.interruptQuerySummaryGeneration,
  interruptRoundReviewGeneration: mocks.interruptRoundReviewGeneration,
  loadDeepSearchExecutionSnapshot: mocks.loadDeepSearchExecutionSnapshot,
  registerSearchRound: mocks.registerSearchRound,
  registerSelectionGeneration: mocks.registerSelectionGeneration,
  replacePageSummaryGeneration: mocks.replacePageSummaryGeneration,
  replaceQuerySelectionGeneration: mocks.replaceQuerySelectionGeneration,
  replaceQuerySummaryGeneration: mocks.replaceQuerySummaryGeneration,
  replaceResearchAnalysisGeneration: mocks.replaceResearchAnalysisGeneration,
  replaceRoundAnswerGeneration: mocks.replaceRoundAnswerGeneration,
  replaceRoundPlanningGeneration: mocks.replaceRoundPlanningGeneration,
  replaceRoundReviewGeneration: mocks.replaceRoundReviewGeneration,
  resetPageExtraction: mocks.resetPageExtraction,
  resetWebSearchQuery: mocks.resetWebSearchQuery,
  savePageFailure: mocks.savePageFailure,
  savePlannedQueries: mocks.savePlannedQueries,
  saveRoundReviewCompletion: mocks.saveRoundReviewCompletion,
  saveRoundReviewFailure: mocks.saveRoundReviewFailure,
  saveSelectedResults: mocks.saveSelectedResults,
  settlePageExtraction: mocks.settlePageExtraction,
  settleWebSearchQuery: mocks.settleWebSearchQuery,
}))

vi.mock("./jobLifecycle.ts", () => ({
  promoteRoundAnswer: mocks.promoteRoundAnswer,
}))

import type {
  DeepSearchEvent,
} from "../../agents/deep_search/schemas.ts"
import type { RoundReview } from "../../agents/deep_search/reviewRound.ts"
import { config } from "../../config.ts"
import type {
  TextGenerationPersistenceCallbacks,
  TextStreamPersistenceTransaction,
} from "../../llms/streams.ts"
import type {
  DeepSearchExecutionSnapshot,
  ExecutedQuery,
  PlannedQuery,
} from "./records.ts"
import { runDeepSearchPipeline as deepSearch } from "./pipeline.ts"

const ignoreEvent = (_event: DeepSearchEvent) => undefined
const transaction = {} as TextStreamPersistenceTransaction
const resultsByQueryId = new Map<string, ExecutedQuery["results"]>()
let executionSnapshot: DeepSearchExecutionSnapshot

function emptySnapshot(): DeepSearchExecutionSnapshot {
  return {
    jobId: "deep-search-job-id",
    userId: "test-user-id",
    ideaJobId: null,
    researchRequest: "Research this",
    maxSearches: 3,
    maxResultsPerSearch: 3,
    maxRounds: 3,
    strictQuality: false,
    status: "running",
    error: null,
    cancelRequestedAt: null,
    completedAt: null,
    finalAnswerGeneration: null,
    researchAnalysisGeneration: null,
    rounds: [],
    pages: [],
  }
}

function persistedGeneration(
  generationId: string,
  status: "running" | "completed" | "failed" | "interrupted" = "running",
  text: string | null = null,
) {
  return {
    generationId,
    status,
    text,
    reasoning: status === "completed" ? "" : null,
    error: status === "failed" || status === "interrupted" ? "failed" : null,
  }
}

const results = [
  {
    title: "Result",
    shortText: "Useful result",
    link: "https://example.com/result",
  },
]

const researchAnalysis = {
  facts: [
    {
      title: "Supported finding",
      description: "The evidence supports this finding.",
      sources: ["https://example.com/result"],
    },
  ],
  disagreements: [],
  gaps: [],
  assumptions: [],
}

function completedOutcome(text: string) {
  return Promise.resolve({
    status: "completed" as const,
    text,
    reasoning: "",
  })
}

function queryGeneration(
  queries: string[],
  streamId = "query-stream-id",
) {
  return {
    streamId,
    queries: Promise.resolve(queries),
    completion: completedOutcome("[]"),
  }
}

function selectionGeneration(
  selectedIds: string[],
  streamId = "selection-stream-id",
) {
  return {
    streamId,
    selectedIds: Promise.resolve(selectedIds),
    completion: completedOutcome("[]"),
  }
}

function registeredQueryGeneration(
  input: Parameters<typeof import("../../agents/deep_search/queries.ts").generateWebSearchQueries>[0],
  queries: string[],
  streamId = "query-stream-id",
) {
  const generation = queryGeneration(queries, streamId)
  input.onRegistered?.(streamId, transaction)
  void generation.queries.then((output) => {
    const round = executionSnapshot.rounds.find(
      ({ planningGeneration }) =>
        planningGeneration.generationId === streamId,
    )
    if (round) {
      round.planningGeneration = persistedGeneration(
        streamId,
        "completed",
        JSON.stringify(output),
      )
    }
    input.onCompleted?.({ id: streamId, output }, transaction)
  })
  return Promise.resolve(generation)
}

function registeredSelectionGeneration(
  input: Parameters<typeof import("../../agents/deep_search/selection.ts").selectWebSearchResults>[0],
  ids: string[],
  streamId = "selection-stream-id",
) {
  const knownIds = new Set(input.results.map(({ id }) => id))
  const normalizedIds = [...new Set(ids.filter((id) => knownIds.has(id)))].slice(
    0,
    input.maxResultsToExplore ?? 3,
  )
  const generation = selectionGeneration(normalizedIds, streamId)
  input.onRegistered?.(streamId, transaction)
  void generation.selectedIds.then((output) => {
    const query = executionSnapshot.rounds
      .flatMap(({ queries }) => queries)
      .find(
        ({ selectionGeneration }) =>
          selectionGeneration?.generationId === streamId,
      )
    if (query) {
      query.selectionGeneration = persistedGeneration(
        streamId,
        "completed",
        JSON.stringify(output),
      )
    }
    input.onCompleted?.({ id: streamId, output }, transaction)
  })
  return Promise.resolve(generation)
}

function pageSummaryStart(
  summary: string | undefined,
  streamId = "summary-stream-id",
) {
  return {
    status: "started" as const,
    streamId,
    summary: Promise.resolve(summary),
    completion: completedOutcome(summary ?? ""),
  }
}

function createPublisher() {
  return vi.fn<(event: DeepSearchEvent) => void>()
}

function getPublishOrder(
  publish: ReturnType<typeof createPublisher>,
  type: DeepSearchEvent["type"],
): number {
  const index = publish.mock.calls.findIndex(([event]) => event.type === type)
  const order = publish.mock.invocationCallOrder[index]
  if (order === undefined) throw new Error(`Event was not published: ${type}`)
  return order
}

describe("deepSearch", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resultsByQueryId.clear()
    executionSnapshot = emptySnapshot()
    mocks.loadDeepSearchExecutionSnapshot.mockImplementation(
      () => executionSnapshot,
    )
    mocks.registerSearchRound.mockImplementation(
      (_transaction, { position, generationId }) => {
        const storedRound = {
          roundId: `round-${position}`,
          position,
          planningGeneration: persistedGeneration(generationId),
          answerGeneration: null,
          reviewGeneration: null,
          reviewDecision: null,
          reviewReason: null,
          reviewError: null,
          reviewCompletedAt: null,
          queries: [],
        }
        executionSnapshot.rounds.push(storedRound)
        return {
          roundId: storedRound.roundId,
          position,
          generationId,
        }
      },
    )
    mocks.registerSelectionGeneration.mockImplementation(
      (_transaction, { queryId, generationId }) => {
        const query = executionSnapshot.rounds
          .flatMap(({ queries }) => queries)
          .find((candidate) => candidate.queryId === queryId)
        if (!query) throw new Error("Missing query")
        query.selectionGeneration = persistedGeneration(generationId)
      },
    )
    mocks.settleWebSearchQuery.mockImplementation(
      ({ plannedQuery, results: searchResults, creditsUsed = 0 }) => {
        const query = executionSnapshot.rounds
          .flatMap(({ queries }) => queries)
          .find((candidate) => candidate.queryId === plannedQuery.queryId)
        if (!query) throw new Error("Missing query")
        const storedResults = searchResults.map((result, position) => ({
          resultId: `result:${plannedQuery.query}:${result.link}`,
          position,
          title: result.title,
          shortText: result.shortText,
          url: result.link,
          selectedWebPageId: null,
        }))
        query.creditsUsed = creditsUsed
        query.status = "selecting"
        query.results = storedResults
        resultsByQueryId.set(
          plannedQuery.queryId,
          storedResults.map(({ selectedWebPageId: _, ...result }) => result),
        )
        return {
          ...plannedQuery,
          creditsUsed,
          results: storedResults.map(({ selectedWebPageId: _, ...result }) => result),
        }
      },
    )
    mocks.settlePageExtraction.mockImplementation(
      ({ pageId, content, creditsUsed }) => {
        const page = executionSnapshot.pages.find(
          (candidate) => candidate.pageId === pageId,
        )
        if (!page) throw new Error("Missing page")
        page.status = "summarizing"
        page.extractedContent = content
        page.creditsUsed = creditsUsed
        return { content, creditsUsed }
      },
    )
    mocks.attachPageSummaryGeneration.mockImplementation(
      (_transaction, { pageId, generationId }) => {
        const page = executionSnapshot.pages.find(
          (candidate) => candidate.pageId === pageId,
        )
        if (!page) throw new Error("Missing page")
        page.status = "summarizing"
        page.summaryGeneration = persistedGeneration(generationId)
      },
    )
    mocks.replacePageSummaryGeneration.mockImplementation(
      (_transaction, { pageId, newGenerationId }) => {
        const page = executionSnapshot.pages.find(
          (candidate) => candidate.pageId === pageId,
        )
        if (!page) throw new Error("Missing page")
        page.status = "summarizing"
        page.errorStage = null
        page.errorMessage = null
        page.summaryGeneration = persistedGeneration(newGenerationId)
      },
    )
    mocks.completePageSummaryGeneration.mockImplementation(
      (_transaction, { pageId }) => {
        const page = executionSnapshot.pages.find(
          (candidate) => candidate.pageId === pageId,
        )
        if (!page) throw new Error("Missing page")
        page.status = "completed"
        page.completedAt = new Date()
      },
    )
    mocks.attachQuerySummaryGeneration.mockImplementation(
      (_transaction, { queryId, generationId }) => {
        const query = executionSnapshot.rounds
          .flatMap(({ queries }) => queries)
          .find((candidate) => candidate.queryId === queryId)
        if (!query) throw new Error("Missing query")
        query.summaryGeneration = persistedGeneration(generationId)
      },
    )
    mocks.completeQuerySummaryGeneration.mockImplementation(
      (_transaction, { queryId }) => {
        const query = executionSnapshot.rounds
          .flatMap(({ queries }) => queries)
          .find((candidate) => candidate.queryId === queryId)
        if (!query) throw new Error("Missing query")
        query.status = "completed"
        query.completedAt = new Date()
      },
    )
    mocks.attachRoundAnswerGeneration.mockImplementation(
      (_transaction, { roundId, generationId }) => {
        const round = executionSnapshot.rounds.find(
          (candidate) => candidate.roundId === roundId,
        )
        if (!round) throw new Error("Missing round")
        round.answerGeneration = persistedGeneration(generationId)
      },
    )
    mocks.attachRoundReviewGeneration.mockImplementation(
      (_transaction, { roundId, generationId }) => {
        const round = executionSnapshot.rounds.find(
          (candidate) => candidate.roundId === roundId,
        )
        if (!round) throw new Error("Missing round")
        round.reviewGeneration = persistedGeneration(generationId)
      },
    )
    mocks.saveRoundReviewCompletion.mockImplementation(
      (_transaction, { roundId, review }) => {
        const round = executionSnapshot.rounds.find(
          (candidate) => candidate.roundId === roundId,
        )
        if (!round) throw new Error("Missing round")
        round.reviewDecision = review.decision
        round.reviewReason = review.reason
        round.reviewCompletedAt = new Date()
      },
    )
    mocks.saveRoundReviewFailure.mockImplementation(
      ({ roundId, message }) => {
        const round = executionSnapshot.rounds.find(
          (candidate) => candidate.roundId === roundId,
        )
        if (!round) throw new Error("Missing round")
        round.reviewError = message
        round.reviewCompletedAt = new Date()
      },
    )
    mocks.attachResearchAnalysisGeneration.mockImplementation(
      (_transaction, { generationId }) => {
        executionSnapshot.researchAnalysisGeneration =
          persistedGeneration(generationId)
      },
    )
    mocks.completeEmptySearchQuery.mockImplementation(({ queryId }) => {
      const query = executionSnapshot.rounds
        .flatMap(({ queries }) => queries)
        .find((candidate) => candidate.queryId === queryId)
      if (!query) throw new Error("Missing query")
      query.status = "completed"
      query.completedAt = new Date()
    })
    mocks.savePageFailure.mockImplementation(({ pageId, stage, message }) => {
      const page = executionSnapshot.pages.find(
        (candidate) => candidate.pageId === pageId,
      )
      if (!page) throw new Error("Missing page")
      page.status = "failed"
      page.errorStage = stage
      page.errorMessage = message
      page.completedAt = new Date()
    })

    mocks.generateWebSearchQueries.mockImplementation((input) => {
      const generation = queryGeneration(["test query"])
      input.onRegistered?.(generation.streamId, transaction)
      void generation.queries.then((queries) => {
        const round = executionSnapshot.rounds.at(-1)
        if (round) {
          round.planningGeneration = persistedGeneration(
            generation.streamId,
            "completed",
            JSON.stringify(queries),
          )
        }
        input.onCompleted?.(
          { id: generation.streamId, output: queries },
          transaction,
        )
      })
      return Promise.resolve(generation)
    })
    mocks.savePlannedQueries.mockImplementation(
      (
        transactionOrInput:
          | TextStreamPersistenceTransaction
          | { roundId: string; queries: string[] },
        transactionalInput?: { roundId: string; queries: string[] },
      ): PlannedQuery[] => {
        const { roundId, queries } = transactionalInput ??
          transactionOrInput as { roundId: string; queries: string[] }
        const planned = queries.map((query, position) => ({
          queryId: `query:${query}`,
          position,
          query,
        }))
        const round = executionSnapshot.rounds.find(
          (candidate) => candidate.roundId === roundId,
        )
        if (!round) throw new Error("Missing round")
        round.queries = planned.map((query) => ({
          ...query,
          creditsUsed: null,
          status: "searching" as const,
          selectionGeneration: null,
          summaryGeneration: null,
          errorStage: null,
          errorMessage: null,
          completedAt: null,
          results: [],
        }))
        return planned
      },
    )
    mocks.webSearch.mockResolvedValue(results)
    mocks.selectWebSearchResults.mockImplementation((input) => {
      const generation = selectionGeneration(
        input.results.slice(0, 1).map(({ id }) => id),
      )
      input.onRegistered?.(generation.streamId, transaction)
      void generation.selectedIds.then((selectedIds) => {
        const query = executionSnapshot.rounds
          .flatMap(({ queries }) => queries)
          .find(
            (candidate) =>
              candidate.selectionGeneration?.generationId === generation.streamId,
          )
        if (query) {
          query.selectionGeneration = persistedGeneration(
            generation.streamId,
            "completed",
            JSON.stringify(selectedIds),
          )
        }
        input.onCompleted?.(
          { id: generation.streamId, output: selectedIds },
          transaction,
        )
      })
      return Promise.resolve(generation)
    })
    mocks.saveSelectedResults.mockImplementation(
      (
        transactionOrInput:
          | TextStreamPersistenceTransaction
          | { queryId: string; selectedResultIds: string[] },
        transactionalInput?: {
          queryId: string
          selectedResultIds: string[]
        },
      ) => {
        const { queryId, selectedResultIds } = transactionalInput ??
          transactionOrInput as {
            queryId: string
            selectedResultIds: string[]
          }
        const storedResults = resultsByQueryId.get(queryId) ?? []
        const urlsById = new Map(
          storedResults.map((result) => [result.resultId, result.url]),
        )
        const pages = selectedResultIds.flatMap((resultId) => {
          const url = urlsById.get(resultId)
          return url ? [{ pageId: `page:${url}`, url }] : []
        })
        const query = executionSnapshot.rounds
          .flatMap(({ queries }) => queries)
          .find((candidate) => candidate.queryId === queryId)
        if (!query) throw new Error("Missing query")
        query.status = "summarizing"
        for (const page of pages) {
          let storedPage = executionSnapshot.pages.find(
            ({ pageId }) => pageId === page.pageId,
          )
          if (!storedPage) {
            storedPage = {
              ...page,
              creditsUsed: null,
              status: "extracting",
              extractedContent: null,
              summaryGeneration: null,
              errorStage: null,
              errorMessage: null,
              completedAt: null,
            }
            executionSnapshot.pages.push(storedPage)
          }
          const result = query.results.find(({ resultId }) =>
            selectedResultIds.includes(resultId),
          )
          if (result) result.selectedWebPageId = storedPage.pageId
        }
        return pages
      },
    )
    mocks.startPageSummary.mockImplementation(
      (input: TextGenerationPersistenceCallbacks & {
        onExtractionSettled?: (settlement: {
          content: string
          creditsUsed: number
        }) => void
      }) => {
        const streamId = "summary-stream-id"
        input.onExtractionSettled?.({
          content: "Extracted page content",
          creditsUsed: 0,
        })
        input.onRegistered?.(streamId, transaction)
        const completion = completedOutcome("Completed page summary")
        return Promise.resolve({
          status: "started" as const,
          streamId,
          summary: completion.then((outcome) => {
            const page = executionSnapshot.pages.find(
              ({ summaryGeneration }) =>
                summaryGeneration?.generationId === streamId,
            )
            if (page) {
              page.summaryGeneration = persistedGeneration(
                streamId,
                "completed",
                outcome.text,
              )
            }
            input.onCompleted?.(
              { id: streamId, text: outcome.text, reasoning: outcome.reasoning },
              transaction,
            )
            return outcome.text
          }),
          completion,
        })
      },
    )
    mocks.summarizePage.mockImplementation(
      (input: TextGenerationPersistenceCallbacks) => {
        const streamId = "retried-page-summary-stream-id"
        input.onRegistered?.(streamId, transaction)
        const completion = completedOutcome("Retried page summary")
        return Promise.resolve({
          streamId,
          completion: completion.then((outcome) => {
            const page = executionSnapshot.pages.find(
              ({ summaryGeneration }) =>
                summaryGeneration?.generationId === streamId,
            )
            if (page) {
              page.summaryGeneration = persistedGeneration(
                streamId,
                "completed",
                outcome.text,
              )
            }
            input.onCompleted?.(
              { id: streamId, text: outcome.text, reasoning: outcome.reasoning },
              transaction,
            )
            return outcome
          }),
        })
      },
    )
    mocks.summarizeSearchQuery.mockImplementation(
      (input: TextGenerationPersistenceCallbacks) => {
        const streamId = "query-summary-stream-id"
        input.onRegistered?.(streamId, transaction)
        const completion = completedOutcome("Completed query summary")
        return Promise.resolve({
          streamId,
          summary: completion.then((outcome) => {
            const query = executionSnapshot.rounds
              .flatMap(({ queries }) => queries)
              .find(
                ({ summaryGeneration }) =>
                  summaryGeneration?.generationId === streamId,
              )
            if (query) {
              query.summaryGeneration = persistedGeneration(
                streamId,
                "completed",
                outcome.text,
              )
            }
            input.onCompleted?.(
              { id: streamId, text: outcome.text, reasoning: outcome.reasoning },
              transaction,
            )
            return outcome.text
          }),
          completion,
        })
      },
    )
    mocks.startRoundReview.mockImplementation(
      (input: {
        onCompleted?: (
          completed: { id: string; output: RoundReview },
          transaction: TextStreamPersistenceTransaction,
        ) => void
        onRegistered?: (
          streamId: string,
          transaction: TextStreamPersistenceTransaction,
        ) => void
      }) => {
        const streamId = "round-review-stream-id"
        const decision: RoundReview = {
          decision: "stop",
          reason: "The available evidence is sufficient.",
        }
        input.onRegistered?.(streamId, transaction)
        return Promise.resolve({
          streamId,
          review: Promise.resolve().then(() => {
            const round = executionSnapshot.rounds.find(
              ({ reviewGeneration }) =>
                reviewGeneration?.generationId === streamId,
            )
            if (round) {
              round.reviewGeneration = persistedGeneration(
                streamId,
                "completed",
                JSON.stringify(decision),
              )
            }
            input.onCompleted?.(
              { id: streamId, output: decision },
              transaction,
            )
            return decision
          }),
          completion: completedOutcome(JSON.stringify(decision)),
        })
      },
    )
    mocks.answerResearchRequest.mockImplementation(
      (input: TextGenerationPersistenceCallbacks) => {
        const round = mocks.answerResearchRequest.mock.calls.length - 1
        const streamId = `round-answer-stream-${round}`
        input.onRegistered?.(streamId, transaction)
        const completion = completedOutcome("Completed answer")
        return Promise.resolve({
          streamId,
          answer: completion.then(({ text, reasoning }) => {
            const storedRound = executionSnapshot.rounds.find(
              ({ answerGeneration }) =>
                answerGeneration?.generationId === streamId,
            )
            if (storedRound) {
              storedRound.answerGeneration = persistedGeneration(
                streamId,
                "completed",
                text,
              )
            }
            input.onCompleted?.(
              { id: streamId, text, reasoning },
              transaction,
            )
            return text
          }),
          completion,
        })
      },
    )
    mocks.analyzeResearchAnswer.mockImplementation(
      (input) => {
        const generationId = "research-analysis-generation-id"
        input.onRegistered?.(generationId, transaction)
        executionSnapshot.researchAnalysisGeneration = persistedGeneration(
          generationId,
          "completed",
          JSON.stringify(researchAnalysis),
        )
        return Promise.resolve({
          generationId,
          analysis: Promise.resolve(researchAnalysis),
          completion: completedOutcome(JSON.stringify(researchAnalysis)),
        })
      },
    )
  })

  it("persists each stage before publishing the existing event sequence", async () => {
    const publish = createPublisher()

    await expect(
      deepSearch({
        userId: "test-user-id",
        deepSearchJobId: "deep-search-job-id",
        researchRequest: "Research this",
        publish,
      }),
    ).resolves.toBe("Completed answer")

    expect(publish.mock.calls.map(([event]) => event)).toEqual([
      { type: "query-stream", round: 0, streamId: "query-stream-id" },
      {
        type: "search-results",
        round: 0,
        searches: [{ query: "test query", results }],
      },
      {
        type: "selection-stream",
        round: 0,
        query: "test query",
        streamId: "selection-stream-id",
      },
      {
        type: "selected-search-results",
        round: 0,
        query: "test query",
        selectedLinks: ["https://example.com/result"],
      },
      {
        type: "page-summary-stream",
        url: "https://example.com/result",
        streamId: "summary-stream-id",
      },
      {
        type: "query-summary-stream",
        round: 0,
        query: "test query",
        streamId: "query-summary-stream-id",
      },
      {
        type: "round-answer-stream",
        round: 0,
        streamId: "round-answer-stream-0",
      },
      {
        type: "round-review-stream",
        round: 0,
        streamId: "round-review-stream-id",
      },
      {
        type: "round-review",
        round: 0,
        decision: "stop",
        reason: "The available evidence is sufficient.",
      },
      {
        type: "final-answer-stream",
        streamId: "round-answer-stream-0",
      },
      { type: "research-analysis", analysis: researchAnalysis },
    ])

    expect(mocks.registerSearchRound.mock.invocationCallOrder[0]).toBeLessThan(
      getPublishOrder(publish, "query-stream"),
    )
    expect(mocks.savePlannedQueries.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.webSearch.mock.invocationCallOrder[0] ?? 0,
    )
    expect(mocks.settleWebSearchQuery.mock.invocationCallOrder[0]).toBeLessThan(
      getPublishOrder(publish, "search-results"),
    )
    expect(mocks.registerSelectionGeneration.mock.invocationCallOrder[0]).toBeLessThan(
      getPublishOrder(publish, "selection-stream"),
    )
    expect(mocks.saveSelectedResults.mock.invocationCallOrder[0]).toBeLessThan(
      getPublishOrder(publish, "selected-search-results"),
    )
    expect(mocks.attachPageSummaryGeneration.mock.invocationCallOrder[0]).toBeLessThan(
      getPublishOrder(publish, "page-summary-stream"),
    )
    expect(mocks.attachQuerySummaryGeneration.mock.invocationCallOrder[0]).toBeLessThan(
      getPublishOrder(publish, "query-summary-stream"),
    )
    expect(mocks.attachRoundAnswerGeneration.mock.invocationCallOrder[0]).toBeLessThan(
      getPublishOrder(publish, "round-answer-stream"),
    )
    expect(mocks.attachRoundReviewGeneration.mock.invocationCallOrder[0]).toBeLessThan(
      getPublishOrder(publish, "round-review-stream"),
    )
    expect(mocks.saveRoundReviewCompletion.mock.invocationCallOrder[0]).toBeLessThan(
      getPublishOrder(publish, "round-review"),
    )
    expect(mocks.promoteRoundAnswer.mock.invocationCallOrder[0]).toBeLessThan(
      getPublishOrder(publish, "final-answer-stream"),
    )
    expect(
      mocks.attachResearchAnalysisGeneration.mock.invocationCallOrder[0],
    ).toBeLessThan(mocks.promoteRoundAnswer.mock.invocationCallOrder[0] ?? 0)
    expect(mocks.completePageSummaryGeneration).toHaveBeenCalledWith(
      transaction,
      {
        jobId: "deep-search-job-id",
        pageId: "page:https://example.com/result",
        generationId: "summary-stream-id",
      },
    )
    expect(mocks.completeQuerySummaryGeneration).toHaveBeenCalledWith(
      transaction,
      {
        jobId: "deep-search-job-id",
        queryId: "query:test query",
        generationId: "query-summary-stream-id",
      },
    )
    expect(mocks.analyzeResearchAnswer).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "test-user-id",
        deepSearchJobId: "deep-search-job-id",
        researchRequest: "Research this",
        finalAnswer: "Completed answer",
        searchSummaries: [
          {
            round: 0,
            query: "test query",
            content: "Completed query summary",
          },
        ],
      }),
    )
    expect(mocks.promoteRoundAnswer).toHaveBeenCalledWith({
      jobId: "deep-search-job-id",
      roundId: "round-0",
      generationId: "round-answer-stream-0",
      researchAnalysisGenerationId: "research-analysis-generation-id",
    })
  })

  it.each(["extraction", "summary"] as const)(
    "persists and publishes a typed %s failure before using the snippet fallback",
    async (stage) => {
      const publish = createPublisher()
      mocks.startPageSummary.mockResolvedValueOnce({
        status: "failed",
        stage,
        message: `${stage} failed`,
      })

      await deepSearch({
        userId: "test-user-id",
        deepSearchJobId: "deep-search-job-id",
        researchRequest: "Research this",
        publish,
      })

      expect(mocks.savePageFailure).toHaveBeenCalledWith({
        jobId: "deep-search-job-id",
        pageId: "page:https://example.com/result",
        stage,
        message: `${stage} failed`,
      })
      expect(mocks.savePageFailure.mock.invocationCallOrder[0]).toBeLessThan(
        getPublishOrder(publish, "page-summary-error"),
      )
      expect(mocks.summarizeSearchQuery).toHaveBeenCalledWith(
        expect.objectContaining({
          results: [
            {
              title: "Result",
              url: "https://example.com/result",
              content: "Useful result",
            },
          ],
        }),
      )
    },
  )

  it("generates an explicit final answer when no queries are returned", async () => {
    mocks.generateWebSearchQueries.mockImplementationOnce((input) =>
      registeredQueryGeneration(input, []),
    )
    const publish = vi.fn()

    await deepSearch({
      userId: "test-user-id",
      deepSearchJobId: "deep-search-job-id",
      researchRequest: "Research this",
      publish,
    })

    expect(mocks.savePlannedQueries).toHaveBeenCalledWith(
      transaction,
      {
        jobId: "deep-search-job-id",
        roundId: "round-0",
        queries: [],
      },
    )
    expect(mocks.settleWebSearchQuery).not.toHaveBeenCalled()
    expect(mocks.webSearch).not.toHaveBeenCalled()
    expect(mocks.selectWebSearchResults).not.toHaveBeenCalled()
    expect(mocks.startPageSummary).not.toHaveBeenCalled()
    expect(mocks.summarizeSearchQuery).not.toHaveBeenCalled()
    expect(publish).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "search-results" }),
    )
    expect(mocks.answerResearchRequest).toHaveBeenCalledWith(expect.objectContaining({
      userId: "test-user-id",
      deepSearchJobId: "deep-search-job-id",
      researchRequest: "Research this",
      searchSummaries: [],
    }))
  })

  it("completes an empty provider result without selection or summary model calls", async () => {
    executionSnapshot.maxRounds = 1
    mocks.webSearch.mockResolvedValueOnce([])
    const publish = createPublisher()

    await deepSearch({
      userId: "test-user-id",
      deepSearchJobId: "deep-search-job-id",
      researchRequest: "Research this",
      maxRounds: 1,
      publish,
    })

    expect(mocks.completeEmptySearchQuery).toHaveBeenCalledWith({
      jobId: "deep-search-job-id",
      queryId: "query:test query",
    })
    expect(mocks.selectWebSearchResults).not.toHaveBeenCalled()
    expect(mocks.saveSelectedResults).not.toHaveBeenCalled()
    expect(mocks.startPageSummary).not.toHaveBeenCalled()
    expect(mocks.summarizeSearchQuery).not.toHaveBeenCalled()
    expect(publish).toHaveBeenCalledWith({
      type: "selected-search-results",
      round: 0,
      query: "test query",
      selectedLinks: [],
    })
    expect(mocks.answerResearchRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        searchSummaries: [
          {
            round: 0,
            query: "test query",
            content: "The web search returned no usable results for this query.",
          },
        ],
      }),
    )
  })

  it("passes configured limits to each pipeline stage", async () => {
    executionSnapshot.maxSearches = 5
    executionSnapshot.maxResultsPerSearch = 2
    await deepSearch({
      userId: "test-user-id",
      deepSearchJobId: "deep-search-job-id",
      researchRequest: "Research this",
      maxSearches: 5,
      maxResultsPerSearch: 2,
      publish: ignoreEvent,
    })

    expect(mocks.generateWebSearchQueries).toHaveBeenCalledWith(
      expect.objectContaining({ maxSearches: 5 }),
    )
    expect(mocks.selectWebSearchResults).toHaveBeenCalledWith(
      expect.objectContaining({ maxResultsToExplore: 2 }),
    )
  })

  it("passes the retry policy to every model-backed stage", async () => {
    await deepSearch({
      userId: "test-user-id",
      deepSearchJobId: "deep-search-job-id",
      researchRequest: "Research this",
      publish: ignoreEvent,
    })

    for (const input of [
      mocks.generateWebSearchQueries.mock.calls[0]?.[0],
      mocks.selectWebSearchResults.mock.calls[0]?.[0],
      mocks.startPageSummary.mock.calls[0]?.[0],
      mocks.summarizeSearchQuery.mock.calls[0]?.[0],
      mocks.startRoundReview.mock.calls[0]?.[0],
      mocks.answerResearchRequest.mock.calls[0]?.[0],
      mocks.analyzeResearchAnswer.mock.calls[0]?.[0],
    ]) {
      expect(input).not.toHaveProperty("maxRetries")
    }
  })

  it("passes stable result IDs forward and ignores unknown model selections", async () => {
    const secondResult = {
      title: "Second result",
      shortText: "Second snippet",
      link: "https://example.com/second",
    }
    const publish = createPublisher()
    mocks.webSearch.mockResolvedValueOnce([...results, secondResult])
    mocks.selectWebSearchResults.mockImplementationOnce((input) =>
      registeredSelectionGeneration(input, [
        "unknown",
        input.results[1]?.id ?? "",
        input.results[0]?.id ?? "",
      ]),
    )

    await deepSearch({
      userId: "test-user-id",
      deepSearchJobId: "deep-search-job-id",
      researchRequest: "Research this",
      publish,
    })

    const selectionInput = mocks.selectWebSearchResults.mock.calls[0]?.[0] as
      | { results: Array<{ id: string; url: string }> }
      | undefined
    expect(selectionInput?.results).toEqual([
      {
        id: "result:test query:https://example.com/result",
        title: "Result",
        url: "https://example.com/result",
        snippet: "Useful result",
      },
      {
        id: "result:test query:https://example.com/second",
        title: "Second result",
        url: "https://example.com/second",
        snippet: "Second snippet",
      },
    ])
    expect(mocks.saveSelectedResults).toHaveBeenCalledWith(
      transaction,
      {
        jobId: "deep-search-job-id",
        queryId: "query:test query",
        selectionGenerationId: "selection-stream-id",
        selectedResultIds: [
          "result:test query:https://example.com/second",
          "result:test query:https://example.com/result",
        ],
      },
    )
    expect(publish).toHaveBeenCalledWith({
      type: "selected-search-results",
      round: 0,
      query: "test query",
      selectedLinks: [
        "https://example.com/second",
        "https://example.com/result",
      ],
    })
  })

  it("starts a page summary only once for duplicate selected URLs", async () => {
    mocks.generateWebSearchQueries.mockImplementationOnce((input) =>
      registeredQueryGeneration(input, ["first query", "second query"]),
    )

    await deepSearch({
      userId: "test-user-id",
      deepSearchJobId: "deep-search-job-id",
      researchRequest: "Research this",
      publish: ignoreEvent,
    })

    expect(mocks.webSearch).toHaveBeenCalledTimes(2)
    expect(mocks.startPageSummary).toHaveBeenCalledTimes(1)
    expect(mocks.summarizeSearchQuery).toHaveBeenCalledTimes(2)
    expect(mocks.answerResearchRequest).toHaveBeenCalledWith(expect.objectContaining({
      userId: "test-user-id",
      deepSearchJobId: "deep-search-job-id",
      researchRequest: "Research this",
      searchSummaries: [
        { round: 0, query: "first query", content: "Completed query summary" },
        { round: 0, query: "second query", content: "Completed query summary" },
      ],
    }))
  })

  it("runs another bounded round when the review requests more research", async () => {
    mocks.generateWebSearchQueries
      .mockImplementationOnce((input) =>
        registeredQueryGeneration(input, ["first query"], "query-stream-0"),
      )
      .mockImplementationOnce((input) =>
        registeredQueryGeneration(input, ["second query"], "query-stream-1"),
      )
    executionSnapshot.maxRounds = 2
    mocks.startRoundReview.mockResolvedValueOnce({
      streamId: "round-review-stream-id",
      review: Promise.resolve({
        decision: "continue",
        reason: "A material evidence gap remains.",
      }),
      completion: completedOutcome("continued"),
    })

    await deepSearch({
      userId: "test-user-id",
      deepSearchJobId: "deep-search-job-id",
      researchRequest: "Research this",
      maxRounds: 2,
      publish: ignoreEvent,
    })

    expect(mocks.generateWebSearchQueries).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        round: 1,
        previousQueries: ["first query"],
        previousSearchSummaries: [
          {
            round: 0,
            query: "first query",
            content: "Completed query summary",
          },
        ],
        previousCandidateAnswer: "Completed answer",
        previousReviewReason: "A material evidence gap remains.",
      }),
    )
    expect(mocks.startRoundReview).toHaveBeenCalledTimes(1)
    expect(mocks.startRoundReview).toHaveBeenCalledWith(
      expect.objectContaining({
        candidateAnswer: "Completed answer",
        searchSummaries: [
          { round: 0, query: "first query", content: "Completed query summary" },
        ],
      }),
    )
    expect(mocks.startPageSummary).toHaveBeenCalledTimes(1)
    expect(mocks.answerResearchRequest).toHaveBeenCalledTimes(2)
    expect(mocks.answerResearchRequest).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        userId: "test-user-id",
        deepSearchJobId: "deep-search-job-id",
        researchRequest: "Research this",
        searchSummaries: [
          { round: 0, query: "first query", content: "Completed query summary" },
          { round: 1, query: "second query", content: "Completed query summary" },
        ],
      }),
    )
  })

  it("persists review failure and falls back to the current evidence", async () => {
    const publish = createPublisher()
    mocks.startRoundReview.mockResolvedValueOnce({
      streamId: "round-review-stream-id",
      review: Promise.reject(new Error("Review unavailable")),
      completion: Promise.resolve({
        status: "failed",
        text: "",
        reasoning: "",
        error: "Review unavailable",
        failureKind: "stream",
      }),
    })

    await deepSearch({
      userId: "test-user-id",
      deepSearchJobId: "deep-search-job-id",
      researchRequest: "Research this",
      publish,
    })

    expect(mocks.saveRoundReviewFailure).toHaveBeenCalledWith({
      jobId: "deep-search-job-id",
      roundId: "round-0",
      generationId: "round-review-stream-id",
      message: "Review unavailable",
    })
    expect(mocks.saveRoundReviewFailure.mock.invocationCallOrder[0]).toBeLessThan(
      getPublishOrder(publish, "round-review-error"),
    )
    expect(mocks.generateWebSearchQueries).toHaveBeenCalledTimes(1)
    expect(mocks.answerResearchRequest).toHaveBeenCalledTimes(1)
    expect(mocks.promoteRoundAnswer).toHaveBeenCalledWith({
      jobId: "deep-search-job-id",
      roundId: "round-0",
      generationId: "round-answer-stream-0",
      researchAnalysisGenerationId: "research-analysis-generation-id",
    })
  })

  it("waits for page summary text before starting the query summary", async () => {
    const completion = Promise.withResolvers<string | undefined>()
    mocks.startPageSummary.mockResolvedValueOnce({
      status: "started",
      streamId: "summary-stream-id",
      summary: completion.promise,
      completion: completedOutcome("Completed page summary"),
    })
    let completed = false

    const run = deepSearch({
      userId: "test-user-id",
      deepSearchJobId: "deep-search-job-id",
      researchRequest: "Research this",
      publish: ignoreEvent,
    }).then(() => {
      completed = true
    })
    await Promise.resolve()

    expect(completed).toBe(false)
    expect(mocks.summarizeSearchQuery).not.toHaveBeenCalled()
    completion.resolve("Completed page summary")
    await run
    expect(completed).toBe(true)
    expect(mocks.summarizeSearchQuery).toHaveBeenCalled()
  })

  it("bounds process-wide selected-page work", async () => {
    const pageCount = config.deepSearch.maxConcurrentPageTasks + 1
    const selectedResults = Array.from({ length: pageCount }, (_, position) => ({
      title: `Result ${position}`,
      shortText: `Snippet ${position}`,
      link: `https://example.com/result-${position}`,
    }))
    executionSnapshot.maxResultsPerSearch = pageCount
    mocks.webSearch.mockResolvedValueOnce(selectedResults)
    mocks.selectWebSearchResults.mockImplementationOnce((input) =>
      registeredSelectionGeneration(
        input,
        input.results.map(({ id }) => id),
      ),
    )
    const pageStarts = Array.from({ length: pageCount }, () =>
      Promise.withResolvers<ReturnType<typeof pageSummaryStart>>(),
    )
    let nextPage = 0
    mocks.startPageSummary.mockImplementation(() => {
      const start = pageStarts[nextPage]
      nextPage += 1
      if (!start) throw new Error("Missing test page start")
      return start.promise
    })

    const run = deepSearch({
      userId: "test-user-id",
      deepSearchJobId: "deep-search-job-id",
      researchRequest: "Research this",
      maxResultsPerSearch: pageCount,
      publish: ignoreEvent,
    })
    await vi.waitFor(() => {
      expect(mocks.startPageSummary).toHaveBeenCalledTimes(
        config.deepSearch.maxConcurrentPageTasks,
      )
    })

    pageStarts[0]?.resolve(pageSummaryStart("First summary", "summary-0"))
    await vi.waitFor(() => {
      expect(mocks.startPageSummary).toHaveBeenCalledTimes(pageCount)
    })
    for (const [position, start] of pageStarts.slice(1).entries()) {
      start.resolve(
        pageSummaryStart(`Summary ${position + 1}`, `summary-${position + 1}`),
      )
    }

    await expect(run).resolves.toBe("Completed answer")
  })

  it("settles every started page task before exposing a fatal failure", async () => {
    const secondResult = {
      title: "Second result",
      shortText: "Second snippet",
      link: "https://example.com/second",
    }
    mocks.webSearch.mockResolvedValueOnce([...results, secondResult])
    mocks.selectWebSearchResults.mockImplementationOnce((input) =>
      registeredSelectionGeneration(
        input,
        input.results.map(({ id }) => id),
      ),
    )
    const secondSummary = Promise.withResolvers<string>()
    let pipelineTerminal = false
    let persistedAfterTerminal = false
    mocks.startPageSummary
      .mockRejectedValueOnce(new Error("Page registration failed"))
      .mockImplementationOnce((input: TextGenerationPersistenceCallbacks) => {
        const streamId = "summary-stream-1"
        input.onRegistered?.(streamId, transaction)
        const summary = secondSummary.promise.then((text) => {
          persistedAfterTerminal = pipelineTerminal
          input.onCompleted?.(
            { id: streamId, text, reasoning: "" },
            transaction,
          )
          return text
        })
        return Promise.resolve({
          status: "started" as const,
          streamId,
          summary,
          completion: completedOutcome("Second page summary"),
        })
      })

    const run = deepSearch({
      userId: "test-user-id",
      deepSearchJobId: "deep-search-job-id",
      researchRequest: "Research this",
      publish: ignoreEvent,
    }).catch((error: unknown) => {
      pipelineTerminal = true
      throw error
    })
    await vi.waitFor(() => {
      expect(mocks.startPageSummary).toHaveBeenCalledTimes(2)
    })

    expect(pipelineTerminal).toBe(false)
    secondSummary.resolve("Second page summary")
    await expect(run).rejects.toThrow("Page registration failed")

    expect(persistedAfterTerminal).toBe(false)
    expect(mocks.completePageSummaryGeneration).toHaveBeenCalledWith(
      transaction,
      {
        jobId: "deep-search-job-id",
        pageId: "page:https://example.com/second",
        generationId: "summary-stream-1",
      },
    )
    expect(mocks.summarizeSearchQuery).not.toHaveBeenCalled()
    expect(mocks.answerResearchRequest).not.toHaveBeenCalled()
  })

  it("uses page summaries when available and snippets as fallback", async () => {
    const mixedResults = [
      {
        title: "Explored result",
        shortText: "Explored result description",
        link: "https://example.com/explored",
      },
      {
        title: "Failed result",
        shortText: "Failed result description",
        link: "https://example.com/failed",
      },
      {
        title: "Unselected result",
        shortText: "Unselected result description",
        link: "https://example.com/unselected",
      },
    ]
    mocks.webSearch.mockResolvedValueOnce(mixedResults)
    mocks.selectWebSearchResults.mockImplementationOnce((input) =>
      registeredSelectionGeneration(
        input,
        input.results.slice(0, 2).map(({ id }) => id),
      ),
    )
    mocks.startPageSummary.mockImplementation(({ url }: { url: string }) =>
      Promise.resolve(
        pageSummaryStart(
          url === "https://example.com/explored"
            ? "Full explored-page summary"
            : undefined,
        ),
      ),
    )

    await deepSearch({
      userId: "test-user-id",
      deepSearchJobId: "deep-search-job-id",
      researchRequest: "Research this",
      publish: ignoreEvent,
    })

    expect(mocks.summarizeSearchQuery).toHaveBeenCalledWith(expect.objectContaining({
      userId: "test-user-id",
      deepSearchJobId: "deep-search-job-id",
      researchRequest: "Research this",
      query: "test query",
      results: [
        {
          title: "Explored result",
          url: "https://example.com/explored",
          content: "Full explored-page summary",
        },
        {
          title: "Failed result",
          url: "https://example.com/failed",
          content: "Failed result description",
        },
        {
          title: "Unselected result",
          url: "https://example.com/unselected",
          content: "Unselected result description",
        },
      ],
    }))
  })

  it("waits for every query summary before starting the final answer", async () => {
    const completion = Promise.withResolvers<string>()
    mocks.summarizeSearchQuery.mockResolvedValueOnce({
      streamId: "query-summary-stream-id",
      summary: completion.promise,
      completion: completedOutcome("Top-level findings"),
    })

    const run = deepSearch({
      userId: "test-user-id",
      deepSearchJobId: "deep-search-job-id",
      researchRequest: "Research this",
      publish: ignoreEvent,
    })
    await Promise.resolve()
    await Promise.resolve()

    expect(mocks.answerResearchRequest).not.toHaveBeenCalled()
    completion.resolve("Top-level findings")
    await run

    expect(mocks.answerResearchRequest).toHaveBeenCalledWith(expect.objectContaining({
      userId: "test-user-id",
      deepSearchJobId: "deep-search-job-id",
      researchRequest: "Research this",
      searchSummaries: [
        { round: 0, query: "test query", content: "Top-level findings" },
      ],
    }))
  })

  it("waits for the durable final answer before completing", async () => {
    const answer = Promise.withResolvers<string>()
    mocks.answerResearchRequest.mockResolvedValueOnce({
      streamId: "final-answer-stream-id",
      answer: answer.promise,
      completion: completedOutcome("Completed answer"),
    })
    let completed = false

    const run = deepSearch({
      userId: "test-user-id",
      deepSearchJobId: "deep-search-job-id",
      researchRequest: "Research this",
      publish: ignoreEvent,
    }).then(() => {
      completed = true
    })

    await vi.waitFor(() => {
      expect(mocks.answerResearchRequest).toHaveBeenCalledOnce()
    })
    expect(completed).toBe(false)

    answer.resolve("Completed answer")
    await run
    expect(completed).toBe(true)
  })

  it("waits for the structured research analysis before promotion", async () => {
    const analysis = Promise.withResolvers<typeof researchAnalysis>()
    mocks.analyzeResearchAnswer.mockResolvedValueOnce({
      generationId: "research-analysis-generation-id",
      analysis: analysis.promise,
      completion: completedOutcome(JSON.stringify(researchAnalysis)),
    })

    const run = deepSearch({
      userId: "test-user-id",
      deepSearchJobId: "deep-search-job-id",
      researchRequest: "Research this",
      publish: ignoreEvent,
    })
    await vi.waitFor(() => {
      expect(mocks.analyzeResearchAnswer).toHaveBeenCalledOnce()
    })
    expect(mocks.promoteRoundAnswer).not.toHaveBeenCalled()

    analysis.resolve(researchAnalysis)
    await expect(run).resolves.toBe("Completed answer")
    expect(mocks.promoteRoundAnswer).toHaveBeenCalledOnce()
  })

  it("does not promote the answer when structured analysis fails", async () => {
    mocks.analyzeResearchAnswer.mockResolvedValueOnce({
      generationId: "research-analysis-generation-id",
      analysis: Promise.reject(new Error("Research analysis failed")),
      completion: Promise.resolve({
        status: "failed",
        text: "",
        reasoning: "",
        error: "Research analysis failed",
        failureKind: "stream",
      }),
    })

    await expect(
      deepSearch({
        userId: "test-user-id",
        deepSearchJobId: "deep-search-job-id",
        researchRequest: "Research this",
        publish: ignoreEvent,
      }),
    ).rejects.toThrow("Research analysis failed")

    expect(mocks.promoteRoundAnswer).not.toHaveBeenCalled()
  })

  it("does not start dependent work when query generation fails", async () => {
    mocks.generateWebSearchQueries.mockRejectedValueOnce(
      new Error("Query generation failed"),
    )

    await expect(
      deepSearch({
        userId: "test-user-id",
        deepSearchJobId: "deep-search-job-id",
        researchRequest: "Research this",
        publish: ignoreEvent,
      }),
    ).rejects.toThrow("Query generation failed")

    expect(mocks.webSearch).not.toHaveBeenCalled()
    expect(mocks.selectWebSearchResults).not.toHaveBeenCalled()
    expect(mocks.answerResearchRequest).not.toHaveBeenCalled()
  })

  it("does not start selection when web search fails", async () => {
    mocks.webSearch.mockRejectedValueOnce(new Error("Web search failed"))

    await expect(
      deepSearch({
        userId: "test-user-id",
        deepSearchJobId: "deep-search-job-id",
        researchRequest: "Research this",
        publish: ignoreEvent,
      }),
    ).rejects.toThrow("Web search failed")

    expect(mocks.selectWebSearchResults).not.toHaveBeenCalled()
    expect(mocks.startPageSummary).not.toHaveBeenCalled()
    expect(mocks.answerResearchRequest).not.toHaveBeenCalled()
  })

  it("settles every web search and reports failures in query order", async () => {
    mocks.generateWebSearchQueries.mockImplementationOnce((input) =>
      registeredQueryGeneration(input, ["first query", "second query"]),
    )
    const firstSearch = Promise.withResolvers<typeof results>()
    const secondSearch = Promise.withResolvers<typeof results>()
    mocks.webSearch.mockImplementation(({ query }: { query: string }) =>
      query === "first query" ? firstSearch.promise : secondSearch.promise,
    )
    let pipelineTerminal = false

    const run = deepSearch({
      userId: "test-user-id",
      deepSearchJobId: "deep-search-job-id",
      researchRequest: "Research this",
      publish: ignoreEvent,
    }).catch((error: unknown) => {
      pipelineTerminal = true
      throw error
    })
    await vi.waitFor(() => {
      expect(mocks.webSearch).toHaveBeenCalledTimes(2)
    })

    secondSearch.reject(new Error("Second search failed first"))
    await Promise.resolve()
    expect(pipelineTerminal).toBe(false)

    firstSearch.reject(new Error("First query failure"))
    await expect(run).rejects.toThrow("First query failure")

    expect(pipelineTerminal).toBe(true)
    expect(mocks.settleWebSearchQuery).not.toHaveBeenCalled()
    expect(mocks.selectWebSearchResults).not.toHaveBeenCalled()
  })

  it("finishes every source selection before starting page work", async () => {
    mocks.generateWebSearchQueries.mockImplementationOnce((input) =>
      registeredQueryGeneration(input, ["first query", "second query"]),
    )
    mocks.selectWebSearchResults
      .mockImplementationOnce((input) =>
        registeredSelectionGeneration(
          input,
          input.results.map(({ id }) => id),
        ),
      )
      .mockRejectedValueOnce(new Error("Source selection failed"))

    await expect(
      deepSearch({
        userId: "test-user-id",
        deepSearchJobId: "deep-search-job-id",
        researchRequest: "Research this",
        publish: ignoreEvent,
      }),
    ).rejects.toThrow("Source selection failed")

    expect(mocks.selectWebSearchResults).toHaveBeenCalledTimes(2)
    expect(mocks.startPageSummary).not.toHaveBeenCalled()
    expect(mocks.summarizeSearchQuery).not.toHaveBeenCalled()
    expect(mocks.answerResearchRequest).not.toHaveBeenCalled()
  })

  it("settles every query summary before exposing a fatal failure", async () => {
    mocks.generateWebSearchQueries.mockImplementationOnce((input) =>
      registeredQueryGeneration(input, ["first query", "second query"]),
    )
    const secondSummary = Promise.withResolvers<string>()
    let pipelineTerminal = false
    let persistedAfterTerminal = false
    mocks.summarizeSearchQuery
      .mockResolvedValueOnce({
        streamId: "query-summary-stream-0",
        summary: Promise.reject(new Error("First query summary failed")),
        completion: Promise.resolve({
          status: "failed",
          text: "",
          reasoning: "",
          error: "First query summary failed",
        }),
      })
      .mockImplementationOnce((input: TextGenerationPersistenceCallbacks) => {
        const streamId = "query-summary-stream-1"
        input.onRegistered?.(streamId, transaction)
        const summary = secondSummary.promise.then((text) => {
          persistedAfterTerminal = pipelineTerminal
          input.onCompleted?.(
            { id: streamId, text, reasoning: "" },
            transaction,
          )
          return text
        })
        return Promise.resolve({
          streamId,
          summary,
          completion: completedOutcome("Second query summary"),
        })
      })

    const run = deepSearch({
      userId: "test-user-id",
      deepSearchJobId: "deep-search-job-id",
      researchRequest: "Research this",
      publish: ignoreEvent,
    }).catch((error: unknown) => {
      pipelineTerminal = true
      throw error
    })
    await vi.waitFor(() => {
      expect(mocks.summarizeSearchQuery).toHaveBeenCalledTimes(2)
    })

    expect(pipelineTerminal).toBe(false)
    secondSummary.resolve("Second query summary")
    await expect(run).rejects.toThrow("First query summary failed")

    expect(persistedAfterTerminal).toBe(false)
    expect(mocks.completeQuerySummaryGeneration).toHaveBeenCalledWith(
      transaction,
      {
        jobId: "deep-search-job-id",
        queryId: "query:second query",
        generationId: "query-summary-stream-1",
      },
    )
    expect(mocks.answerResearchRequest).not.toHaveBeenCalled()
  })

  it("fails when final-answer generation fails", async () => {
    mocks.answerResearchRequest.mockResolvedValueOnce({
      streamId: "final-answer-stream-id",
      answer: Promise.reject(new Error("Final answer failed")),
      completion: Promise.resolve({
        status: "failed",
        text: "",
        reasoning: "",
        error: "Final answer failed",
        failureKind: "stream",
      }),
    })

    await expect(
      deepSearch({
        userId: "test-user-id",
        deepSearchJobId: "deep-search-job-id",
        researchRequest: "Research this",
        publish: ignoreEvent,
      }),
    ).rejects.toThrow("Final answer failed")
  })

  it("resumes mixed query fan-out without repeating settled provider or selection work", async () => {
    executionSnapshot.maxRounds = 1
    executionSnapshot.rounds.push({
      roundId: "round-0",
      position: 0,
      planningGeneration: persistedGeneration(
        "persisted-planning",
        "completed",
        JSON.stringify(["settled query", "pending query"]),
      ),
      answerGeneration: null,
      reviewGeneration: null,
      reviewDecision: null,
      reviewReason: null,
      reviewError: null,
      reviewCompletedAt: null,
      queries: [
        {
          queryId: "settled-query-id",
          position: 0,
          query: "settled query",
          creditsUsed: 0,
          status: "selecting",
          selectionGeneration: persistedGeneration(
            "settled-selection",
            "completed",
            JSON.stringify(["settled-result-id"]),
          ),
          summaryGeneration: null,
          errorStage: null,
          errorMessage: null,
          completedAt: null,
          results: [
            {
              resultId: "settled-result-id",
              position: 0,
              title: "Settled result",
              shortText: "Settled snippet",
              url: "https://example.com/settled",
              selectedWebPageId: null,
            },
          ],
        },
        {
          queryId: "pending-query-id",
          position: 1,
          query: "pending query",
          creditsUsed: null,
          status: "searching",
          selectionGeneration: null,
          summaryGeneration: null,
          errorStage: null,
          errorMessage: null,
          completedAt: null,
          results: [],
        },
      ],
    })
    mocks.webSearch.mockResolvedValueOnce(results)

    await deepSearch({
      userId: "test-user-id",
      deepSearchJobId: "deep-search-job-id",
      researchRequest: "Research this",
      publish: ignoreEvent,
    })

    expect(mocks.generateWebSearchQueries).not.toHaveBeenCalled()
    expect(mocks.webSearch).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ query: "pending query" }),
    )
    expect(mocks.settleWebSearchQuery).toHaveBeenCalledOnce()
    expect(mocks.selectWebSearchResults).toHaveBeenCalledOnce()
    expect(mocks.saveSelectedResults).toHaveBeenCalledWith(
      expect.objectContaining({
        queryId: "settled-query-id",
        selectionGenerationId: "settled-selection",
      }),
    )
  })

  it.each([
    { strictQuality: false, expectedRetries: 0 },
    { strictQuality: true, expectedRetries: 1 },
  ])(
    "retries a persisted failed page summary only when strictQuality=$strictQuality",
    async ({ strictQuality, expectedRetries }) => {
      executionSnapshot.maxRounds = 1
      executionSnapshot.strictQuality = strictQuality
      executionSnapshot.rounds.push({
        roundId: "round-0",
        position: 0,
        planningGeneration: persistedGeneration(
          "persisted-planning",
          "completed",
          JSON.stringify(["persisted query"]),
        ),
        answerGeneration: null,
        reviewGeneration: null,
        reviewDecision: null,
        reviewReason: null,
        reviewError: null,
        reviewCompletedAt: null,
        queries: [
          {
            queryId: "persisted-query-id",
            position: 0,
            query: "persisted query",
            creditsUsed: 0,
            status: "summarizing",
            selectionGeneration: persistedGeneration(
              "persisted-selection",
              "completed",
              JSON.stringify(["persisted-result-id"]),
            ),
            summaryGeneration: null,
            errorStage: null,
            errorMessage: null,
            completedAt: null,
            results: [
              {
                resultId: "persisted-result-id",
                position: 0,
                title: "Persisted result",
                shortText: "Snippet fallback",
                url: "https://example.com/persisted",
                selectedWebPageId: "persisted-page-id",
              },
            ],
          },
        ],
      })
      executionSnapshot.pages.push({
        pageId: "persisted-page-id",
        url: "https://example.com/persisted",
        creditsUsed: 1,
        status: "failed",
        extractedContent: "Durably extracted content",
        summaryGeneration: persistedGeneration(
          "failed-page-summary",
          "failed",
        ),
        errorStage: "summary",
        errorMessage: "Previous summary failed",
        completedAt: new Date(),
      })

      await deepSearch({
        userId: "test-user-id",
        deepSearchJobId: "deep-search-job-id",
        researchRequest: "Research this",
        publish: ignoreEvent,
      })

      expect(mocks.startPageSummary).not.toHaveBeenCalled()
      expect(mocks.summarizePage).toHaveBeenCalledTimes(expectedRetries)
      expect(mocks.replacePageSummaryGeneration).toHaveBeenCalledTimes(
        expectedRetries,
      )
      expect(mocks.summarizeSearchQuery).toHaveBeenCalledWith(
        expect.objectContaining({
          results: [
            expect.objectContaining({
              content: strictQuality
                ? "Retried page summary"
                : "Snippet fallback",
            }),
          ],
        }),
      )
    },
  )
})
