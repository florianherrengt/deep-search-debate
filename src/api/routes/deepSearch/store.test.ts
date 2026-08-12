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
} from "../../db/schema/index.ts"
import {
  attachFinalAnswerGeneration,
  attachPageSummaryGeneration,
  createSearchRound,
  attachQuerySummaryGeneration,
  attachRoundAnswerGeneration,
  attachRoundReviewGeneration,
  attachSelectionGeneration,
  completeEmptySearchQuery,
  completePageSummaryGeneration,
  completeQuerySummaryGeneration,
  failPageSummaryGeneration,
  failQuerySummaryGeneration,
  savePageFailure,
  savePlannedQueries,
  saveRoundReviewCompletion,
  saveSearchResults,
  saveSelectedResults,
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

  it("rolls back a result batch when any generated query is foreign", () => {
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

    expect(() =>
      saveSearchResults({
        jobId: deepSearchJobId,
        roundId: round.roundId,
        searches: [
          {
            plannedQuery,
            results: [],
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
    expect(db.select().from(deepSearchQueries).all()).toHaveLength(1)
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
