import { eq } from "drizzle-orm"
import { beforeEach, describe, expect, it } from "vitest"
import { db } from "../../db/index.ts"
import {
  deepSearchJobs,
  deepSearchQueries,
  deepSearchRounds,
  deepSearchResults,
  deepSearchWebPages,
  llmGenerations,
  user,
} from "../../db/schema/index.ts"
import {
  attachFinalAnswerGeneration,
  attachPageSummaryGeneration,
  createSearchRound,
  attachQuerySummaryGeneration,
  attachResearchAnalysisGeneration,
  attachRoundAnswerGeneration,
  attachRoundReviewGeneration,
  attachSelectionGeneration,
  completeEmptySearchQuery,
  completePageSummaryGeneration,
  completeQuerySummaryGeneration,
  failPageSummaryGeneration,
  failQuerySummaryGeneration,
  loadDeepSearchExecutionSnapshot,
  replaceRoundAnswerGeneration,
  replacePageSummaryGeneration,
  replaceQuerySelectionGeneration,
  replaceQuerySummaryGeneration,
  replaceResearchAnalysisGeneration,
  replaceRoundPlanningGeneration,
  replaceRoundReviewGeneration,
  resetPageExtraction,
  resetWebSearchQuery,
  savePageFailure,
  savePlannedQueries,
  saveRoundReviewCompletion,
  saveRoundReviewFailure,
  saveSearchResults,
  saveSelectedResults,
  settlePageExtraction,
} from "./store.ts"

function insertJob(deepSearchJobId: string): void {
  db.insert(deepSearchJobs)
    .values({
      deepSearchJobId,
      userId: "test-user-id",
      slug: `search-${deepSearchJobId}`,
      researchRequest: "Research this",
      maxSearches: 2,
      maxResultsPerSearch: 2,
      strictQuality: false,
    })
    .run()
}

function insertGenerations(
  deepSearchJobId: string,
  llmGenerationIds: string[],
): void {
  db.insert(llmGenerations)
    .values(
      llmGenerationIds.map((llmGenerationId) => ({
        llmGenerationId,
        userId: "test-user-id",
        deepSearchJobId,
      })),
    )
    .run()
}

function createSummarizingStage(deepSearchJobId: string) {
  const queryGenerationId = crypto.randomUUID()
  const selectionGenerationId = crypto.randomUUID()
  const pageSummaryGenerationId = crypto.randomUUID()
  const querySummaryGenerationId = crypto.randomUUID()
  insertJob(deepSearchJobId)
  insertGenerations(deepSearchJobId, [
    queryGenerationId,
    selectionGenerationId,
    pageSummaryGenerationId,
    querySummaryGenerationId,
  ])
  const round = createSearchRound({
    jobId: deepSearchJobId,
    position: 0,
    generationId: queryGenerationId,
  })
  const [plannedQuery] = savePlannedQueries({
    jobId: deepSearchJobId,
    roundId: round.roundId,
    queries: ["stable query"],
  })
  if (!plannedQuery) throw new Error("Planned query was not returned")
  const [query] = saveSearchResults({
    jobId: deepSearchJobId,
    roundId: round.roundId,
    searches: [
      {
        plannedQuery,
        results: [
          {
            title: "Stable result",
            shortText: "Useful evidence",
            link: "https://example.com/stable",
          },
        ],
      },
    ],
  })
  if (!query) throw new Error("Executed query was not returned")
  const [result] = query.results
  if (!result) throw new Error("Search result was not returned")
  attachSelectionGeneration({
    jobId: deepSearchJobId,
    queryId: query.queryId,
    generationId: selectionGenerationId,
  })
  const [page] = saveSelectedResults({
    jobId: deepSearchJobId,
    queryId: query.queryId,
    selectionGenerationId,
    selectedResultIds: [result.resultId],
  })
  if (!page) throw new Error("Selected page was not returned")
  settlePageExtraction({
    userId: "test-user-id",
    jobId: deepSearchJobId,
    pageId: page.pageId,
    content: "Bounded extracted page content",
    creditsUsed: 1,
  })
  db.transaction((transaction) => {
    attachPageSummaryGeneration(transaction, {
      jobId: deepSearchJobId,
      pageId: page.pageId,
      generationId: pageSummaryGenerationId,
    })
    attachQuerySummaryGeneration(transaction, {
      jobId: deepSearchJobId,
      queryId: query.queryId,
      generationId: querySummaryGenerationId,
    })
  })
  return {
    pageId: page.pageId,
    pageSummaryGenerationId,
    queryId: query.queryId,
    querySummaryGenerationId,
  }
}

