import { eq } from "drizzle-orm"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { db } from "../../db/index.ts"
import { startRoundReview } from "../../agents/deep_search/reviewRound.ts"
import type { TextStreamPersistenceTransaction } from "../../llms/streams.ts"

const reviewModel = vi.hoisted(() => ({ generateObjectStream: vi.fn() }))
vi.mock("../../llms/generateText.ts", () => ({ generateObjectStream: reviewModel.generateObjectStream }))
import { reconstructDeepSearchJobEvents } from "./replay.ts"
import {
  deepSearchJobs,
  deepSearchPageLinks,
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
  attachPageLinkSelectionGeneration,
  createSearchRound,
  attachQuerySummaryGeneration,
  attachResearchAnalysisGeneration,
  attachRoundAnswerGeneration,
  attachRoundReviewGeneration,
  attachSelectionGeneration,
  completeEmptySearchQuery,
  completePageSummaryGeneration,
  completePageLinkSelection,
  completeQuerySummaryGeneration,
  failPageSummaryGeneration,
  failQuerySummaryGeneration,
  loadDeepSearchExecutionSnapshot,
  replaceRoundAnswerGeneration,
  replaceFinalAnswerGeneration,
  replacePageSummaryGeneration,
  replacePageLinkSelectionGeneration,
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

function createSummarizingStage(
  deepSearchJobId: string,
  content = "Bounded extracted page content",
) {
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
    content,
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

function createLinkJob() {
  const jobId = crypto.randomUUID()
  const planningId = crypto.randomUUID()
  insertJob(jobId)
  insertGenerations(jobId, [planningId])
  const round = createSearchRound({ jobId, position: 0, generationId: planningId })
  return { jobId, roundId: round.roundId }
}

function createLinkSource(jobId: string, url: string, links: Array<{ url: string; title: string }>) {
  const pageId = crypto.randomUUID()
  const generationId = crypto.randomUUID()
  db.insert(deepSearchWebPages).values({ deepSearchWebPageId: pageId, deepSearchJobId: jobId, url, status: "extracting" }).run()
  settlePageExtraction({ jobId, pageId, userId: "test-user-id", content: "Extracted source material", creditsUsed: 1, links })
  insertGenerations(jobId, [generationId])
  db.transaction((transaction) => attachPageLinkSelectionGeneration(transaction, { jobId, pageId, generationId }))
  const page = loadDeepSearchExecutionSnapshot(jobId)!.pages.find((candidate) => candidate.pageId === pageId)!
  return { pageId, generationId, links: page.links }
}

function completeLinkSelection(input: Parameters<typeof completePageLinkSelection>[1]) {
  return db.transaction((transaction) => {
    transaction.update(llmGenerations).set({ status: "completed", text: JSON.stringify({ selectedIds: input.selectedLinkIds }), reasoning: "", completedAt: new Date() })
      .where(eq(llmGenerations.llmGenerationId, input.generationId)).run()
    return completePageLinkSelection(transaction, input)
  })
}

describe("deep-search store", () => {
  beforeEach(() => {
    db.delete(deepSearchJobs).run()
    db.delete(llmGenerations).run()
  })

  it("settles discovered links and extraction credits atomically and only once", () => {
    const { jobId } = createLinkJob()
    const pageId = crypto.randomUUID()
    db.insert(deepSearchWebPages).values({ deepSearchWebPageId: pageId, deepSearchJobId: jobId, url: "https://example.com/source", status: "extracting" }).run()
    const credits = db.select({ balance: user.credits }).from(user).where(eq(user.id, "test-user-id")).get()!.balance
    const input = { jobId, pageId, userId: "test-user-id", content: "Extracted source material", creditsUsed: 2 }
    expect(() => settlePageExtraction({ ...input, links: [{ url: "https://example.com/target", title: "" }] })).toThrow(/content_check/)
    expect(loadDeepSearchExecutionSnapshot(jobId)!.pages[0]).toMatchObject({ status: "extracting", extractedContent: null, originalPassages: null, creditsUsed: null, links: [] })
    expect(db.select({ balance: user.credits }).from(user).where(eq(user.id, "test-user-id")).get()!.balance).toBe(credits)

    const links = [{ url: "https://example.com/target", title: "Primary evidence" }]
    settlePageExtraction({ ...input, links })
    const firstLinks = loadDeepSearchExecutionSnapshot(jobId)!.pages[0].links
    settlePageExtraction({ ...input, links })
    expect(loadDeepSearchExecutionSnapshot(jobId)!.pages[0].links).toEqual(firstLinks)
    expect(db.select({ balance: user.credits }).from(user).where(eq(user.id, "test-user-id")).get()!.balance).toBe(credits - 2)
    expect(() => settlePageExtraction({ ...input, links: [] })).toThrow("Page links conflict with persisted extraction")
  })

  it("deduplicates linked destinations across parents without fabricating search results", () => {
    const { jobId, roundId } = createLinkJob()
    const target = { url: "https://example.com/primary", title: "Primary evidence" }
    const first = createLinkSource(jobId, "https://example.com/source-one", [target])
    const second = createLinkSource(jobId, "https://example.com/source-two", [target])
    const selection = (source: typeof first) => ({ jobId, roundId, sourcePageId: source.pageId, generationId: source.generationId, selectedLinkIds: [source.links[0].linkId] })
    const firstPages = completeLinkSelection(selection(first))
    expect(completeLinkSelection(selection(second))).toEqual(firstPages)
    expect(db.select().from(deepSearchResults).all()).toEqual([])
    expect(loadDeepSearchExecutionSnapshot(jobId)!.pages).toHaveLength(3)
    const selectedLinks = db.select().from(deepSearchPageLinks).all()
    expect(selectedLinks.map((link) => link.selectedWebPageId)).toEqual([firstPages[0].pageId, firstPages[0].pageId])
    expect(selectedLinks.map((link) => link.selectedRoundId)).toEqual([roundId, roundId])
    expect(db.transaction((transaction) => completePageLinkSelection(transaction, selection(first)))).toEqual(firstPages)
    expect(() => db.transaction((transaction) => completePageLinkSelection(transaction, { ...selection(first), selectedLinkIds: [] }))).toThrow("conflicts with completed generation output")
    expect(() => db.update(deepSearchPageLinks).set({ selectedWebPageId: null, selectedRoundId: null }).where(eq(deepSearchPageLinks.sourceWebPageId, first.pageId)).run()).toThrow("selected page link is immutable")
    db.delete(deepSearchJobs).where(eq(deepSearchJobs.deepSearchJobId, jobId)).run()
    expect(db.select().from(deepSearchPageLinks).all()).toEqual([])
    expect(db.select().from(deepSearchWebPages).all()).toEqual([])
    expect(db.select().from(llmGenerations).all()).toEqual([])
  })

  it("retains completed empty link selection after page content is cleared", () => {
    const { jobId, roundId } = createLinkJob()
    const source = createLinkSource(jobId, "https://example.com/source", [{ url: "https://example.com/unused", title: "Unneeded appendix" }])
    completeLinkSelection({ jobId, roundId, sourcePageId: source.pageId, generationId: source.generationId, selectedLinkIds: [] })
    const summaryId = crypto.randomUUID()
    const replacementId = crypto.randomUUID()
    insertGenerations(jobId, [summaryId, replacementId])
    db.transaction((transaction) => {
      attachPageSummaryGeneration(transaction, { jobId, pageId: source.pageId, generationId: summaryId })
      transaction.update(llmGenerations).set({ status: "completed", text: "Source evidence", reasoning: "", completedAt: new Date() }).where(eq(llmGenerations.llmGenerationId, summaryId)).run()
      completePageSummaryGeneration(transaction, { jobId, pageId: source.pageId, generationId: summaryId })
    })
    expect(loadDeepSearchExecutionSnapshot(jobId)!.pages[0]).toMatchObject({ status: "completed", extractedContent: null, links: [{ url: "https://example.com/unused", selectedWebPageId: null }], linkSelectionGeneration: { status: "completed", text: '{"selectedIds":[]}' } })
    expect(() => db.transaction((transaction) => replacePageLinkSelectionGeneration(transaction, { jobId, pageId: source.pageId, oldGenerationId: source.generationId, newGenerationId: replacementId }))).toThrow("Completed LLM generation cannot be replaced")
  })

  it("enforces one cumulative linked-page allowance per round before creating targets", () => {
    const { jobId, roundId } = createLinkJob()
    const links = Array.from({ length: 13 }, (_, index) => ({ url: `https://example.com/evidence-${index}`, title: `Evidence ${index}` }))
    const first = createLinkSource(jobId, "https://example.com/source-one", links.slice(0, 6))
    const second = createLinkSource(jobId, "https://example.com/source-two", links.slice(6))
    completeLinkSelection({ jobId, roundId, sourcePageId: first.pageId, generationId: first.generationId, selectedLinkIds: first.links.map(({ linkId }) => linkId) })
    expect(() => completeLinkSelection({ jobId, roundId, sourcePageId: second.pageId, generationId: second.generationId, selectedLinkIds: second.links.map(({ linkId }) => linkId) })).toThrow("round exploration limit")
    expect(loadDeepSearchExecutionSnapshot(jobId)!.pages).toHaveLength(8)
    expect(loadDeepSearchExecutionSnapshot(jobId)!.pages.find((page) => page.pageId === second.pageId)).toMatchObject({ linkSelectionGeneration: { status: "running" } })
    expect(db.select().from(deepSearchPageLinks).where(eq(deepSearchPageLinks.sourceWebPageId, second.pageId)).all().every((link) => link.selectedWebPageId === null)).toBe(true)
  })

  it("rejects foreign candidates and rounds and resumes only an unfinished selector", () => {
    const { jobId, roundId } = createLinkJob()
    const other = createLinkJob()
    const source = createLinkSource(jobId, "https://example.com/source", [{ url: "https://example.com/target", title: "Target" }])
    const input = { jobId, roundId, sourcePageId: source.pageId, generationId: source.generationId, selectedLinkIds: [source.links[0].linkId] }
    expect(() => completeLinkSelection({ ...input, roundId: other.roundId })).toThrow("Deep-search round must belong")
    expect(() => completeLinkSelection({ ...input, selectedLinkIds: [crypto.randomUUID()] })).toThrow("was not discovered")
    const replacementId = crypto.randomUUID()
    insertGenerations(jobId, [replacementId])
    db.transaction((transaction) => replacePageLinkSelectionGeneration(transaction, { jobId, pageId: source.pageId, oldGenerationId: source.generationId, newGenerationId: replacementId, staleRunningMessage: "Server restarted" }))
    expect(loadDeepSearchExecutionSnapshot(jobId)!.pages[0]).toMatchObject({ creditsUsed: 1, extractedContent: "Extracted source material", linkSelectionGeneration: { generationId: replacementId, status: "running" } })
    expect(db.select().from(llmGenerations).where(eq(llmGenerations.llmGenerationId, source.generationId)).get()).toMatchObject({ status: "interrupted", error: "Server restarted" })
    const selectedPages = completeLinkSelection({ ...input, generationId: replacementId })
    expect(selectedPages).toHaveLength(1)
    expect(selectedPages[0].url).toBe("https://example.com/target")
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

  it("atomically retains raw material gaps and the derived review outcome for replay", async () => {
    const jobId = crypto.randomUUID()
    const planId = crypto.randomUUID()
    const reviewId = crypto.randomUUID()
    insertJob(jobId)
    insertGenerations(jobId, [planId, reviewId])
    const round = createSearchRound({ jobId, position: 0, generationId: planId })
    const raw = {
      version: 1,
      reason: "The general answer is supported, but a decision-changing condition is missing.",
      requirements: [{ requirement: "Confirm eligibility", kind: "requirement", status: "unresolved", sources: [], explanation: "Eligibility evidence is missing." }],
      gaps: [{ title: "Eligibility terms", description: "The price cannot be recommended before checking who qualifies.", evidenceToFind: "Find official eligibility terms for the advertised price." }],
    }
    const rawText = JSON.stringify(raw)
    let completeReview: ((completed: { id: string; output: unknown }, transaction: TextStreamPersistenceTransaction) => void) | undefined
    reviewModel.generateObjectStream.mockImplementationOnce((input: { onCompleted: typeof completeReview }) => {
      completeReview = input.onCompleted
      return Promise.resolve({ id: reviewId, output: Promise.resolve(raw), completion: Promise.resolve({ status: "completed", text: rawText, reasoning: "" }) })
    })
    const review = await startRoundReview({
      userId: "test-user-id", deepSearchJobId: jobId, researchRequest: "Research this", candidateAnswer: "The advertised option meets the request.", completedRound: 0, maxRounds: 3, searchSummaries: [],
      onCompleted: (completed, transaction) => saveRoundReviewCompletion(transaction, { jobId, roundId: round.roundId, generationId: completed.id, review: completed.output }),
    })
    const effective = await review.review
    db.transaction((transaction) => attachRoundReviewGeneration(transaction, { jobId, roundId: round.roundId, generationId: reviewId }))
    const complete = (transaction: TextStreamPersistenceTransaction) => {
      transaction.update(llmGenerations).set({ status: "completed", text: rawText, reasoning: "", completedAt: new Date() })
        .where(eq(llmGenerations.llmGenerationId, reviewId)).run()
      if (!completeReview) throw new Error("Review terminal adapter was not registered")
      completeReview({ id: reviewId, output: raw }, transaction)
    }

    expect(() => db.transaction((transaction) => {
      complete(transaction)
      throw new Error("Later terminal write failed")
    })).toThrow("Later terminal write failed")
    expect(loadDeepSearchExecutionSnapshot(jobId)?.rounds[0]).toMatchObject({ reviewDecision: null, reviewReason: null, reviewCompletedAt: null, reviewGeneration: { status: "running", text: null } })

    db.transaction(complete)

    expect(loadDeepSearchExecutionSnapshot(jobId)?.rounds[0]).toMatchObject({ reviewDecision: "continue", reviewReason: effective.reason, reviewGeneration: { status: "completed", text: rawText } })
    expect(effective.reason).toContain(raw.gaps[0].description)
    expect(effective.reason).toContain(raw.gaps[0].evidenceToFind)
    const events = reconstructDeepSearchJobEvents(jobId) ?? []
    expect(events.filter((event) => event.type === "round-review")).toEqual([{ type: "round-review", round: 0, decision: "continue", reason: effective.reason }])
    expect(events.filter((event) => event.type === "research-requirements")).toEqual([{ type: "research-requirements", round: 0, requirements: raw.requirements }])
    expect(JSON.parse(rawText)).not.toHaveProperty("decision")
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

  it("settles extraction once and preserves original passages after summary completion", () => {
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
          originalPassages: deepSearchWebPages.originalPassages,
          creditsUsed: deepSearchWebPages.creditsUsed,
        })
        .from(deepSearchWebPages)
        .where(eq(deepSearchWebPages.deepSearchWebPageId, stage.pageId))
        .get(),
    ).toEqual({ status: "completed", extractedContent: null, originalPassages: "Bounded extracted page content", creditsUsed: 1 })
    expect(loadDeepSearchExecutionSnapshot(deepSearchJobId)?.pages[0]).toMatchObject({
      originalPassages: "Bounded extracted page content",
      extractedContent: null,
      summaryGeneration: { text: "Page summary" },
    })
    settlePageExtraction({
      userId: "test-user-id", jobId: deepSearchJobId, pageId: stage.pageId,
      content: "Bounded extracted page content", creditsUsed: 1,
    })
    expect(loadDeepSearchExecutionSnapshot(deepSearchJobId)?.pages[0].originalPassages).toBe("Bounded extracted page content")
    expect(() => db.update(deepSearchWebPages).set({ originalPassages: "x".repeat(16_001) })
      .where(eq(deepSearchWebPages.deepSearchWebPageId, stage.pageId)).run()).toThrow(/original_passages_check/)
  })

  it("refines original passages from the completed summary before clearing extraction", () => {
    const jobId = crypto.randomUUID()
    const qualification = "Sealed exports require unchanged media; modifying them can produce stale results."
    const content = `${"General storage background. ".repeat(1_000)}\n${qualification}\n${"General storage background. ".repeat(1_000)}`
    const stage = createSummarizingStage(jobId, content)
    const before = loadDeepSearchExecutionSnapshot(jobId)!.pages[0]
    expect(before.originalPassages).not.toContain(qualification)

    db.transaction((transaction) => {
      transaction.update(llmGenerations).set({
        status: "completed", text: `${qualification} An unsupported guarantee appears only in this summary.`,
        reasoning: "", completedAt: new Date(),
      }).where(eq(llmGenerations.llmGenerationId, stage.pageSummaryGenerationId)).run()
      completePageSummaryGeneration(transaction, {
        jobId, pageId: stage.pageId, generationId: stage.pageSummaryGenerationId,
      })
    })

    const completed = loadDeepSearchExecutionSnapshot(jobId)!.pages[0]
    expect(completed).toMatchObject({ status: "completed", extractedContent: null, creditsUsed: before.creditsUsed })
    expect(completed.originalPassages).toContain(qualification)
    expect(completed.originalPassages!.length).toBeLessThanOrEqual(16_000)
    for (const passage of completed.originalPassages!.split("\n[... omitted ...]\n")) {
      expect(content).toContain(passage)
    }
    expect(completed.originalPassages).not.toContain("unsupported guarantee")

    db.transaction((transaction) => completePageSummaryGeneration(transaction, {
      jobId, pageId: stage.pageId, generationId: stage.pageSummaryGenerationId,
    }))
    expect(loadDeepSearchExecutionSnapshot(jobId)!.pages[0]).toEqual(completed)

    // Completed pre-upgrade pages have neither extraction nor original passages.
    db.update(deepSearchWebPages).set({ originalPassages: null })
      .where(eq(deepSearchWebPages.deepSearchWebPageId, stage.pageId)).run()
    const legacy = loadDeepSearchExecutionSnapshot(jobId)!.pages[0]
    db.transaction((transaction) => completePageSummaryGeneration(transaction, {
      jobId, pageId: stage.pageId, generationId: stage.pageSummaryGenerationId,
    }))
    expect(loadDeepSearchExecutionSnapshot(jobId)!.pages[0]).toEqual(legacy)
  })

  it.each(["running", "failed", "blank"] as const)(
    "does not discard extracted evidence for a %s page summary generation",
    (state) => {
      const jobId = crypto.randomUUID()
      const stage = createSummarizingStage(jobId)
      if (state !== "running") {
        db.update(llmGenerations).set(state === "failed" ? {
          status: "failed", error: "Summary failed", completedAt: new Date(),
        } : {
          status: "completed", text: "\u00a0", reasoning: "", completedAt: new Date(),
        }).where(eq(llmGenerations.llmGenerationId, stage.pageSummaryGenerationId)).run()
      }
      const before = loadDeepSearchExecutionSnapshot(jobId)!.pages[0]

      expect(() => db.transaction((transaction) => completePageSummaryGeneration(transaction, {
        jobId, pageId: stage.pageId, generationId: stage.pageSummaryGenerationId,
      }))).toThrow()
      expect(loadDeepSearchExecutionSnapshot(jobId)!.pages[0]).toEqual(before)
    },
  )

  it.each(["same job", "another job"])(
    "rejects an unregistered completed summary from %s without changing passages",
    (owner) => {
      const jobId = crypto.randomUUID()
      const stage = createSummarizingStage(jobId)
      const generationId = crypto.randomUUID()
      const ownerId = owner === "same job" ? jobId : crypto.randomUUID()
      if (ownerId !== jobId) insertJob(ownerId)
      insertGenerations(ownerId, [generationId])
      db.update(llmGenerations).set({
        status: "completed", text: "A different summary", reasoning: "", completedAt: new Date(),
      }).where(eq(llmGenerations.llmGenerationId, generationId)).run()
      const before = loadDeepSearchExecutionSnapshot(jobId)!.pages[0]

      expect(() => db.transaction((transaction) => completePageSummaryGeneration(transaction, {
        jobId, pageId: stage.pageId, generationId,
      }))).toThrow()
      expect(loadDeepSearchExecutionSnapshot(jobId)!.pages[0]).toEqual(before)
    },
  )

  it("rolls back passage refinement and extraction cleanup with summary completion", () => {
    const jobId = crypto.randomUUID()
    const qualification = "Sealed exports require unchanged media; modifying them can produce stale results."
    const content = `${"General storage background. ".repeat(1_000)}\n${qualification}\n${"General storage background. ".repeat(1_000)}`
    const stage = createSummarizingStage(jobId, content)
    const before = loadDeepSearchExecutionSnapshot(jobId)!.pages[0]
    expect(before.originalPassages).not.toContain(qualification)

    expect(() => db.transaction((transaction) => {
      transaction.update(llmGenerations).set({
        status: "completed", text: qualification, reasoning: "", completedAt: new Date(),
      }).where(eq(llmGenerations.llmGenerationId, stage.pageSummaryGenerationId)).run()
      completePageSummaryGeneration(transaction, {
        jobId, pageId: stage.pageId, generationId: stage.pageSummaryGenerationId,
      })
      expect(transaction.select({ passages: deepSearchWebPages.originalPassages })
        .from(deepSearchWebPages).where(eq(deepSearchWebPages.deepSearchWebPageId, stage.pageId)).get()?.passages)
        .toContain(qualification)
      throw new Error("Later completion write failed")
    })).toThrow("Later completion write failed")

    expect(loadDeepSearchExecutionSnapshot(jobId)!.pages[0]).toEqual(before)
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
        "finalOld", "finalNew",
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
      attachFinalAnswerGeneration(transaction, {
        jobId: deepSearchJobId,
        generationId: attempts.finalOld,
      })
    })
    for (const generationId of [
      attempts.planningOld,
      attempts.answerOld,
      attempts.reviewOld,
      attempts.selectionOld,
      attempts.analysisOld,
      attempts.finalOld,
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
      replaceFinalAnswerGeneration(transaction, {
        jobId: deepSearchJobId,
        oldGenerationId: attempts.finalOld,
        newGenerationId: attempts.finalNew,
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
      finalAnswerGeneration: { generationId: attempts.finalNew, status: "running" },
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
        originalPassages: "Bounded extracted page content",
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
