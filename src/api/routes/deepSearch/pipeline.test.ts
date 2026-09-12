import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  attachFinalAnswerGeneration: vi.fn<typeof import("./store.ts").attachFinalAnswerGeneration>(),
  replaceFinalAnswerGeneration: vi.fn<typeof import("./store.ts").replaceFinalAnswerGeneration>(),
  completeReviewedAnswer: vi.fn<typeof import("./jobLifecycle.ts").completeReviewedAnswer>(),
  attachPageLinkSelectionGeneration: vi.fn<typeof import("./store.ts").attachPageLinkSelectionGeneration>(),
  replacePageLinkSelectionGeneration: vi.fn<typeof import("./store.ts").replacePageLinkSelectionGeneration>(),
  completePageLinkSelection: vi.fn<typeof import("./store.ts").completePageLinkSelection>(),
  selectPageLinks: vi.fn<typeof import("../../agents/deep_search/selection.ts").selectPageLinks>(),
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

vi.mock(import("../../agents/deep_search/researchAnalysis.ts"), async (importOriginal) => ({
  ...await importOriginal(),
  analyzeResearchAnswer: mocks.analyzeResearchAnswer,
}))

vi.mock(import("../../agents/deep_search/queries.ts"), async (importOriginal) => ({
  ...await importOriginal(),
  generateWebSearchQueries: mocks.generateWebSearchQueries,
}))

vi.mock("../../agents/deep_search/selection.ts", () => ({
  selectWebSearchResults: mocks.selectWebSearchResults,
  selectPageLinks: mocks.selectPageLinks,
}))

vi.mock("../../agents/deep_search/summaries.ts", () => ({
  startPageSummary: mocks.startPageSummary,
  summarizePage: mocks.summarizePage,
}))

vi.mock("../../agents/deep_search/querySummaries.ts", () => ({
  summarizeSearchQuery: mocks.summarizeSearchQuery,
}))

vi.mock(import("../../agents/deep_search/reviewRound.ts"), async (importOriginal) => ({
  ...await importOriginal(),
  startRoundReview: mocks.startRoundReview,
}))

vi.mock("../../web_search/index.ts", () => ({
  webSearch: mocks.webSearch,
}))

vi.mock("./store.ts", () => ({
  attachFinalAnswerGeneration: mocks.attachFinalAnswerGeneration,
  replaceFinalAnswerGeneration: mocks.replaceFinalAnswerGeneration,
  attachPageLinkSelectionGeneration: mocks.attachPageLinkSelectionGeneration,
  replacePageLinkSelectionGeneration: mocks.replacePageLinkSelectionGeneration,
  completePageLinkSelection: mocks.completePageLinkSelection,
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
  completeReviewedAnswer: mocks.completeReviewedAnswer,
}))

import type {
  DeepSearchEvent,
} from "../../agents/deep_search/schemas.ts"
import { parseRoundReview, type RoundReview } from "../../agents/deep_search/reviewRound.ts"
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

function pendingPage(url: string): DeepSearchExecutionSnapshot["pages"][number] {
  return {
    pageId: `page:${url}`, url, creditsUsed: null, status: "extracting",
    extractedContent: null, originalPassages: null, summaryGeneration: null, linkSelectionGeneration: null,
    links: [], errorStage: null, errorMessage: null, completedAt: null,
  }
}