describe("deep-search store", () => {
  beforeEach(() => {
    db.delete(deepSearchJobs).run()
    db.delete(llmGenerations).run()
  })

  it("writes planned queries through the supplied terminal transaction", () => {
    const deepSearchJobId = crypto.randomUUID()
    const queryGenerationId = crypto.randomUUID()
    insertJob(deepSearchJobId)
    insertGenerations(deepSearchJobId, [queryGenerationId])
    const round = createSearchRound({
      jobId: deepSearchJobId,
      position: 0,
      generationId: queryGenerationId,
    })

    expect(() =>
      db.transaction((transaction) => {
        savePlannedQueries(transaction, {
          jobId: deepSearchJobId,
          roundId: round.roundId,
          queries: ["rolled back query"],
        })
        throw new Error("roll back terminal settlement")
      }),
    ).toThrow("roll back terminal settlement")

    expect(
      db
        .select()
        .from(deepSearchQueries)
        .where(eq(deepSearchQueries.deepSearchRoundId, round.roundId))
        .all(),
    ).toEqual([])
  })

  it("writes selected results through the supplied terminal transaction", () => {
    const deepSearchJobId = crypto.randomUUID()
    const planningGenerationId = crypto.randomUUID()
    const selectionGenerationId = crypto.randomUUID()
    insertJob(deepSearchJobId)
    insertGenerations(deepSearchJobId, [
      planningGenerationId,
      selectionGenerationId,
    ])
    const round = createSearchRound({
      jobId: deepSearchJobId,
      position: 0,
      generationId: planningGenerationId,
    })
    const [plannedQuery] = savePlannedQueries({
      jobId: deepSearchJobId,
      roundId: round.roundId,
      queries: ["stable query"],
    })
    if (!plannedQuery) throw new Error("Planned query was not returned")
    const [executedQuery] = saveSearchResults({
      jobId: deepSearchJobId,
      roundId: round.roundId,
      searches: [
        {
          plannedQuery,
          results: [
            {
              title: "Stable result",
              shortText: "Stable evidence",
              link: "https://example.com/stable",
            },
          ],
        },
      ],
    })
    const resultId = executedQuery?.results[0]?.resultId
    if (!executedQuery || !resultId) throw new Error("Result was not returned")
    attachSelectionGeneration({
      jobId: deepSearchJobId,
      queryId: executedQuery.queryId,
      generationId: selectionGenerationId,
    })

    expect(() =>
      db.transaction((transaction) => {
        saveSelectedResults(transaction, {
          jobId: deepSearchJobId,
          queryId: executedQuery.queryId,
          selectionGenerationId,
          selectedResultIds: [resultId],
        })
        throw new Error("roll back terminal settlement")
      }),
    ).toThrow("roll back terminal settlement")

    expect(
      db
        .select({ status: deepSearchQueries.status })
        .from(deepSearchQueries)
        .where(eq(deepSearchQueries.deepSearchQueryId, executedQuery.queryId))
        .get(),
    ).toEqual({ status: "selecting" })
    expect(
      db
        .select()
        .from(deepSearchWebPages)
        .where(eq(deepSearchWebPages.deepSearchJobId, deepSearchJobId))
        .all(),
    ).toEqual([])
  })

  it("rejects new durable work after the effective root requests Stop", () => {
    const deepSearchJobId = crypto.randomUUID()
    const queryGenerationId = crypto.randomUUID()
    insertJob(deepSearchJobId)
    insertGenerations(deepSearchJobId, [queryGenerationId])
    db.update(deepSearchJobs)
      .set({ cancelRequestedAt: new Date() })
      .where(eq(deepSearchJobs.deepSearchJobId, deepSearchJobId))
      .run()

    expect(() =>
      createSearchRound({
        jobId: deepSearchJobId,
        position: 0,
        generationId: queryGenerationId,
      }),
    ).toThrow("stop-requested")
    expect(
      db
        .select()
        .from(deepSearchRounds)
        .where(eq(deepSearchRounds.deepSearchJobId, deepSearchJobId))
        .all(),
    ).toEqual([])
  })

  it("persists a stage chain using stable returned IDs", () => {
    const deepSearchJobId = crypto.randomUUID()
    const queryGenerationId = crypto.randomUUID()
    const selectionGenerationId = crypto.randomUUID()
    const pageSummaryGenerationId = crypto.randomUUID()
    const querySummaryGenerationId = crypto.randomUUID()
    const finalAnswerGenerationId = crypto.randomUUID()
    insertJob(deepSearchJobId)
    insertGenerations(deepSearchJobId, [
      queryGenerationId,
      selectionGenerationId,
      pageSummaryGenerationId,
      querySummaryGenerationId,
      finalAnswerGenerationId,
    ])

    const round = createSearchRound({
      jobId: deepSearchJobId,
      position: 0,
      generationId: queryGenerationId,
    })
    expect(round.roundId).not.toBe("")
    expect(round).toEqual({
      roundId: round.roundId,
      position: 0,
      generationId: queryGenerationId,
    })
    const [plannedQuery] = savePlannedQueries({
      jobId: deepSearchJobId,
      roundId: round.roundId,
      queries: ["stable query"],
    })
    expect(plannedQuery).toBeDefined()
    if (!plannedQuery) throw new Error("Planned query was not returned")
    expect(plannedQuery.queryId).not.toBe("")
    expect(plannedQuery).toEqual({
      queryId: plannedQuery.queryId,
      position: 0,
      query: "stable query",
    })

    const [executedQuery] = saveSearchResults({
      jobId: deepSearchJobId,
      roundId: round.roundId,
      searches: [
        {
          plannedQuery,
          results: [
            {
              title: "Stable result",
              shortText: "Useful evidence",
              link: "https://example.com/stable",
            },
          ],
        },
      ],
    })
    expect(executedQuery).toBeDefined()
    if (!executedQuery) throw new Error("Executed query was not returned")
    expect(executedQuery.queryId).not.toBe("")
    expect(executedQuery).toMatchObject({
      position: plannedQuery.position,
      query: plannedQuery.query,
      queryId: plannedQuery.queryId,
    })
    const [storedResult] = executedQuery.results
    expect(storedResult).toBeDefined()
    if (!storedResult) throw new Error("Search result was not returned")
    expect(storedResult.resultId).not.toBe("")
    expect(storedResult).toEqual({
      resultId: storedResult.resultId,
      position: 0,
      title: "Stable result",
      shortText: "Useful evidence",
      url: "https://example.com/stable",
    })

    attachSelectionGeneration({
      jobId: deepSearchJobId,
      queryId: executedQuery.queryId,
      generationId: selectionGenerationId,
    })
    const [page] = saveSelectedResults({
      jobId: deepSearchJobId,
      queryId: executedQuery.queryId,
      selectionGenerationId,
      selectedResultIds: [storedResult.resultId],
    })
    expect(page).toBeDefined()
    if (!page) throw new Error("Selected page was not returned")
    expect(page.pageId).not.toBe("")
    expect(page).toEqual({
      pageId: page.pageId,
      url: "https://example.com/stable",
    })

    settlePageExtraction({
      userId: "test-user-id",
      jobId: deepSearchJobId,
      pageId: page.pageId,
      content: "Bounded extracted page content",
      creditsUsed: 1,
    })
    db.transaction((transaction) => {
      attachPageSummaryGeneration(transaction, {
        jobId: deepSearchJobId,
        pageId: page.pageId,
        generationId: pageSummaryGenerationId,
      })
    })
    savePageFailure({
      jobId: deepSearchJobId,
      pageId: page.pageId,
      stage: "summary",
      message: "Summary failed",
    })
    db.transaction((transaction) => {
      attachQuerySummaryGeneration(transaction, {
        jobId: deepSearchJobId,
        queryId: executedQuery.queryId,
        generationId: querySummaryGenerationId,
      })
    })
    db.transaction((transaction) => {
      attachFinalAnswerGeneration(transaction, {
        jobId: deepSearchJobId,
        generationId: finalAnswerGenerationId,
      })
    })

    expect(
      db
        .select()
        .from(deepSearchQueries)
        .where(
          eq(deepSearchQueries.deepSearchQueryId, executedQuery.queryId),
        )
        .get(),
    ).toMatchObject({
      selectionGenerationId,
      summaryGenerationId: querySummaryGenerationId,
      status: "summarizing",
    })
    expect(
      db
        .select()
        .from(deepSearchResults)
        .where(
          eq(deepSearchResults.deepSearchResultId, storedResult.resultId),
        )
        .get(),
    ).toMatchObject({
      selectedWebPageId: page.pageId,
    })
    expect(
      db
        .select()
        .from(deepSearchWebPages)
        .where(eq(deepSearchWebPages.deepSearchWebPageId, page.pageId))
        .get(),
    ).toMatchObject({
      summaryGenerationId: pageSummaryGenerationId,
      status: "failed",
      errorStage: "summary",
      errorMessage: "Summary failed",
    })
    expect(
      db
        .select({
          finalAnswerGenerationId: deepSearchJobs.finalAnswerGenerationId,
        })
        .from(deepSearchJobs)
        .where(eq(deepSearchJobs.deepSearchJobId, deepSearchJobId))
        .get(),
    ).toEqual({ finalAnswerGenerationId })
  })

  it("keeps a settled sibling when another provider search is foreign", () => {
    const deepSearchJobId = crypto.randomUUID()
    const queryGenerationId = crypto.randomUUID()
    insertJob(deepSearchJobId)
    insertGenerations(deepSearchJobId, [queryGenerationId])
    const round = createSearchRound({
      jobId: deepSearchJobId,
      position: 0,
      generationId: queryGenerationId,
    })
    const [plannedQuery] = savePlannedQueries({
      jobId: deepSearchJobId,
      roundId: round.roundId,
      queries: ["valid query"],
    })
    if (!plannedQuery) throw new Error("Planned query was not returned")
    const creditsBefore = db
      .select({ credits: user.credits })
      .from(user)
      .where(eq(user.id, "test-user-id"))
      .get()!.credits

    expect(() =>
      saveSearchResults({
        jobId: deepSearchJobId,
        roundId: round.roundId,
        searches: [
          {
            plannedQuery,
            results: [],
            creditsUsed: 2,
          },
          {
            plannedQuery: {
              queryId: crypto.randomUUID(),
              position: 1,
              query: "foreign query",
            },
            results: [],
          },
        ],
      }),
    ).toThrow("Search query was not persisted for this round")
    expect(db.select().from(deepSearchQueries).all()).toEqual([
      expect.objectContaining({
        deepSearchQueryId: plannedQuery.queryId,
        status: "selecting",
        creditsUsed: 2,
      }),
    ])

    const [retried] = saveSearchResults({
      jobId: deepSearchJobId,
      roundId: round.roundId,
      searches: [{ plannedQuery, results: [], creditsUsed: 2 }],
    })
    expect(retried).toMatchObject({ queryId: plannedQuery.queryId, results: [] })
    expect(
      db
        .select({ credits: user.credits })
        .from(user)
        .where(eq(user.id, "test-user-id"))
        .get()!.credits,
    ).toBe(creditsBefore - 2)
  })

  it("marks page and query summaries completed in their generation transactions", () => {
    const deepSearchJobId = crypto.randomUUID()
    const stage = createSummarizingStage(deepSearchJobId)

    db.transaction((transaction) => {
      transaction
        .update(llmGenerations)
        .set({
          status: "completed",
          text: "Completed summary",
          reasoning: "",
          completedAt: new Date(),
        })
        .where(
          eq(
            llmGenerations.llmGenerationId,
            stage.pageSummaryGenerationId,
          ),
        )
        .run()
      completePageSummaryGeneration(transaction, {
        jobId: deepSearchJobId,
        pageId: stage.pageId,
        generationId: stage.pageSummaryGenerationId,
      })
      transaction
        .update(llmGenerations)
        .set({
          status: "completed",
          text: "Completed summary",
          reasoning: "",
          completedAt: new Date(),
        })
        .where(
          eq(
            llmGenerations.llmGenerationId,
            stage.querySummaryGenerationId,
          ),
        )
        .run()
      completeQuerySummaryGeneration(transaction, {
        jobId: deepSearchJobId,
        queryId: stage.queryId,
        generationId: stage.querySummaryGenerationId,
      })
    })

    const page = db
      .select({
        status: deepSearchWebPages.status,
        completedAt: deepSearchWebPages.completedAt,
      })
      .from(deepSearchWebPages)
      .where(eq(deepSearchWebPages.deepSearchWebPageId, stage.pageId))
      .get()
    expect(page?.status).toBe("completed")
    expect(page?.completedAt).toBeInstanceOf(Date)
    const query = db
      .select({
        status: deepSearchQueries.status,
        completedAt: deepSearchQueries.completedAt,
      })
      .from(deepSearchQueries)
      .where(eq(deepSearchQueries.deepSearchQueryId, stage.queryId))
      .get()
    expect(query?.status).toBe("completed")
    expect(query?.completedAt).toBeInstanceOf(Date)
  })

  it("marks failed page and query summaries with their durable errors", () => {
    const deepSearchJobId = crypto.randomUUID()
    const stage = createSummarizingStage(deepSearchJobId)

    db.transaction((transaction) => {
      failPageSummaryGeneration(transaction, {
        jobId: deepSearchJobId,
        pageId: stage.pageId,
        generationId: stage.pageSummaryGenerationId,
        message: "Page summary failed",
      })
      failQuerySummaryGeneration(transaction, {
        jobId: deepSearchJobId,
        queryId: stage.queryId,
        generationId: stage.querySummaryGenerationId,
        message: "Query summary failed",
      })
    })

    expect(
      db
        .select({
          status: deepSearchWebPages.status,
          errorStage: deepSearchWebPages.errorStage,
          errorMessage: deepSearchWebPages.errorMessage,
        })
        .from(deepSearchWebPages)
        .where(eq(deepSearchWebPages.deepSearchWebPageId, stage.pageId))
        .get(),
    ).toEqual({
      status: "failed",
      errorStage: "summary",
      errorMessage: "Page summary failed",
    })
    expect(
      db
        .select({
          status: deepSearchQueries.status,
          errorStage: deepSearchQueries.errorStage,
          errorMessage: deepSearchQueries.errorMessage,
        })
        .from(deepSearchQueries)
        .where(eq(deepSearchQueries.deepSearchQueryId, stage.queryId))
        .get(),
    ).toEqual({
      status: "failed",
      errorStage: "summary",
      errorMessage: "Query summary failed",
    })
  })

  it("rejects foreign result IDs before changing selection state", () => {
    const deepSearchJobId = crypto.randomUUID()
    const queryGenerationId = crypto.randomUUID()
    const selectionGenerationId = crypto.randomUUID()
    insertJob(deepSearchJobId)
    insertGenerations(deepSearchJobId, [
      queryGenerationId,
      selectionGenerationId,
    ])
    const round = createSearchRound({
      jobId: deepSearchJobId,
      position: 0,
      generationId: queryGenerationId,
    })
    const [plannedQuery] = savePlannedQueries({
      jobId: deepSearchJobId,
      roundId: round.roundId,
      queries: ["valid query"],
    })
    if (!plannedQuery) throw new Error("Planned query was not returned")
    const [query] = saveSearchResults({
      jobId: deepSearchJobId,
      roundId: round.roundId,
      searches: [
        {
          plannedQuery,
          results: [
            {
              title: "Result",
              shortText: "Evidence",
              link: "https://example.com/result",
            },
          ],
        },
      ],
    })
    if (!query) throw new Error("Executed query was not returned")
    attachSelectionGeneration({
      jobId: deepSearchJobId,
      queryId: query.queryId,
      generationId: selectionGenerationId,
    })

    expect(() =>
      saveSelectedResults({
        jobId: deepSearchJobId,
        queryId: query.queryId,
        selectionGenerationId,
        selectedResultIds: [crypto.randomUUID()],
      }),
    ).toThrow("Selected search result was not persisted for this query")
    expect(
      db.select().from(deepSearchResults).all(),
    ).toHaveLength(1)
    expect(db.select().from(deepSearchWebPages).all()).toEqual([])
  })

  it("commits result selection exactly once", () => {
    const deepSearchJobId = crypto.randomUUID()
    const queryGenerationId = crypto.randomUUID()
    const selectionGenerationId = crypto.randomUUID()
    insertJob(deepSearchJobId)
    insertGenerations(deepSearchJobId, [
      queryGenerationId,
      selectionGenerationId,
    ])
    const round = createSearchRound({
      jobId: deepSearchJobId,
      position: 0,
      generationId: queryGenerationId,
    })
    const [plannedQuery] = savePlannedQueries({
      jobId: deepSearchJobId,
      roundId: round.roundId,
      queries: ["stable query"],
    })
    if (!plannedQuery) throw new Error("Planned query was not returned")
    const [query] = saveSearchResults({
      jobId: deepSearchJobId,
      roundId: round.roundId,
      searches: [{
        plannedQuery,
        results: [
          { title: "A", shortText: "A", link: "https://example.com/a" },
          { title: "B", shortText: "B", link: "https://example.com/b" },
        ],
      }],
    })
    if (!query) throw new Error("Executed query was not returned")
    attachSelectionGeneration({
      jobId: deepSearchJobId,
      queryId: query.queryId,
      generationId: selectionGenerationId,
    })

    saveSelectedResults({
      jobId: deepSearchJobId,
      queryId: query.queryId,
      selectionGenerationId,
      selectedResultIds: [query.results[0].resultId],
    })
    expect(() =>
      saveSelectedResults({
        jobId: deepSearchJobId,
        queryId: query.queryId,
        selectionGenerationId,
        selectedResultIds: [query.results[1].resultId],
      }),
    ).toThrow("Search result selection was already committed")

    expect(
      db.select().from(deepSearchResults).all().map((result) => ({
        id: result.deepSearchResultId,
        selected: result.selectedWebPageId !== null,
      })),
    ).toEqual([
      { id: query.results[0].resultId, selected: true },
      { id: query.results[1].resultId, selected: false },
    ])
    expect(db.select().from(deepSearchWebPages).all()).toHaveLength(1)
  })

  it("does not replace an already attached selection generation", () => {
    const deepSearchJobId = crypto.randomUUID()
    const queryGenerationId = crypto.randomUUID()
    const selectionGenerationId = crypto.randomUUID()
    const replacementGenerationId = crypto.randomUUID()
    insertJob(deepSearchJobId)
    insertGenerations(deepSearchJobId, [
      queryGenerationId,
      selectionGenerationId,
      replacementGenerationId,
    ])
    const round = createSearchRound({
      jobId: deepSearchJobId,
      position: 0,
      generationId: queryGenerationId,
    })
    const [query] = savePlannedQueries({
      jobId: deepSearchJobId,
      roundId: round.roundId,
      queries: ["stable query"],
    })
    if (!query) throw new Error("Planned query was not returned")
    saveSearchResults({
      jobId: deepSearchJobId,
      roundId: round.roundId,
      searches: [{ plannedQuery: query, results: [] }],
    })
    attachSelectionGeneration({
      jobId: deepSearchJobId,
      queryId: query.queryId,
      generationId: selectionGenerationId,
    })

    expect(() =>
      attachSelectionGeneration({
        jobId: deepSearchJobId,
        queryId: query.queryId,
        generationId: replacementGenerationId,
      }),
    ).toThrow("Search query selection generation is already registered")
    expect(
      db
        .select({ id: deepSearchQueries.selectionGenerationId })
        .from(deepSearchQueries)
        .where(eq(deepSearchQueries.deepSearchQueryId, query.queryId))
        .get(),
    ).toEqual({ id: selectionGenerationId })
  })

  it("completes an empty provider result without generation rows", () => {
    const deepSearchJobId = crypto.randomUUID()
    const queryGenerationId = crypto.randomUUID()
    insertJob(deepSearchJobId)
    insertGenerations(deepSearchJobId, [queryGenerationId])
    const round = createSearchRound({
      jobId: deepSearchJobId,
      position: 0,
      generationId: queryGenerationId,
    })
    const [plannedQuery] = savePlannedQueries({
      jobId: deepSearchJobId,
      roundId: round.roundId,
      queries: ["empty query"],
    })
    if (!plannedQuery) throw new Error("Planned query was not returned")
    const [query] = saveSearchResults({
      jobId: deepSearchJobId,
      roundId: round.roundId,
      searches: [{ plannedQuery, results: [] }],
    })
    if (!query) throw new Error("Executed query was not returned")

    completeEmptySearchQuery({
      jobId: deepSearchJobId,
      queryId: query.queryId,
    })

    expect(
      db
        .select()
        .from(deepSearchQueries)
        .where(eq(deepSearchQueries.deepSearchQueryId, query.queryId))
        .get(),
    ).toMatchObject({
      status: "completed",
      selectionGenerationId: null,
      summaryGenerationId: null,
      errorStage: null,
      errorMessage: null,
    })
    expect(db.select().from(llmGenerations).all()).toHaveLength(1)
    expect(() =>
      completeEmptySearchQuery({
        jobId: deepSearchJobId,
        queryId: query.queryId,
      }),
    ).toThrow("Empty search query was already completed")
  })

  it("rejects the empty-result completion path when a result exists", () => {
    const deepSearchJobId = crypto.randomUUID()
    const queryGenerationId = crypto.randomUUID()
    insertJob(deepSearchJobId)
    insertGenerations(deepSearchJobId, [queryGenerationId])
    const round = createSearchRound({
      jobId: deepSearchJobId,
      position: 0,
      generationId: queryGenerationId,
    })
    const [plannedQuery] = savePlannedQueries({
      jobId: deepSearchJobId,
      roundId: round.roundId,
      queries: ["non-empty query"],
    })
    if (!plannedQuery) throw new Error("Planned query was not returned")
    const [query] = saveSearchResults({
      jobId: deepSearchJobId,
      roundId: round.roundId,
      searches: [
        {
          plannedQuery,
          results: [
            {
              title: "Result",
              shortText: "Useful evidence",
              link: "https://example.com/result",
            },
          ],
        },
      ],
    })
    if (!query) throw new Error("Executed query was not returned")

    expect(() =>
      completeEmptySearchQuery({
        jobId: deepSearchJobId,
        queryId: query.queryId,
      }),
    ).toThrow("Empty search query has persisted results")
  })

  it("attaches and completes a round review by stable round ID", () => {
    const deepSearchJobId = crypto.randomUUID()
    const queryGenerationId = crypto.randomUUID()
    const reviewGenerationId = crypto.randomUUID()
    insertJob(deepSearchJobId)
    insertGenerations(deepSearchJobId, [
      queryGenerationId,
      reviewGenerationId,
    ])
    const round = createSearchRound({
      jobId: deepSearchJobId,
      position: 2,
      generationId: queryGenerationId,
    })

    db.transaction((transaction) => {
      attachRoundReviewGeneration(transaction, {
        jobId: deepSearchJobId,
        roundId: round.roundId,
        generationId: reviewGenerationId,
      })
      saveRoundReviewCompletion(transaction, {
        jobId: deepSearchJobId,
        roundId: round.roundId,
        generationId: reviewGenerationId,
        review: {
          decision: "continue",
          reason: "A source gap remains.",
        },
      })
    })

    const storedRound = db
      .select()
      .from(deepSearchRounds)
      .where(
        eq(deepSearchRounds.deepSearchRoundId, round.roundId),
      )
      .get()
    expect(storedRound).toMatchObject({
      reviewGenerationId,
      reviewDecision: "continue",
      reviewReason: "A source gap remains.",
    })
    expect(storedRound?.reviewCompletedAt).toBeInstanceOf(Date)
  })

  it("attaches one candidate answer generation to a stable round", () => {
    const deepSearchJobId = crypto.randomUUID()
    const queryGenerationId = crypto.randomUUID()
    const answerGenerationId = crypto.randomUUID()
    const replacementGenerationId = crypto.randomUUID()
    insertJob(deepSearchJobId)
    insertGenerations(deepSearchJobId, [
      queryGenerationId,
      answerGenerationId,
      replacementGenerationId,
    ])
    const round = createSearchRound({
      jobId: deepSearchJobId,
      position: 0,
      generationId: queryGenerationId,
    })

    db.transaction((transaction) => {
      attachRoundAnswerGeneration(transaction, {
        jobId: deepSearchJobId,
        roundId: round.roundId,
        generationId: answerGenerationId,
      })
    })

    expect(
      db
        .select({ answerGenerationId: deepSearchRounds.answerGenerationId })
        .from(deepSearchRounds)
        .where(eq(deepSearchRounds.deepSearchRoundId, round.roundId))
        .get(),
    ).toEqual({ answerGenerationId })
    expect(() =>
      db.transaction((transaction) => {
        attachRoundAnswerGeneration(transaction, {
          jobId: deepSearchJobId,
          roundId: round.roundId,
          generationId: replacementGenerationId,
        })
      }),
    ).toThrow("Deep-search round answer is already registered")
  })

  it("does not replace an already attached round review generation", () => {
    const deepSearchJobId = crypto.randomUUID()
    const queryGenerationId = crypto.randomUUID()
    const reviewGenerationId = crypto.randomUUID()
    const replacementGenerationId = crypto.randomUUID()
    insertJob(deepSearchJobId)
    insertGenerations(deepSearchJobId, [
      queryGenerationId,
      reviewGenerationId,
      replacementGenerationId,
    ])
    const round = createSearchRound({
      jobId: deepSearchJobId,
      position: 0,
      generationId: queryGenerationId,
    })
    db.transaction((transaction) => {
      attachRoundReviewGeneration(transaction, {
        jobId: deepSearchJobId,
        roundId: round.roundId,
        generationId: reviewGenerationId,
      })
    })

    expect(() =>
      db.transaction((transaction) => {
        attachRoundReviewGeneration(transaction, {
          jobId: deepSearchJobId,
          roundId: round.roundId,
          generationId: replacementGenerationId,
        })
      }),
    ).toThrow("Deep-search round review is already registered")
    expect(
      db
        .select({
          reviewGenerationId:
            deepSearchRounds.reviewGenerationId,
        })
        .from(deepSearchRounds)
        .where(
          eq(deepSearchRounds.deepSearchRoundId, round.roundId),
        )
        .get(),
    ).toEqual({ reviewGenerationId })
  })

  it("loads ordered durable stages and every linked generation outcome", () => {
    const deepSearchJobId = crypto.randomUUID()
    const stage = createSummarizingStage(deepSearchJobId)
    db.update(llmGenerations)
      .set({
        status: "failed",
        error: "Page summary failed",
        completedAt: new Date(),
      })
      .where(
        eq(
          llmGenerations.llmGenerationId,
          stage.pageSummaryGenerationId,
        ),
      )
      .run()

    const snapshot = loadDeepSearchExecutionSnapshot(deepSearchJobId)

    expect(snapshot).toMatchObject({
      jobId: deepSearchJobId,
      researchRequest: "Research this",
      maxSearches: 2,
      maxResultsPerSearch: 2,
      maxRounds: 3,
      strictQuality: false,
      status: "running",
      rounds: [{
        position: 0,
        queries: [{
          position: 0,
          query: "stable query",
          status: "summarizing",
          summaryGeneration: {
            generationId: stage.querySummaryGenerationId,
            status: "running",
          },
          results: [{
            position: 0,
            selectedWebPageId: stage.pageId,
          }],
        }],
      }],
      pages: [{
        pageId: stage.pageId,
        status: "summarizing",
        extractedContent: "Bounded extracted page content",
        summaryGeneration: {
          generationId: stage.pageSummaryGenerationId,
          status: "failed",
          error: "Page summary failed",
        },
      }],
    })
  })

  it("settles extraction once and clears retained content only on summary completion", () => {
    const deepSearchJobId = crypto.randomUUID()
    const stage = createSummarizingStage(deepSearchJobId)
    const creditsBeforeRetry = db
      .select({ credits: user.credits })
      .from(user)
      .where(eq(user.id, "test-user-id"))
      .get()!.credits

    expect(settlePageExtraction({
      userId: "test-user-id",
      jobId: deepSearchJobId,
      pageId: stage.pageId,
      content: "Bounded extracted page content",
      creditsUsed: 1,
    })).toEqual({
      content: "Bounded extracted page content",
      creditsUsed: 1,
    })
    expect(
      db
        .select({ credits: user.credits })
        .from(user)
        .where(eq(user.id, "test-user-id"))
        .get()!.credits,
    ).toBe(creditsBeforeRetry)

    db.transaction((transaction) => {
      transaction
        .update(llmGenerations)
        .set({
          status: "completed",
          text: "Page summary",
          reasoning: "",
          completedAt: new Date(),
        })
        .where(
          eq(
            llmGenerations.llmGenerationId,
            stage.pageSummaryGenerationId,
          ),
        )
        .run()
      completePageSummaryGeneration(transaction, {
        jobId: deepSearchJobId,
        pageId: stage.pageId,
        generationId: stage.pageSummaryGenerationId,
      })
    })
    expect(
      db
        .select({
          status: deepSearchWebPages.status,
          extractedContent: deepSearchWebPages.extractedContent,
          creditsUsed: deepSearchWebPages.creditsUsed,
        })
        .from(deepSearchWebPages)
        .where(eq(deepSearchWebPages.deepSearchWebPageId, stage.pageId))
        .get(),
    ).toEqual({ status: "completed", extractedContent: null, creditsUsed: 1 })
  })

  it("resets only unsettled search and extraction provider failures", () => {
    const deepSearchJobId = crypto.randomUUID()
    const planningGenerationId = crypto.randomUUID()
    insertJob(deepSearchJobId)
    insertGenerations(deepSearchJobId, [planningGenerationId])
    const round = createSearchRound({
      jobId: deepSearchJobId,
      position: 0,
      generationId: planningGenerationId,
    })
    const [query] = savePlannedQueries({
      jobId: deepSearchJobId,
      roundId: round.roundId,
      queries: ["retry query"],
    })
    if (!query) throw new Error("Planned query was not returned")
    const pageId = crypto.randomUUID()
    db.update(deepSearchQueries)
      .set({
        status: "failed",
        errorStage: "search",
        errorMessage: "Provider failed",
        completedAt: new Date(),
      })
      .where(eq(deepSearchQueries.deepSearchQueryId, query.queryId))
      .run()
    db.insert(deepSearchWebPages)
      .values({
        deepSearchWebPageId: pageId,
        deepSearchJobId,
        url: "https://example.com/retry",
        status: "failed",
        errorStage: "extraction",
        errorMessage: "Extraction failed",
        completedAt: new Date(),
      })
      .run()

    resetWebSearchQuery({ jobId: deepSearchJobId, queryId: query.queryId })
    resetWebSearchQuery({ jobId: deepSearchJobId, queryId: query.queryId })
    resetPageExtraction({ jobId: deepSearchJobId, pageId })
    resetPageExtraction({ jobId: deepSearchJobId, pageId })

    expect(
      db
        .select({
          status: deepSearchQueries.status,
          errorStage: deepSearchQueries.errorStage,
          completedAt: deepSearchQueries.completedAt,
        })
        .from(deepSearchQueries)
        .where(eq(deepSearchQueries.deepSearchQueryId, query.queryId))
        .get(),
    ).toEqual({ status: "searching", errorStage: null, completedAt: null })
    expect(
      db
        .select({
          status: deepSearchWebPages.status,
          errorStage: deepSearchWebPages.errorStage,
          completedAt: deepSearchWebPages.completedAt,
        })
        .from(deepSearchWebPages)
        .where(eq(deepSearchWebPages.deepSearchWebPageId, pageId))
        .get(),
    ).toEqual({ status: "extracting", errorStage: null, completedAt: null })
  })

  it.each([
    { oldState: "missing", succeeds: false },
    { oldState: "running", succeeds: true },
    { oldState: "failed", succeeds: true },
    { oldState: "interrupted", succeeds: true },
    { oldState: "completed", succeeds: false },
  ] as const)(
    "compares the exact old attempt when its link is $oldState",
    ({ oldState, succeeds }) => {
      const deepSearchJobId = crypto.randomUUID()
      const planningGenerationId = crypto.randomUUID()
      const oldGenerationId = crypto.randomUUID()
      const newGenerationId = crypto.randomUUID()
      insertJob(deepSearchJobId)
      insertGenerations(deepSearchJobId, [
        planningGenerationId,
        oldGenerationId,
        newGenerationId,
      ])
      const round = createSearchRound({
        jobId: deepSearchJobId,
        position: 0,
        generationId: planningGenerationId,
      })
      if (oldState !== "missing") {
        db.transaction((transaction) => {
          attachRoundAnswerGeneration(transaction, {
            jobId: deepSearchJobId,
            roundId: round.roundId,
            generationId: oldGenerationId,
          })
        })
      }
      if (oldState === "completed") {
        db.update(llmGenerations)
          .set({
            status: "completed",
            text: "Completed answer",
            reasoning: "",
            completedAt: new Date(),
          })
          .where(eq(llmGenerations.llmGenerationId, oldGenerationId))
          .run()
      } else if (oldState === "failed" || oldState === "interrupted") {
        db.update(llmGenerations)
          .set({
            status: oldState,
            error: `${oldState} attempt`,
            completedAt: new Date(),
          })
          .where(eq(llmGenerations.llmGenerationId, oldGenerationId))
          .run()
      }

      const replace = () => db.transaction((transaction) => {
        replaceRoundAnswerGeneration(transaction, {
          jobId: deepSearchJobId,
          roundId: round.roundId,
          oldGenerationId,
          newGenerationId,
          ...(oldState === "running"
            ? { staleRunningMessage: "Interrupted during startup reconciliation" }
            : {}),
        })
      })
      let replacementError: unknown
      try {
        replace()
      } catch (error) {
        replacementError = error
      }
      expect(replacementError === undefined).toBe(succeeds)

      expect(
        db
          .select({ generationId: deepSearchRounds.answerGenerationId })
          .from(deepSearchRounds)
          .where(eq(deepSearchRounds.deepSearchRoundId, round.roundId))
          .get(),
      ).toEqual({
        generationId: succeeds
          ? newGenerationId
          : oldState === "missing" ? null : oldGenerationId,
      })
      expect(
        db
          .select({ status: llmGenerations.status })
          .from(llmGenerations)
          .where(eq(llmGenerations.llmGenerationId, oldGenerationId))
          .get(),
      ).toEqual({
        status: oldState === "running" && succeeds
          ? "interrupted"
          : oldState === "missing" ? "running" : oldState,
      })
    },
  )

  it("replaces failed attempts for every deep-search owning generation link", () => {
    const deepSearchJobId = crypto.randomUUID()
    const attempts = Object.fromEntries(
      [
        "planningOld", "planningNew",
        "answerOld", "answerNew",
        "reviewOld", "reviewNew",
        "selectionOld", "selectionNew",
        "querySummaryOld", "querySummaryNew",
        "pageSummaryOld", "pageSummaryNew",
        "analysisOld", "analysisNew",
      ].map((name) => [name, crypto.randomUUID()]),
    ) as Record<string, string>
    insertJob(deepSearchJobId)
    insertGenerations(deepSearchJobId, Object.values(attempts))
    const round = createSearchRound({
      jobId: deepSearchJobId,
      position: 0,
      generationId: attempts.planningOld,
    })
    const [plannedQuery] = savePlannedQueries({
      jobId: deepSearchJobId,
      roundId: round.roundId,
      queries: ["stable query"],
    })
    if (!plannedQuery) throw new Error("Planned query was not returned")
    const [query] = saveSearchResults({
      jobId: deepSearchJobId,
      roundId: round.roundId,
      searches: [{
        plannedQuery,
        results: [{
          title: "Stable result",
          shortText: "Useful evidence",
          link: "https://example.com/replacement",
        }],
      }],
    })
    if (!query) throw new Error("Settled query was not returned")
    attachSelectionGeneration({
      jobId: deepSearchJobId,
      queryId: query.queryId,
      generationId: attempts.selectionOld,
    })
    db.transaction((transaction) => {
      attachRoundAnswerGeneration(transaction, {
        jobId: deepSearchJobId,
        roundId: round.roundId,
        generationId: attempts.answerOld,
      })
      attachRoundReviewGeneration(transaction, {
        jobId: deepSearchJobId,
        roundId: round.roundId,
        generationId: attempts.reviewOld,
      })
      attachResearchAnalysisGeneration(transaction, {
        jobId: deepSearchJobId,
        generationId: attempts.analysisOld,
      })
    })
    for (const generationId of [
      attempts.planningOld,
      attempts.answerOld,
      attempts.reviewOld,
      attempts.selectionOld,
      attempts.analysisOld,
    ]) {
      db.update(llmGenerations)
        .set({ status: "failed", error: "Failed attempt", completedAt: new Date() })
        .where(eq(llmGenerations.llmGenerationId, generationId))
        .run()
    }
    saveRoundReviewFailure({
      jobId: deepSearchJobId,
      roundId: round.roundId,
      generationId: attempts.reviewOld,
      message: "Failed attempt",
    })
    db.transaction((transaction) => {
      replaceRoundPlanningGeneration(transaction, {
        jobId: deepSearchJobId,
        roundId: round.roundId,
        oldGenerationId: attempts.planningOld,
        newGenerationId: attempts.planningNew,
      })
      replaceRoundAnswerGeneration(transaction, {
        jobId: deepSearchJobId,
        roundId: round.roundId,
        oldGenerationId: attempts.answerOld,
        newGenerationId: attempts.answerNew,
      })
      replaceRoundReviewGeneration(transaction, {
        jobId: deepSearchJobId,
        roundId: round.roundId,
        oldGenerationId: attempts.reviewOld,
        newGenerationId: attempts.reviewNew,
      })
      replaceQuerySelectionGeneration(transaction, {
        jobId: deepSearchJobId,
        queryId: query.queryId,
        oldGenerationId: attempts.selectionOld,
        newGenerationId: attempts.selectionNew,
      })
      replaceResearchAnalysisGeneration(transaction, {
        jobId: deepSearchJobId,
        oldGenerationId: attempts.analysisOld,
        newGenerationId: attempts.analysisNew,
      })
    })

    const [result] = query.results
    if (!result) throw new Error("Search result was not returned")
    const [page] = saveSelectedResults({
      jobId: deepSearchJobId,
      queryId: query.queryId,
      selectionGenerationId: attempts.selectionNew,
      selectedResultIds: [result.resultId],
    })
    if (!page) throw new Error("Selected page was not returned")
    settlePageExtraction({
      userId: "test-user-id",
      jobId: deepSearchJobId,
      pageId: page.pageId,
      content: "Bounded extracted page content",
      creditsUsed: 1,
    })
    db.transaction((transaction) => {
      attachQuerySummaryGeneration(transaction, {
        jobId: deepSearchJobId,
        queryId: query.queryId,
        generationId: attempts.querySummaryOld,
      })
      attachPageSummaryGeneration(transaction, {
        jobId: deepSearchJobId,
        pageId: page.pageId,
        generationId: attempts.pageSummaryOld,
      })
    })
    for (const generationId of [
      attempts.querySummaryOld,
      attempts.pageSummaryOld,
    ]) {
      db.update(llmGenerations)
        .set({ status: "failed", error: "Failed attempt", completedAt: new Date() })
        .where(eq(llmGenerations.llmGenerationId, generationId))
        .run()
    }
    db.transaction((transaction) => {
      failQuerySummaryGeneration(transaction, {
        jobId: deepSearchJobId,
        queryId: query.queryId,
        generationId: attempts.querySummaryOld,
        message: "Failed attempt",
      })
      failPageSummaryGeneration(transaction, {
        jobId: deepSearchJobId,
        pageId: page.pageId,
        generationId: attempts.pageSummaryOld,
        message: "Failed attempt",
      })
    })
    db.transaction((transaction) => {
      replaceQuerySummaryGeneration(transaction, {
        jobId: deepSearchJobId,
        queryId: query.queryId,
        oldGenerationId: attempts.querySummaryOld,
        newGenerationId: attempts.querySummaryNew,
      })
      replacePageSummaryGeneration(transaction, {
        jobId: deepSearchJobId,
        pageId: page.pageId,
        oldGenerationId: attempts.pageSummaryOld,
        newGenerationId: attempts.pageSummaryNew,
      })
    })

    expect(loadDeepSearchExecutionSnapshot(deepSearchJobId)).toMatchObject({
      researchAnalysisGeneration: {
        generationId: attempts.analysisNew,
        status: "running",
      },
      rounds: [{
        planningGeneration: { generationId: attempts.planningNew },
        answerGeneration: { generationId: attempts.answerNew },
        reviewGeneration: { generationId: attempts.reviewNew },
        reviewError: null,
        queries: [{
          status: "summarizing",
          selectionGeneration: { generationId: attempts.selectionNew },
          summaryGeneration: { generationId: attempts.querySummaryNew },
          errorMessage: null,
        }],
      }],
      pages: [{
        status: "summarizing",
        extractedContent: "Bounded extracted page content",
        summaryGeneration: { generationId: attempts.pageSummaryNew },
        errorMessage: null,
      }],
    })
  })

  it("rejects generations owned by another job", () => {
    const deepSearchJobId = crypto.randomUUID()
    const foreignDeepSearchJobId = crypto.randomUUID()
    const foreignGenerationId = crypto.randomUUID()
    insertJob(deepSearchJobId)
    insertJob(foreignDeepSearchJobId)
    insertGenerations(foreignDeepSearchJobId, [foreignGenerationId])

    expect(() =>
      createSearchRound({
        jobId: deepSearchJobId,
        position: 0,
        generationId: foreignGenerationId,
      }),
    ).toThrow("LLM generation must belong to the deep-search job owner")
    expect(db.select().from(deepSearchRounds).all()).toEqual([])
  })
})