function useLinkedDocuments(documents: Record<string, {
  content: string
  summary?: string
  links: Array<{ url: string; title: string }>
}>) {
  mocks.startPageSummary.mockImplementation((input) => {
    const document = documents[input.url]
    if (!document) return Promise.reject(new Error(`Unexpected page ${input.url}`))
    const streamId = `summary:${input.url}`
    input.onExtractionSettled?.({ content: document.content, links: document.links, creditsUsed: 1 })
    input.onRegistered?.(streamId, transaction)
    const completion = completedOutcome(document.summary ?? document.content)
    return Promise.resolve({
      status: "started", streamId, completion,
      summary: completion.then(({ text, reasoning }) => {
        const page = executionSnapshot.pages.find(({ url }) => url === input.url)
        if (!page) throw new Error("Missing document page")
        page.summaryGeneration = persistedGeneration(streamId, "completed", text)
        input.onCompleted?.({ id: streamId, text, reasoning }, transaction)
        return text
      }),
    })
  })
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
    mocks.attachFinalAnswerGeneration.mockImplementation((_transaction, { generationId }) => {
      executionSnapshot.finalAnswerGeneration = persistedGeneration(generationId)
    })
    mocks.replaceFinalAnswerGeneration.mockImplementation((_transaction, { newGenerationId }) => {
      executionSnapshot.finalAnswerGeneration = persistedGeneration(newGenerationId)
    })
    mocks.attachPageLinkSelectionGeneration.mockImplementation((_transaction, { pageId, generationId }) => {
      const page = executionSnapshot.pages.find((page) => page.pageId === pageId)
      if (!page) throw new Error("Missing link source")
      page.linkSelectionGeneration = persistedGeneration(generationId)
    })
    mocks.completePageLinkSelection.mockImplementation((_transaction, input) => {
      const source = executionSnapshot.pages.find(({ pageId }) => pageId === input.sourcePageId)
      if (!source) throw new Error("Missing link source")
      return input.selectedLinkIds.map((id) => {
        const link = source.links.find(({ linkId }) => linkId === id)
        if (!link) throw new Error("Unknown selected link")
        let page = executionSnapshot.pages.find(({ url }) => url === link.url)
        if (!page) {
          page = pendingPage(link.url)
          executionSnapshot.pages.push(page)
        }
        link.selectedWebPageId = page.pageId
        link.selectedRoundId = input.roundId
        return { pageId: page.pageId, url: page.url }
      })
    })
    mocks.selectPageLinks.mockImplementation((input) => {
      const streamId = `link-selection:${input.sourceUrl}`
      const selectedIds = input.links.slice(0, input.maxResultsToExplore).map(({ id }) => id)
      input.onRegistered?.(streamId, transaction)
      return Promise.resolve({
        streamId,
        completion: completedOutcome(JSON.stringify({ selectedIds })),
        selectedIds: Promise.resolve().then(() => {
          const source = executionSnapshot.pages.find(({ url }) => url === input.sourceUrl)
          if (!source) throw new Error("Missing link source")
          source.linkSelectionGeneration = persistedGeneration(streamId, "completed", JSON.stringify({ selectedIds }))
          input.onCompleted?.({ id: streamId, output: selectedIds }, transaction)
          return selectedIds
        }),
      })
    })
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
      ({ pageId, content, creditsUsed, links }) => {
        const page = executionSnapshot.pages.find(
          (candidate) => candidate.pageId === pageId,
        )
        if (!page) throw new Error("Missing page")
        page.status = "summarizing"
        page.extractedContent = content
        page.originalPassages = content
        page.creditsUsed = creditsUsed
        page.links = (links ?? []).map((link, position) => ({
          ...link,
          position,
          linkId: `link:${pageId}:${link.url}`,
          selectedWebPageId: null,
          selectedRoundId: null,
        }))
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
              originalPassages: null,
              summaryGeneration: null,
              linkSelectionGeneration: null,
              links: [],
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
          links: Array<{ url: string; title: string }>
        }) => void
      }) => {
        const streamId = "summary-stream-id"
        input.onExtractionSettled?.({
          content: "Extracted page content",
          creditsUsed: 0,
          links: [],
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
      (input) => {
        const round = mocks.answerResearchRequest.mock.calls.filter(([input]) => input.candidateAnswer === undefined).length - 1
        const streamId = input.candidateAnswer === undefined ? `round-answer-stream-${round}` : "corrected-answer-stream"
        input.onRegistered?.(streamId, transaction)
        const completion = completedOutcome("Completed answer")
        return Promise.resolve({
          streamId,
          answer: completion.then(({ text, reasoning }) => {
            if (input.candidateAnswer !== undefined) {
              executionSnapshot.finalAnswerGeneration = persistedGeneration(streamId, "completed", text)
            }
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
        streamId: "corrected-answer-stream",
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
    expect(mocks.attachFinalAnswerGeneration.mock.invocationCallOrder[0]).toBeLessThan(
      getPublishOrder(publish, "final-answer-stream"),
    )
    expect(
      mocks.attachResearchAnalysisGeneration.mock.invocationCallOrder[0],
    ).toBeLessThan(mocks.completeReviewedAnswer.mock.invocationCallOrder[0] ?? 0)
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
    expect(mocks.completeReviewedAnswer).toHaveBeenCalledWith(expect.anything(), {
      jobId: "deep-search-job-id",
      generationId: "corrected-answer-stream",
      researchAnalysisGenerationId: "research-analysis-generation-id",
    })
  })

  it("carries two-hop evidence absent from search results through answer, review, and analysis despite a summary losing its URL", async () => {
    const root = results[0].link
    const terms = "https://example.com/terms"
    const details = "https://example.com/eligibility"
    useLinkedDocuments({
      [root]: { content: "The advertised offer requires checking linked terms.", links: [{ url: terms, title: "Offer terms" }] },
      [terms]: { content: "Eligibility is defined by the detailed policy.", links: [{ url: root, title: "Back to offer" }, { url: details, title: "Eligibility policy" }] },
      [details]: { content: "The offer costs £14 and excludes existing customers.", links: [{ url: terms, title: "Terms" }, { url: "https://example.com/deeper", title: "Further details" }] },
    })
    const publish = createPublisher()
    await deepSearch({ userId: "test-user-id", deepSearchJobId: "deep-search-job-id", researchRequest: "Research this", publish })

    expect(mocks.webSearch).toHaveBeenCalledOnce()
    expect(mocks.startPageSummary.mock.calls.map(([input]) => input.url)).toEqual([root, terms, details])
    expect(mocks.selectPageLinks.mock.calls.map(([input]) => input.links.map(({ url }) => url))).toEqual([[terms], [details]])
    expect(mocks.selectPageLinks.mock.calls[1]?.[0].knownPages).toContainEqual({
      url: root, status: "completed", title: results[0].title,
      summary: "The advertised offer requires checking linked terms.",
    })
    const decisiveEvidence = {
      url: details, title: "Eligibility policy", evidenceType: "page-summary",
      content: "The offer costs £14 and excludes existing customers.",
      originalPassages: "The offer costs £14 and excludes existing customers.",
    }
    for (const stage of [mocks.answerResearchRequest, mocks.startRoundReview, mocks.analyzeResearchAnswer]) {
      const input = stage.mock.calls[0]?.[0]
      expect(input?.searchSummaries).toEqual([{ round: 0, query: "test query", content: "Completed query summary" }])
      expect(input?.sourceEvidence).toContainEqual(decisiveEvidence)
    }
    expect(mocks.completePageLinkSelection.mock.invocationCallOrder[1]).toBeLessThan(mocks.answerResearchRequest.mock.invocationCallOrder[0] ?? 0)
    expect(publish.mock.calls.map(([event]) => event)).toContainEqual({ type: "selected-linked-pages", sourceUrl: terms, links: [{ url: details, title: "Eligibility policy" }] })
  })

  it("corrects the final allowed round from original passages omitted by both summaries", async () => {
    executionSnapshot.maxRounds = 1
    const qualification = "Existing customers are excluded from the £14 offer."
    useLinkedDocuments({
      [results[0].link]: { content: qualification, summary: "The provider describes its offer.", links: [] },
    })
    const generateAnswer = mocks.answerResearchRequest.getMockImplementation()!
    mocks.answerResearchRequest.mockImplementation(async (input) => {
      const generation = await generateAnswer(input)
      const text = input.candidateAnswer === undefined ? "Everyone qualifies for the offer." : qualification
      return { ...generation, completion: completedOutcome(text), answer: generation.answer.then(() => {
        const persisted = input.candidateAnswer === undefined ? executionSnapshot.rounds[0]?.answerGeneration : executionSnapshot.finalAnswerGeneration
        if (persisted) persisted.text = text
        return text
      }) }
    })
    const publish = createPublisher()
    await expect(deepSearch({ userId: "test-user-id", deepSearchJobId: "deep-search-job-id", researchRequest: "Who qualifies?", maxRounds: 1, publish })).resolves.toBe(qualification)

    expect(mocks.startRoundReview).not.toHaveBeenCalled()
    expect(mocks.answerResearchRequest).toHaveBeenCalledTimes(2)
    expect(mocks.answerResearchRequest.mock.calls[1]?.[0]).toMatchObject({
      candidateAnswer: "Everyone qualifies for the offer.",
      searchSummaries: [{ content: "Completed query summary" }],
      sourceEvidence: [{ url: results[0].link, content: "The provider describes its offer.", originalPassages: qualification, evidenceType: "page-summary" }],
    })
    expect(mocks.analyzeResearchAnswer.mock.calls[0]?.[0].finalAnswer).toBe(qualification)
    expect(executionSnapshot.finalAnswerGeneration?.text).toBe(qualification)
    expect(publish.mock.calls.map(([event]) => event)).toContainEqual({ type: "final-answer-stream", streamId: "corrected-answer-stream" })
    expect(mocks.completeReviewedAnswer).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ generationId: "corrected-answer-stream" }))
  })

  it("reserves linked-page capacity for deeper hops when shallow sources have many links", async () => {
    executionSnapshot.maxSearches = 2
    executionSnapshot.maxResultsPerSearch = 2
    const roots = Array.from({ length: 4 }, (_, index) => `https://example.com/root-${index}`)
    mocks.generateWebSearchQueries.mockImplementationOnce((input) => registeredQueryGeneration(input, ["first query", "second query"]))
    mocks.webSearch.mockImplementation(({ query }: { query: string }) => Promise.resolve(roots.slice(query === "first query" ? 0 : 2, query === "first query" ? 2 : 4).map((link) => ({ ...results[0], link }))))
    mocks.selectWebSearchResults.mockImplementation((input) => registeredSelectionGeneration(input, input.results.map(({ id }) => id), `selection:${input.searchQuery}`))
    const documents: Parameters<typeof useLinkedDocuments>[0] = {}
    for (const [rootIndex, root] of roots.entries()) {
      const links = Array.from({ length: 5 }, (_, index) => ({ url: `https://example.com/shallow-${rootIndex}-${index}`, title: `Shallow ${rootIndex}-${index}` }))
      documents[root] = { content: "Several linked source documents.", links }
      for (const link of links) {
        const deeper = `${link.url}/policy`
        documents[link.url] = { content: "Read the detailed policy.", links: [{ url: deeper, title: "Detailed policy" }] }
        documents[deeper] = { content: "The authoritative eligibility condition.", links: [] }
      }
    }
    useLinkedDocuments(documents)
    await deepSearch({ userId: "test-user-id", deepSearchJobId: "deep-search-job-id", researchRequest: "Research this", maxSearches: 2, maxResultsPerSearch: 2, maxRounds: 1, publish: ignoreEvent })

    const extracted = mocks.startPageSummary.mock.calls.map(([input]) => input.url)
    expect(extracted.filter((url) => roots.includes(url))).toHaveLength(4)
    expect(extracted.filter((url) => url.includes("shallow") && !url.endsWith("/policy"))).toHaveLength(8)
    expect(extracted.filter((url) => url.endsWith("/policy"))).toHaveLength(4)
    expect(mocks.selectPageLinks.mock.calls.every(([input]) => input.maxResultsToExplore! <= 2)).toBe(true)
    expect(mocks.selectPageLinks.mock.calls[1]?.[0].knownPages).toContainEqual({
      url: "https://example.com/shallow-0-0", status: "extracting",
    })
  })

  it("rebuilds known summaries and failed statuses from durable pages when linked exploration resumes", async () => {
    const unread = "https://example.com/unread-policy"
    const terms = "https://example.com/terms"
    const details = "https://example.com/new-policy?version=2"
    useLinkedDocuments({
      [results[0].link]: { content: "The overview identifies two policies.", links: [{ url: unread, title: "Unread policy" }, { url: terms, title: "Current policy" }] },
      [terms]: { content: "The current policy requires a new-version comparison.", links: [{ url: details, title: "Updated policy" }] },
      [details]: { content: "The updated policy changes eligibility.", links: [] },
    })
    const summarize = mocks.startPageSummary.getMockImplementation()!
    mocks.startPageSummary.mockImplementation((input) => input.url === unread
      ? Promise.resolve({ status: "failed", stage: "extraction", message: "Source unavailable" })
      : summarize(input))
    const select = mocks.selectPageLinks.getMockImplementation()!
    let interrupted = false
    mocks.selectPageLinks.mockImplementation((input) => {
      if (input.sourceUrl === terms && !interrupted) {
        interrupted = true
        return Promise.reject(new Error("Interrupted before deeper selection"))
      }
      return select(input)
    })
    const input = { userId: "test-user-id", deepSearchJobId: "deep-search-job-id", researchRequest: "Compare policies", publish: ignoreEvent }

    await expect(deepSearch(input)).rejects.toThrow("Interrupted before deeper selection")
    executionSnapshot = structuredClone(executionSnapshot)
    await expect(deepSearch(input)).resolves.toBe("Completed answer")

    const resumed = mocks.selectPageLinks.mock.calls.at(-1)?.[0]
    expect(resumed?.knownPages).toContainEqual({
      url: results[0].link, title: results[0].title, status: "completed",
      summary: "The overview identifies two policies.",
    })
    expect(resumed?.knownPages).toContainEqual({ url: unread, title: "Unread policy", status: "failed" })
    expect(resumed?.links.map(({ url }) => url)).toEqual([details])
    expect(mocks.webSearch).toHaveBeenCalledOnce()
    expect(mocks.startPageSummary.mock.calls.map(([input]) => input.url)).toEqual([
      results[0].link, unread, terms, details,
    ])
  })

  it("skips linked extraction when the selector finds no added evidence", async () => {
    const alias = "https://www.example.com/result"
    useLinkedDocuments({
      [results[0].link]: { content: "The policy is already established.", links: [{ url: alias, title: "Same policy" }] },
    })
    const select = mocks.selectPageLinks.getMockImplementation()!
    mocks.selectPageLinks.mockImplementation((input) => select({ ...input, maxResultsToExplore: 0 }))
    const publish = createPublisher()

    await deepSearch({ userId: "test-user-id", deepSearchJobId: "deep-search-job-id", researchRequest: "Check policy", publish })

    expect(mocks.selectPageLinks.mock.calls[0]?.[0].links.map(({ url }) => url)).toEqual([alias])
    expect(mocks.startPageSummary.mock.calls.map(([input]) => input.url)).toEqual([results[0].link])
    expect(executionSnapshot.pages.map(({ url }) => url)).toEqual([results[0].link])
    expect(publish).toHaveBeenCalledWith({ type: "selected-linked-pages", sourceUrl: results[0].link, links: [] })
  })

  it("resumes a failed correction without repeating the completed candidate or search", async () => {
    executionSnapshot.maxRounds = 1
    const generateAnswer = mocks.answerResearchRequest.getMockImplementation()!
    let failCorrection = true
    mocks.answerResearchRequest.mockImplementation((input) => {
      if (input.candidateAnswer !== undefined && failCorrection) {
        failCorrection = false
        input.onRegistered?.("failed-correction", transaction)
        executionSnapshot.finalAnswerGeneration = persistedGeneration("failed-correction", "failed")
        return Promise.resolve({ streamId: "failed-correction", answer: Promise.reject(new Error("Correction interrupted")), completion: Promise.resolve({ status: "failed", text: "", reasoning: "", error: "Correction interrupted", failureKind: "stream" }) })
      }
      return generateAnswer(input)
    })
    const input = { userId: "test-user-id", deepSearchJobId: "deep-search-job-id", researchRequest: "Research this", publish: ignoreEvent }
    await expect(deepSearch(input)).rejects.toThrow("Correction interrupted")
    expect(mocks.analyzeResearchAnswer).not.toHaveBeenCalled()
    expect(mocks.completeReviewedAnswer).not.toHaveBeenCalled()
    await expect(deepSearch(input)).resolves.toBe("Completed answer")
    expect(mocks.webSearch).toHaveBeenCalledOnce()
    expect(mocks.answerResearchRequest.mock.calls.filter(([input]) => input.candidateAnswer === undefined)).toHaveLength(1)
    expect(mocks.replaceFinalAnswerGeneration).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ oldGenerationId: "failed-correction", newGenerationId: "corrected-answer-stream" }))
    expect(mocks.completeReviewedAnswer).toHaveBeenCalledOnce()
  })

  it("reuses the completed correction after an interrupted analysis", async () => {
    mocks.analyzeResearchAnswer.mockRejectedValueOnce(new Error("Analysis interrupted"))
    const input = { userId: "test-user-id", deepSearchJobId: "deep-search-job-id", researchRequest: "Research this", maxRounds: 1, publish: ignoreEvent }
    await expect(deepSearch(input)).rejects.toThrow("Analysis interrupted")
    expect(mocks.completeReviewedAnswer).not.toHaveBeenCalled()
    expect(executionSnapshot.finalAnswerGeneration?.status).toBe("completed")
    await expect(deepSearch(input)).resolves.toBe("Completed answer")
    expect(mocks.answerResearchRequest).toHaveBeenCalledTimes(2)
    expect(mocks.webSearch).toHaveBeenCalledOnce()
    expect(mocks.analyzeResearchAnswer).toHaveBeenCalledTimes(2)
    expect(mocks.completeReviewedAnswer).toHaveBeenCalledOnce()
  })

  it("stops link discovery at its per-round target budget and labels an unreadable linked page as unavailable", async () => {
    executionSnapshot.maxSearches = 1
    executionSnapshot.maxResultsPerSearch = 1
    const linkedUrl = "https://example.com/terms"
    useLinkedDocuments({
      [results[0].link]: { content: "See linked terms.", links: [{ url: linkedUrl, title: "An attractive unverified claim" }, { url: "https://example.com/another", title: "Other details" }] },
    })
    const summarize = mocks.startPageSummary.getMockImplementation()!
    mocks.startPageSummary.mockImplementation((input) => input.url === linkedUrl
      ? Promise.resolve({ status: "failed", stage: "extraction", message: "Linked source unavailable" })
      : summarize(input))

    await deepSearch({ userId: "test-user-id", deepSearchJobId: "deep-search-job-id", researchRequest: "Research this", maxSearches: 1, maxResultsPerSearch: 1, publish: ignoreEvent })

    expect(mocks.selectPageLinks).toHaveBeenCalledOnce()
    expect(mocks.selectPageLinks.mock.calls[0]?.[0].maxResultsToExplore).toBe(1)
    expect(mocks.startPageSummary.mock.calls.map(([input]) => input.url)).toEqual([results[0].link, linkedUrl])
    const evidence = mocks.answerResearchRequest.mock.calls[0]?.[0].sourceEvidence?.find(({ url }) => url === linkedUrl)
    expect(evidence).toMatchObject({ url: linkedUrl, evidenceType: "unavailable" })
    expect(evidence?.content).not.toContain("An attractive unverified claim")
    expect(evidence?.content).toContain("could not be read or summarized")
  })

  it("resumes after a linked-page interruption without repeating settled searches, selection, or parent extraction", async () => {
    const linkedUrl = "https://example.com/terms"
    useLinkedDocuments({
      [results[0].link]: { content: "See the terms.", links: [{ url: linkedUrl, title: "Terms" }] },
      [linkedUrl]: { content: "The decisive qualification is established.", links: [] },
    })
    const summarize = mocks.startPageSummary.getMockImplementation()!
    let interrupted = false
    mocks.startPageSummary.mockImplementation((input) => {
      if (input.url === linkedUrl && !interrupted) {
        interrupted = true
        return Promise.reject(new Error("Interrupted after durable link selection"))
      }
      return summarize(input)
    })
    const input = { userId: "test-user-id", deepSearchJobId: "deep-search-job-id", researchRequest: "Research this", publish: ignoreEvent }
    await expect(deepSearch(input)).rejects.toThrow("Interrupted after durable link selection")
    expect(mocks.answerResearchRequest).not.toHaveBeenCalled()
    await expect(deepSearch(input)).resolves.toBe("Completed answer")

    expect(mocks.webSearch).toHaveBeenCalledOnce()
    expect(mocks.selectWebSearchResults).toHaveBeenCalledOnce()
    expect(mocks.selectPageLinks).toHaveBeenCalledOnce()
    expect(mocks.startPageSummary.mock.calls.map(([input]) => input.url)).toEqual([results[0].link, linkedUrl, linkedUrl])
    expect(mocks.answerResearchRequest.mock.calls[0]?.[0].sourceEvidence).toContainEqual({
      url: linkedUrl, title: "Terms", evidenceType: "page-summary", content: "The decisive qualification is established.", originalPassages: "The decisive qualification is established.",
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
              evidenceType: "search-snippet",
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

  it("resumes actionable gap continuation before round two without repeating review or exceeding the cap", async () => {
    const rawReview = {
      version: 1,
      reason: "The answer appears sufficient, but eligibility is not verified.",
      requirements: [{ requirement: "Verify eligibility", kind: "requirement", status: "unresolved", sources: [], explanation: "The actual eligibility terms have not been found." }],
      gaps: [{ title: "Eligibility condition", description: "Existing-customer eligibility could change the recommended option.", evidenceToFind: "Find the provider's published eligibility terms for existing customers." }],
    }
    const effectiveReview = parseRoundReview(rawReview)
    const rawText = JSON.stringify(rawReview)
    executionSnapshot.maxRounds = 2
    mocks.generateWebSearchQueries
      .mockImplementationOnce((input) => registeredQueryGeneration(input, ["initial overview"], "query-stream-0"))
      .mockRejectedValueOnce(new Error("Interrupted before the next plan registered"))
      .mockImplementationOnce((input) => registeredQueryGeneration(input, ["provider existing customer eligibility terms"], "query-stream-1"))
    mocks.startRoundReview.mockImplementationOnce((input) => {
      const streamId = "material-gap-review"
      input.onRegistered?.(streamId, transaction)
      const round = executionSnapshot.rounds[0]
      round.reviewGeneration = persistedGeneration(streamId, "completed", rawText)
      input.onCompleted?.({ id: streamId, output: effectiveReview }, transaction)
      return Promise.resolve({ streamId, review: Promise.resolve(effectiveReview), completion: completedOutcome(rawText) })
    })
    const publish = createPublisher()
    const input = { userId: "test-user-id", deepSearchJobId: "deep-search-job-id", researchRequest: "Research this", publish }

    await expect(deepSearch(input)).rejects.toThrow("Interrupted before the next plan registered")
    expect(executionSnapshot.rounds[0]).toMatchObject({ reviewDecision: "continue", reviewGeneration: { text: rawText } })
    expect(publish).toHaveBeenCalledWith({ type: "round-review", round: 0, decision: "continue", reason: effectiveReview.reason })
    expect(mocks.answerResearchRequest).toHaveBeenCalledTimes(1)
    executionSnapshot = structuredClone(executionSnapshot)

    await expect(deepSearch(input)).resolves.toBe("Completed answer")

    expect(mocks.generateWebSearchQueries).toHaveBeenCalledTimes(3)
    expect(mocks.generateWebSearchQueries.mock.calls.at(-1)?.[0]).toMatchObject({
      round: 1, previousQueries: ["initial overview"], previousCandidateAnswer: "Completed answer", requirements: rawReview.requirements,
    })
    expect(mocks.generateWebSearchQueries.mock.calls.at(-1)?.[0].previousReviewReason).toContain(rawReview.gaps[0].description)
    expect(mocks.generateWebSearchQueries.mock.calls.at(-1)?.[0].previousReviewReason).toContain(rawReview.gaps[0].evidenceToFind)
    expect(mocks.startRoundReview).toHaveBeenCalledOnce()
    expect(mocks.webSearch.mock.calls.map(([query]) => (query as { query: string }).query)).toEqual(["initial overview", "provider existing customer eligibility terms"])
    expect(executionSnapshot.rounds.map(({ position }) => position)).toEqual([0, 1])
    expect(executionSnapshot.rounds[0].reviewGeneration?.text).toBe(rawText)
    expect(mocks.answerResearchRequest).toHaveBeenCalledTimes(3)
    expect(mocks.analyzeResearchAnswer).toHaveBeenCalledOnce()
    expect(mocks.completeReviewedAnswer).toHaveBeenCalledOnce()
  })

  it("preserves a completed legacy stop checkpoint even when its wording mentions an unresolved gap", async () => {
    executionSnapshot.maxRounds = 1
    const input = { userId: "test-user-id", deepSearchJobId: "deep-search-job-id", researchRequest: "Research this", publish: ignoreEvent }
    await deepSearch(input)
    const legacy = { decision: "stop", reason: "An unresolved qualification remains; report the limitation." }
    const round = executionSnapshot.rounds[0]
    round.reviewDecision = "stop"
    round.reviewReason = legacy.reason
    round.reviewCompletedAt = new Date()
    round.reviewGeneration = persistedGeneration("legacy-stopped-review", "completed", JSON.stringify(legacy))
    executionSnapshot.maxRounds = 3
    mocks.generateWebSearchQueries.mockClear()
    mocks.startRoundReview.mockClear()
    mocks.webSearch.mockClear()

    await expect(deepSearch(input)).resolves.toBe("Completed answer")

    expect(mocks.generateWebSearchQueries).not.toHaveBeenCalled()
    expect(mocks.startRoundReview).not.toHaveBeenCalled()
    expect(mocks.webSearch).not.toHaveBeenCalled()
    expect(executionSnapshot.rounds).toHaveLength(1)
    expect(round.reviewGeneration.text).toBe(JSON.stringify(legacy))
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
    expect(mocks.answerResearchRequest).toHaveBeenCalledTimes(3)
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

  it.each([true, false])("restores each round's own requirement coverage on Resume (later coverage present=%s)", async (hasLaterRequirements) => {
    executionSnapshot.maxRounds = 2
    mocks.generateWebSearchQueries
      .mockImplementationOnce((input) => registeredQueryGeneration(input, ["first query"], "query-stream-0"))
      .mockImplementationOnce((input) => registeredQueryGeneration(input, ["second query"], "query-stream-1"))
    mocks.startRoundReview.mockResolvedValueOnce({ streamId: "review-0", review: Promise.resolve({ decision: "continue", reason: "Eligibility unresolved." }), completion: completedOutcome("continued") })
    const input = { userId: "test-user-id", deepSearchJobId: "deep-search-job-id", researchRequest: "Research this", publish: ignoreEvent }
    await deepSearch(input)
    const unresolved = [{ requirement: "Establish eligibility", kind: "requirement", status: "unresolved", sources: [], explanation: "No eligibility policy inspected yet." }]
    const supported = hasLaterRequirements ? [{ ...unresolved[0], status: "supported", sources: [results[0].link], explanation: "The eligibility policy supports the finding." }] : []
    for (const round of executionSnapshot.rounds) {
      round.planningGeneration.text = JSON.stringify({ version: 1, queries: round.queries.map(({ query }) => query), requirements: round.position === 0 ? unresolved : supported })
    }
    const earlierRound = executionSnapshot.rounds[0]
    earlierRound.reviewDecision = "continue"
    earlierRound.reviewReason = "Eligibility unresolved."
    earlierRound.reviewGeneration = persistedGeneration("review-0", "completed", JSON.stringify({ decision: "continue", reason: "Eligibility unresolved.", requirements: unresolved }))
    const publish = createPublisher()
    await deepSearch({ ...input, publish })
    const coverage = publish.mock.calls.map(([event]) => event).filter((event) => event.type === "research-requirements")
    expect(coverage.filter(({ round }) => round === 0).every(({ requirements }) => JSON.stringify(requirements) === JSON.stringify(unresolved))).toBe(true)
    expect(coverage).toContainEqual({ type: "research-requirements", round: 0, requirements: unresolved })
    expect(coverage).toContainEqual({ type: "research-requirements", round: 1, requirements: supported })
    expect(mocks.generateWebSearchQueries).toHaveBeenCalledTimes(2)
    expect(mocks.webSearch).toHaveBeenCalledTimes(2)
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
    expect(mocks.answerResearchRequest).toHaveBeenCalledTimes(2)
    expect(mocks.completeReviewedAnswer).toHaveBeenCalledWith(expect.anything(), {
      jobId: "deep-search-job-id",
      generationId: "corrected-answer-stream",
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
          evidenceType: "page-summary",
        },
        {
          title: "Failed result",
          url: "https://example.com/failed",
          content: "Failed result description",
          evidenceType: "search-snippet",
        },
        {
          title: "Unselected result",
          url: "https://example.com/unselected",
          content: "Unselected result description",
          evidenceType: "search-snippet",
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
    expect(mocks.completeReviewedAnswer).not.toHaveBeenCalled()

    analysis.resolve(researchAnalysis)
    await expect(run).resolves.toBe("Completed answer")
    expect(mocks.completeReviewedAnswer).toHaveBeenCalledOnce()
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

    expect(mocks.completeReviewedAnswer).not.toHaveBeenCalled()
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

  it.each([
    { format: "actual wrapped generateArrayStream output", planningText: '{"elements":["settled legacy query"]}', duplicateOnlyLaterRound: false },
    { format: "bare array output", planningText: '["settled legacy query"]', duplicateOnlyLaterRound: false },
    { format: "wrapped legacy output with a duplicate-only empty second round", planningText: '{"elements":["settled legacy query"]}', duplicateOnlyLaterRound: true },
  ])("resumes $format with settled work and no invented requirements", async ({ planningText, duplicateOnlyLaterRound }) => {
    executionSnapshot.maxRounds = 1
    const url = "https://example.com/legacy-evidence"
    executionSnapshot.pages.push({
      ...pendingPage(url), pageId: "legacy-page", status: "completed", creditsUsed: 1,
      summaryGeneration: persistedGeneration("legacy-page-summary", "completed", "Retained original page summary."),
      completedAt: new Date(),
    })
    executionSnapshot.rounds.push({
      roundId: "round-0", position: 0,
      planningGeneration: persistedGeneration("legacy-plan", "completed", planningText),
      answerGeneration: null, reviewGeneration: null, reviewDecision: null,
      reviewReason: null, reviewError: null, reviewCompletedAt: null,
      queries: [{
        queryId: "legacy-query", position: 0, query: "settled legacy query", creditsUsed: 1,
        status: "completed", completedAt: new Date(), errorStage: null, errorMessage: null,
        selectionGeneration: persistedGeneration("legacy-selection", "completed", '{"elements":["legacy-result"]}'),
        summaryGeneration: persistedGeneration("legacy-query-summary", "completed", "Retained query evidence."),
        results: [{ resultId: "legacy-result", position: 0, title: "Legacy evidence", shortText: "Original provider snippet", url, selectedWebPageId: "legacy-page" }],
      }],
    })
    if (duplicateOnlyLaterRound) {
      executionSnapshot.maxRounds = 2
      const firstRound = executionSnapshot.rounds[0]
      firstRound.answerGeneration = persistedGeneration("legacy-first-answer", "completed", "The available evidence has a gap.")
      firstRound.reviewGeneration = persistedGeneration("legacy-review", "completed", '{"decision":"continue","reason":"Check the remaining gap."}')
      firstRound.reviewDecision = "continue"
      firstRound.reviewReason = "Check the remaining gap."
      firstRound.reviewCompletedAt = new Date()
      executionSnapshot.rounds.push({
        ...firstRound, roundId: "round-1", position: 1,
        // The old planner kept raw duplicate output but atomically saved no
        // new query rows after filtering queries already executed in round 0.
        planningGeneration: persistedGeneration("legacy-duplicate-plan", "completed", '{"elements":["settled legacy query"]}'),
        queries: [],
        answerGeneration: persistedGeneration("legacy-second-answer", "completed", "The gap remains unresolved."),
        reviewGeneration: null, reviewDecision: null, reviewReason: null, reviewCompletedAt: null,
      })
    }
    const completedQueries = structuredClone(executionSnapshot.rounds.map(({ queries }) => queries))
    const completedPages = structuredClone(executionSnapshot.pages)
    const publish = createPublisher()
    await expect(deepSearch({ userId: "test-user-id", deepSearchJobId: "deep-search-job-id", researchRequest: "Research this", publish })).resolves.toBe("Completed answer")

    expect(mocks.generateWebSearchQueries).not.toHaveBeenCalled()
    expect(mocks.savePlannedQueries).not.toHaveBeenCalled()
    expect(mocks.webSearch).not.toHaveBeenCalled()
    expect(mocks.selectWebSearchResults).not.toHaveBeenCalled()
    expect(mocks.startPageSummary).not.toHaveBeenCalled()
    expect(mocks.summarizeSearchQuery).not.toHaveBeenCalled()
    expect(mocks.answerResearchRequest.mock.calls[0]?.[0]).toMatchObject({
      requirements: [],
      searchSummaries: [{ round: 0, query: "settled legacy query", content: "Retained query evidence." }],
      sourceEvidence: [{ url, title: "Legacy evidence", evidenceType: "page-summary", content: "Retained original page summary." }],
    })
    expect(publish.mock.calls.map(([event]) => event).filter((event) => event.type === "research-requirements")).toEqual([])
    expect(executionSnapshot.rounds[0]?.planningGeneration.text).toBe(planningText)
    expect(executionSnapshot.rounds.map(({ queries }) => queries)).toEqual(completedQueries)
    expect(executionSnapshot.pages).toEqual(completedPages)
    expect(mocks.answerResearchRequest).toHaveBeenCalledTimes(duplicateOnlyLaterRound ? 1 : 2)
    expect(mocks.answerResearchRequest.mock.calls.at(-1)?.[0].candidateAnswer).toBe(duplicateOnlyLaterRound ? "The gap remains unresolved." : "Completed answer")
    expect(executionSnapshot.rounds[1]?.planningGeneration.text).toBe(duplicateOnlyLaterRound ? '{"elements":["settled legacy query"]}' : undefined)
    expect(executionSnapshot.rounds[1]?.queries).toEqual(duplicateOnlyLaterRound ? [] : undefined)
  })

  it("still recovers missing query rows from a completed version-1 plan", async () => {
    executionSnapshot.maxRounds = 1
    executionSnapshot.rounds.push({
      roundId: "round-0", position: 0,
      planningGeneration: persistedGeneration("versioned-plan", "completed", '{"version":1,"requirements":[],"queries":["recovered query"]}'),
      answerGeneration: null, reviewGeneration: null, reviewDecision: null,
      reviewReason: null, reviewError: null, reviewCompletedAt: null, queries: [],
    })
    await expect(deepSearch({ userId: "test-user-id", deepSearchJobId: "deep-search-job-id", researchRequest: "Research this", publish: ignoreEvent })).resolves.toBe("Completed answer")
    expect(mocks.generateWebSearchQueries).not.toHaveBeenCalled()
    expect(mocks.savePlannedQueries).toHaveBeenCalledExactlyOnceWith({ jobId: "deep-search-job-id", roundId: "round-0", queries: ["recovered query"] })
    expect(mocks.webSearch).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ query: "recovered query" }))
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
        originalPassages: "Durably extracted content",
        linkSelectionGeneration: null,
        links: [],
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
