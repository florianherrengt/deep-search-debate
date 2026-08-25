import { randomUUID } from "node:crypto"
import { and, asc, eq, inArray, isNull } from "drizzle-orm"
import type { DeepSearchSearch } from "../../agents/deep_search/schemas.ts"
import type { RoundReview } from "../../agents/deep_search/reviewRound.ts"
import { db } from "../../db/index.ts"
import {
  deepSearchJobs,
  deepSearchQueries,
  deepSearchRounds,
  deepSearchResults,
  deepSearchWebPages,
  llmGenerations,
} from "../../db/schema/index.ts"
import type { TextStreamPersistenceTransaction } from "../../llms/streams.ts"
import { debitCredits } from "../../credits.ts"
import { assertEffectiveResearchRootRunning } from "../researchCancellation.ts"
import type {
  DeepSearchExecutionSnapshot,
  ExecutedQuery,
  PersistedGeneration,
  PlannedQuery,
  SearchResultRecord,
  SearchRound,
  SelectedPage,
  SettledSearchQuery,
} from "./records.ts"

type SearchResultInput = DeepSearchSearch["results"][number]

function assertDeepSearchActive(
  transaction: TextStreamPersistenceTransaction,
  jobId: string,
): void {
  assertEffectiveResearchRootRunning(transaction, {
    kind: "deep-search",
    jobId,
  })
}

function assertGenerationOwnedByJob(
  transaction: TextStreamPersistenceTransaction,
  deepSearchJobId: string,
  llmGenerationId: string,
): void {
  const generation = transaction
    .select({ deepSearchJobId: llmGenerations.deepSearchJobId })
    .from(llmGenerations)
    .where(eq(llmGenerations.llmGenerationId, llmGenerationId))
    .get()
  if (generation?.deepSearchJobId !== deepSearchJobId) {
    throw new Error("LLM generation must belong to the deep-search job owner")
  }
}

function assertRoundOwnedByJob(
  transaction: TextStreamPersistenceTransaction,
  deepSearchJobId: string,
  deepSearchRoundId: string,
): void {
  const round = transaction
    .select({ deepSearchJobId: deepSearchRounds.deepSearchJobId })
    .from(deepSearchRounds)
    .where(eq(deepSearchRounds.deepSearchRoundId, deepSearchRoundId))
    .get()
  if (round?.deepSearchJobId !== deepSearchJobId) {
    throw new Error("Deep-search round must belong to the deep-search job")
  }
}

function assertQueryOwnedByJob(
  transaction: TextStreamPersistenceTransaction,
  deepSearchJobId: string,
  deepSearchQueryId: string,
): void {
  const query = transaction
    .select({ deepSearchJobId: deepSearchRounds.deepSearchJobId })
    .from(deepSearchQueries)
    .innerJoin(
      deepSearchRounds,
      eq(deepSearchQueries.deepSearchRoundId, deepSearchRounds.deepSearchRoundId),
    )
    .where(eq(deepSearchQueries.deepSearchQueryId, deepSearchQueryId))
    .get()
  if (query?.deepSearchJobId !== deepSearchJobId) {
    throw new Error("Search query must belong to the deep-search job")
  }
}

function assertPageOwnedByJob(
  transaction: TextStreamPersistenceTransaction,
  deepSearchJobId: string,
  deepSearchWebPageId: string,
): void {
  const page = transaction
    .select({ deepSearchJobId: deepSearchWebPages.deepSearchJobId })
    .from(deepSearchWebPages)
    .where(eq(deepSearchWebPages.deepSearchWebPageId, deepSearchWebPageId))
    .get()
  if (page?.deepSearchJobId !== deepSearchJobId) {
    throw new Error("Web page must belong to the deep-search job")
  }
}

function toPersistedGeneration(
  generation: typeof llmGenerations.$inferSelect,
): PersistedGeneration {
  return {
    generationId: generation.llmGenerationId,
    status: generation.status,
    text: generation.text,
    reasoning: generation.reasoning,
    error: generation.error,
  }
}

/** Loads the complete durable checkpoint graph needed to resume one search. */
export function loadDeepSearchExecutionSnapshot(
  jobId: string,
): DeepSearchExecutionSnapshot | undefined {
  const job = db
    .select()
    .from(deepSearchJobs)
    .where(eq(deepSearchJobs.deepSearchJobId, jobId))
    .get()
  if (!job) return undefined

  const rounds = db
    .select()
    .from(deepSearchRounds)
    .where(eq(deepSearchRounds.deepSearchJobId, jobId))
    .orderBy(
      asc(deepSearchRounds.position),
      asc(deepSearchRounds.deepSearchRoundId),
    )
    .all()
  const roundIds = rounds.map(({ deepSearchRoundId }) => deepSearchRoundId)
  const queries = roundIds.length === 0
    ? []
    : db
        .select()
        .from(deepSearchQueries)
        .where(inArray(deepSearchQueries.deepSearchRoundId, roundIds))
        .orderBy(
          asc(deepSearchQueries.deepSearchRoundId),
          asc(deepSearchQueries.position),
          asc(deepSearchQueries.deepSearchQueryId),
        )
        .all()
  const queryIds = queries.map(({ deepSearchQueryId }) => deepSearchQueryId)
  const results = queryIds.length === 0
    ? []
    : db
        .select()
        .from(deepSearchResults)
        .where(inArray(deepSearchResults.deepSearchQueryId, queryIds))
        .orderBy(
          asc(deepSearchResults.deepSearchQueryId),
          asc(deepSearchResults.position),
          asc(deepSearchResults.deepSearchResultId),
        )
        .all()
  const pages = db
    .select()
    .from(deepSearchWebPages)
    .where(eq(deepSearchWebPages.deepSearchJobId, jobId))
    .orderBy(
      asc(deepSearchWebPages.createdAt),
      asc(deepSearchWebPages.deepSearchWebPageId),
    )
    .all()

  const generationIds = new Set<string>()
  const addGenerationId = (generationId: string | null): void => {
    if (generationId !== null) generationIds.add(generationId)
  }
  addGenerationId(job.finalAnswerGenerationId)
  addGenerationId(job.researchAnalysisGenerationId)
  for (const round of rounds) {
    addGenerationId(round.llmGenerationId)
    addGenerationId(round.answerGenerationId)
    addGenerationId(round.reviewGenerationId)
  }
  for (const query of queries) {
    addGenerationId(query.selectionGenerationId)
    addGenerationId(query.summaryGenerationId)
  }
  for (const page of pages) addGenerationId(page.summaryGenerationId)

  const generations = generationIds.size === 0
    ? []
    : db
        .select()
        .from(llmGenerations)
        .where(inArray(llmGenerations.llmGenerationId, [...generationIds]))
        .all()
  const generationsById = new Map(
    generations.map((generation) => [generation.llmGenerationId, generation]),
  )
  const getGeneration = (
    generationId: string | null,
  ): PersistedGeneration | null => {
    if (generationId === null) return null
    const generation = generationsById.get(generationId)
    if (!generation) {
      throw new Error(`Linked LLM generation was not found: ${generationId}`)
    }
    if (generation.deepSearchJobId !== jobId) {
      throw new Error(`Linked LLM generation has a foreign owner: ${generationId}`)
    }
    return toPersistedGeneration(generation)
  }

  const resultsByQueryId = Map.groupBy(
    results,
    ({ deepSearchQueryId }) => deepSearchQueryId,
  )
  const queriesByRoundId = Map.groupBy(
    queries,
    ({ deepSearchRoundId }) => deepSearchRoundId,
  )
  return {
    jobId: job.deepSearchJobId,
    userId: job.userId,
    ideaJobId: job.ideaJobId,
    researchRequest: job.researchRequest,
    maxSearches: job.maxSearches,
    maxResultsPerSearch: job.maxResultsPerSearch,
    maxRounds: job.maxRounds,
    strictQuality: job.strictQuality,
    status: job.status,
    error: job.error,
    cancelRequestedAt: job.cancelRequestedAt,
    completedAt: job.completedAt,
    finalAnswerGeneration: getGeneration(job.finalAnswerGenerationId),
    researchAnalysisGeneration: getGeneration(
      job.researchAnalysisGenerationId,
    ),
    rounds: rounds.map((round) => ({
      roundId: round.deepSearchRoundId,
      position: round.position,
      planningGeneration: getGeneration(round.llmGenerationId)!,
      answerGeneration: getGeneration(round.answerGenerationId),
      reviewGeneration: getGeneration(round.reviewGenerationId),
      reviewDecision: round.reviewDecision,
      reviewReason: round.reviewReason,
      reviewError: round.reviewError,
      reviewCompletedAt: round.reviewCompletedAt,
      queries: (queriesByRoundId.get(round.deepSearchRoundId) ?? []).map(
        (query) => ({
          queryId: query.deepSearchQueryId,
          position: query.position,
          query: query.query,
          creditsUsed: query.creditsUsed,
          status: query.status,
          selectionGeneration: getGeneration(query.selectionGenerationId),
          summaryGeneration: getGeneration(query.summaryGenerationId),
          errorStage: query.errorStage,
          errorMessage: query.errorMessage,
          completedAt: query.completedAt,
          results: (resultsByQueryId.get(query.deepSearchQueryId) ?? []).map(
            (result) => ({
              resultId: result.deepSearchResultId,
              position: result.position,
              title: result.title,
              shortText: result.shortText,
              url: result.url,
              selectedWebPageId: result.selectedWebPageId,
            }),
          ),
        }),
      ),
    })),
    pages: pages.map((page) => ({
      pageId: page.deepSearchWebPageId,
      url: page.url,
      creditsUsed: page.creditsUsed,
      status: page.status,
      extractedContent: page.extractedContent,
      summaryGeneration: getGeneration(page.summaryGenerationId),
      errorStage: page.errorStage,
      errorMessage: page.errorMessage,
      completedAt: page.completedAt,
    })),
  }
}

export function registerSearchRound(
  transaction: TextStreamPersistenceTransaction,
  input: {
    jobId: string
    position: number
    generationId: string
  },
): SearchRound {
  assertDeepSearchActive(transaction, input.jobId)
  assertGenerationOwnedByJob(transaction, input.jobId, input.generationId)
  const round = {
    roundId: randomUUID(),
    position: input.position,
    generationId: input.generationId,
  }
  transaction
    .insert(deepSearchRounds)
    .values({
      deepSearchRoundId: round.roundId,
      deepSearchJobId: input.jobId,
      position: input.position,
      llmGenerationId: input.generationId,
    })
    .run()
  return round
}

export function createSearchRound(input: {
  jobId: string
  position: number
  generationId: string
}): SearchRound {
  return db.transaction((transaction) => registerSearchRound(transaction, input))
}

type SavePlannedQueriesInput = {
  jobId: string
  roundId: string
  queries: string[]
}

export function savePlannedQueries(
  input: SavePlannedQueriesInput,
): PlannedQuery[]
export function savePlannedQueries(
  transaction: TextStreamPersistenceTransaction,
  input: SavePlannedQueriesInput,
): PlannedQuery[]
export function savePlannedQueries(
  transactionOrInput: TextStreamPersistenceTransaction | SavePlannedQueriesInput,
  transactionalInput?: SavePlannedQueriesInput,
): PlannedQuery[] {
  const input = transactionalInput ?? transactionOrInput as SavePlannedQueriesInput
  const plannedQueries = input.queries.map((query, position) => ({
    queryId: randomUUID(),
    position,
    query,
  }))
  const persist = (transaction: TextStreamPersistenceTransaction): void => {
    assertDeepSearchActive(transaction, input.jobId)
    assertRoundOwnedByJob(
      transaction,
      input.jobId,
      input.roundId,
    )
    if (plannedQueries.length > 0) {
      transaction
        .insert(deepSearchQueries)
        .values(
          plannedQueries.map((query) => ({
            deepSearchQueryId: query.queryId,
            deepSearchRoundId: input.roundId,
            position: query.position,
            query: query.query,
            status: "searching" as const,
          })),
        )
        .run()
    }
  }
  if (transactionalInput) {
    persist(transactionOrInput as TextStreamPersistenceTransaction)
  } else {
    db.transaction(persist)
  }
  return plannedQueries
}

function sameSearchResults(
  persisted: SearchResultRecord[],
  requested: SearchResultInput[],
): boolean {
  return persisted.length === requested.length && persisted.every(
    (result, position) => {
      const expected = requested[position]
      return expected !== undefined &&
        result.position === position &&
        result.title === expected.title &&
        result.shortText === expected.shortText &&
        result.url === expected.link
    },
  )
}

/** Settles one provider search independently and exactly once for app credits. */
export function settleWebSearchQuery(input: {
  userId?: string
  jobId: string
  roundId: string
  plannedQuery: PlannedQuery
  results: SearchResultInput[]
  creditsUsed?: number
}): SettledSearchQuery {
  const creditsUsed = input.creditsUsed ?? 0
  const proposedResults = input.results.map((result, position) => ({
      resultId: randomUUID(),
      position,
      title: result.title,
      shortText: result.shortText,
      url: result.link,
    })) satisfies SearchResultRecord[]

  return db.transaction((transaction) => {
    assertDeepSearchActive(transaction, input.jobId)
    assertRoundOwnedByJob(transaction, input.jobId, input.roundId)
    const owner = transaction
      .select({ userId: deepSearchJobs.userId })
      .from(deepSearchJobs)
      .where(eq(deepSearchJobs.deepSearchJobId, input.jobId))
      .get()
    if (!owner || (input.userId !== undefined && owner.userId !== input.userId)) {
      throw new Error("Search query must belong to the credit account owner")
    }
    const query = transaction
      .select()
      .from(deepSearchQueries)
      .where(eq(deepSearchQueries.deepSearchQueryId, input.plannedQuery.queryId))
      .get()
    if (
      !query ||
      query.deepSearchRoundId !== input.roundId ||
      query.position !== input.plannedQuery.position ||
      query.query !== input.plannedQuery.query
    ) {
      throw new Error("Search query was not persisted for this round")
    }

    const persistedResults = transaction
      .select()
      .from(deepSearchResults)
      .where(
        eq(
          deepSearchResults.deepSearchQueryId,
          input.plannedQuery.queryId,
        ),
      )
      .orderBy(
        asc(deepSearchResults.position),
        asc(deepSearchResults.deepSearchResultId),
      )
      .all()
      .map((result) => ({
        resultId: result.deepSearchResultId,
        position: result.position,
        title: result.title,
        shortText: result.shortText,
        url: result.url,
      }))
    if (query.creditsUsed !== null) {
      if (
        query.creditsUsed !== creditsUsed ||
        !sameSearchResults(persistedResults, input.results)
      ) {
        throw new Error("Search query results conflict with persisted settlement")
      }
      return {
        ...input.plannedQuery,
        creditsUsed: query.creditsUsed,
        results: persistedResults,
      }
    }

    const update = transaction
      .update(deepSearchQueries)
      .set({ status: "selecting", creditsUsed })
      .where(
        and(
          eq(deepSearchQueries.deepSearchQueryId, input.plannedQuery.queryId),
          eq(deepSearchQueries.status, "searching"),
          isNull(deepSearchQueries.creditsUsed),
        ),
      )
      .run()
    if (update.changes !== 1) {
      throw new Error("Search query was not ready for results")
    }
    if (proposedResults.length > 0) {
      transaction
        .insert(deepSearchResults)
        .values(
          proposedResults.map((result) => ({
            deepSearchResultId: result.resultId,
            deepSearchQueryId: input.plannedQuery.queryId,
            position: result.position,
            title: result.title,
            shortText: result.shortText,
            url: result.url,
          })),
        )
        .run()
    }
    debitCredits(transaction, owner.userId, creditsUsed)
    return {
      ...input.plannedQuery,
      creditsUsed,
      results: proposedResults,
    }
  })
}

export function saveSearchResults(input: {
  userId?: string
  jobId: string
  roundId: string
  searches: Array<{
    plannedQuery: PlannedQuery
    results: SearchResultInput[]
    creditsUsed?: number
  }>
}): ExecutedQuery[] {
  const queryIds = input.searches.map(({ plannedQuery }) => plannedQuery.queryId)
  if (new Set(queryIds).size !== queryIds.length) {
    throw new Error("Search results contain a duplicate generated query")
  }
  return input.searches.map((search) => settleWebSearchQuery({
    ...(input.userId === undefined ? {} : { userId: input.userId }),
    jobId: input.jobId,
    roundId: input.roundId,
    ...search,
  }))
}

export function registerSelectionGeneration(
  transaction: TextStreamPersistenceTransaction,
  input: { jobId: string; queryId: string; generationId: string },
): void {
  assertDeepSearchActive(transaction, input.jobId)
  assertGenerationOwnedByJob(transaction, input.jobId, input.generationId)
  assertQueryOwnedByJob(transaction, input.jobId, input.queryId)
  const stored = transaction
    .select({
      status: deepSearchQueries.status,
      generationId: deepSearchQueries.selectionGenerationId,
      errorStage: deepSearchQueries.errorStage,
    })
    .from(deepSearchQueries)
    .where(eq(deepSearchQueries.deepSearchQueryId, input.queryId))
    .get()
  if (stored?.status === "selecting" && stored.generationId === input.generationId) {
    return
  }
  if (
    stored?.status === "failed" &&
    stored.errorStage === "selection" &&
    stored.generationId === null
  ) {
    const retried = transaction
      .update(deepSearchQueries)
      .set({
        status: "selecting",
        selectionGenerationId: input.generationId,
        errorStage: null,
        errorMessage: null,
        completedAt: null,
      })
      .where(
        and(
          eq(deepSearchQueries.deepSearchQueryId, input.queryId),
          eq(deepSearchQueries.status, "failed"),
          eq(deepSearchQueries.errorStage, "selection"),
          isNull(deepSearchQueries.selectionGenerationId),
        ),
      )
      .run()
    if (retried.changes !== 1) {
      throw new Error("Search query selection could not be reset for retry")
    }
    return
  }
  const result = transaction
    .update(deepSearchQueries)
    .set({ selectionGenerationId: input.generationId })
    .where(
      and(
        eq(deepSearchQueries.deepSearchQueryId, input.queryId),
        eq(deepSearchQueries.status, "selecting"),
        isNull(deepSearchQueries.selectionGenerationId),
      ),
    )
    .run()
  if (result.changes !== 1) {
    throw new Error("Search query selection generation is already registered")
  }
}

export function attachSelectionGeneration(input: {
  jobId: string
  queryId: string
  generationId: string
}): void {
  db.transaction((transaction) => registerSelectionGeneration(transaction, input))
}

type SaveSelectedResultsInput = {
  jobId: string
  queryId: string
  selectionGenerationId: string
  selectedResultIds: string[]
}

export function saveSelectedResults(
  input: SaveSelectedResultsInput,
): SelectedPage[]
export function saveSelectedResults(
  transaction: TextStreamPersistenceTransaction,
  input: SaveSelectedResultsInput,
): SelectedPage[]
export function saveSelectedResults(
  transactionOrInput: TextStreamPersistenceTransaction | SaveSelectedResultsInput,
  transactionalInput?: SaveSelectedResultsInput,
): SelectedPage[] {
  const input = transactionalInput ?? transactionOrInput as SaveSelectedResultsInput
  const persist = (
    transaction: TextStreamPersistenceTransaction,
  ): SelectedPage[] => {
    assertDeepSearchActive(transaction, input.jobId)
    assertQueryOwnedByJob(
      transaction,
      input.jobId,
      input.queryId,
    )
    const selectionCommit = transaction
      .update(deepSearchQueries)
      .set({ status: "summarizing" })
      .where(
        and(
          eq(deepSearchQueries.deepSearchQueryId, input.queryId),
          eq(deepSearchQueries.status, "selecting"),
          eq(
            deepSearchQueries.selectionGenerationId,
            input.selectionGenerationId,
          ),
          isNull(deepSearchQueries.summaryGenerationId),
        ),
      )
      .run()
    if (selectionCommit.changes !== 1) {
      throw new Error("Search result selection was already committed")
    }
    const results = transaction
      .select()
      .from(deepSearchResults)
      .where(eq(deepSearchResults.deepSearchQueryId, input.queryId))
      .all()
    const resultIds = new Set(
      results.map(({ deepSearchResultId }) => deepSearchResultId),
    )
    const selectedIds = new Set(input.selectedResultIds)
    if (selectedIds.size !== input.selectedResultIds.length) {
      throw new Error("Selected search results contain a duplicate ID")
    }
    for (const deepSearchResultId of selectedIds) {
      if (!resultIds.has(deepSearchResultId)) {
        throw new Error("Selected search result was not persisted for this query")
      }
    }

    const selectedPages = new Map<
      string,
      SelectedPage
    >()
    const persistWebPage = (url: string): string => {
      transaction
        .insert(deepSearchWebPages)
        .values({
          deepSearchWebPageId: randomUUID(),
          deepSearchJobId: input.jobId,
          url,
          status: "extracting",
        })
        .onConflictDoNothing()
        .run()
      const webPage = transaction
        .select({
          deepSearchWebPageId: deepSearchWebPages.deepSearchWebPageId,
          url: deepSearchWebPages.url,
        })
        .from(deepSearchWebPages)
        .where(
          and(
            eq(deepSearchWebPages.deepSearchJobId, input.jobId),
            eq(deepSearchWebPages.url, url),
          ),
        )
        .get()
      if (!webPage) throw new Error(`Web page was not persisted: ${url}`)
      selectedPages.set(url, {
        pageId: webPage.deepSearchWebPageId,
        url: webPage.url,
      })
      return webPage.deepSearchWebPageId
    }

    for (const result of results) {
      const isSelected = selectedIds.has(result.deepSearchResultId)
      const selectedWebPageId = isSelected
        ? persistWebPage(result.url)
        : null
      const update = transaction
        .update(deepSearchResults)
        .set({
          selectedWebPageId,
        })
        .where(
          eq(deepSearchResults.deepSearchResultId, result.deepSearchResultId),
        )
        .run()
      if (update.changes !== 1) {
        throw new Error("Search result was not persisted")
      }
    }

    return [...selectedPages.values()]
  }
  return transactionalInput
    ? persist(transactionOrInput as TextStreamPersistenceTransaction)
    : db.transaction(persist)
}

/** Completes a provider search that returned no usable rows without model work. */
export function completeEmptySearchQuery(input: {
  jobId: string
  queryId: string
}): void {
  db.transaction((transaction) => {
    assertDeepSearchActive(transaction, input.jobId)
    assertQueryOwnedByJob(transaction, input.jobId, input.queryId)
    const persistedResult = transaction
      .select({ id: deepSearchResults.deepSearchResultId })
      .from(deepSearchResults)
      .where(eq(deepSearchResults.deepSearchQueryId, input.queryId))
      .get()
    if (persistedResult) {
      throw new Error("Empty search query has persisted results")
    }
    const result = transaction
      .update(deepSearchQueries)
      .set({ status: "completed", completedAt: new Date() })
      .where(
        and(
          eq(deepSearchQueries.deepSearchQueryId, input.queryId),
          eq(deepSearchQueries.status, "selecting"),
          isNull(deepSearchQueries.selectionGenerationId),
          isNull(deepSearchQueries.summaryGenerationId),
        ),
      )
      .run()
    if (result.changes !== 1) {
      throw new Error("Empty search query was already completed")
    }
  })
}

/** Resets only an unsettled provider-search failure for another attempt. */
export function resetWebSearchQuery(input: {
  jobId: string
  queryId: string
}): void {
  db.transaction((transaction) => {
    assertDeepSearchActive(transaction, input.jobId)
    assertQueryOwnedByJob(transaction, input.jobId, input.queryId)
    const query = transaction
      .select({
        status: deepSearchQueries.status,
        errorStage: deepSearchQueries.errorStage,
        creditsUsed: deepSearchQueries.creditsUsed,
      })
      .from(deepSearchQueries)
      .where(eq(deepSearchQueries.deepSearchQueryId, input.queryId))
      .get()
    if (query?.status === "searching") return
    if (
      query?.status !== "failed" ||
      query.errorStage !== "search" ||
      query.creditsUsed !== null
    ) {
      throw new Error("Search query is not retryable at the provider stage")
    }
    const result = transaction
      .update(deepSearchQueries)
      .set({
        status: "searching",
        errorStage: null,
        errorMessage: null,
        completedAt: null,
      })
      .where(
        and(
          eq(deepSearchQueries.deepSearchQueryId, input.queryId),
          eq(deepSearchQueries.status, "failed"),
          eq(deepSearchQueries.errorStage, "search"),
          isNull(deepSearchQueries.creditsUsed),
        ),
      )
      .run()
    if (result.changes !== 1) {
      throw new Error("Search query could not be reset for retry")
    }
  })
}

/** Resets only a page whose extraction attempt never settled successfully. */
export function resetPageExtraction(input: {
  jobId: string
  pageId: string
}): void {
  db.transaction((transaction) => {
    assertDeepSearchActive(transaction, input.jobId)
    assertPageOwnedByJob(transaction, input.jobId, input.pageId)
    const page = transaction
      .select({
        status: deepSearchWebPages.status,
        errorStage: deepSearchWebPages.errorStage,
        creditsUsed: deepSearchWebPages.creditsUsed,
      })
      .from(deepSearchWebPages)
      .where(eq(deepSearchWebPages.deepSearchWebPageId, input.pageId))
      .get()
    if (page?.status === "extracting") return
    if (
      page?.status !== "failed" ||
      page.errorStage !== "extraction" ||
      page.creditsUsed !== null
    ) {
      throw new Error("Web page is not retryable at the extraction stage")
    }
    const result = transaction
      .update(deepSearchWebPages)
      .set({
        status: "extracting",
        errorStage: null,
        errorMessage: null,
        completedAt: null,
      })
      .where(
        and(
          eq(deepSearchWebPages.deepSearchWebPageId, input.pageId),
          eq(deepSearchWebPages.status, "failed"),
          eq(deepSearchWebPages.errorStage, "extraction"),
          isNull(deepSearchWebPages.creditsUsed),
        ),
      )
      .run()
    if (result.changes !== 1) {
      throw new Error("Web page could not be reset for extraction retry")
    }
  })
}

export function attachPageSummaryGeneration(
  transaction: TextStreamPersistenceTransaction,
  input: {
    jobId: string
    pageId: string
    generationId: string
  },
): void {
  assertDeepSearchActive(transaction, input.jobId)
  assertGenerationOwnedByJob(
    transaction,
    input.jobId,
    input.generationId,
  )
  assertPageOwnedByJob(
    transaction,
    input.jobId,
    input.pageId,
  )
  const stored = transaction
    .select({
      status: deepSearchWebPages.status,
      generationId: deepSearchWebPages.summaryGenerationId,
      errorStage: deepSearchWebPages.errorStage,
    })
    .from(deepSearchWebPages)
    .where(eq(deepSearchWebPages.deepSearchWebPageId, input.pageId))
    .get()
  if (stored?.status === "summarizing" && stored.generationId === input.generationId) {
    return
  }
  if (
    stored?.status === "failed" &&
    stored.errorStage === "summary" &&
    stored.generationId === null
  ) {
    const retried = transaction
      .update(deepSearchWebPages)
      .set({
        status: "summarizing",
        summaryGenerationId: input.generationId,
        errorStage: null,
        errorMessage: null,
        completedAt: null,
      })
      .where(
        and(
          eq(deepSearchWebPages.deepSearchWebPageId, input.pageId),
          eq(deepSearchWebPages.status, "failed"),
          eq(deepSearchWebPages.errorStage, "summary"),
          isNull(deepSearchWebPages.summaryGenerationId),
        ),
      )
      .run()
    if (retried.changes !== 1) {
      throw new Error("Web page summary could not be reset for retry")
    }
    return
  }
  const result = transaction
    .update(deepSearchWebPages)
    .set({ summaryGenerationId: input.generationId })
    .where(
      and(
        eq(deepSearchWebPages.deepSearchWebPageId, input.pageId),
        eq(deepSearchWebPages.status, "summarizing"),
        isNull(deepSearchWebPages.summaryGenerationId),
      ),
    )
    .run()
  if (result.changes !== 1) {
    throw new Error("Web page summary generation is already registered")
  }
}

/** Stores bounded extraction output and settles its cost exactly once. */
export function settlePageExtraction(input: {
  userId: string
  jobId: string
  pageId: string
  content: string
  creditsUsed: number
}): { content: string | null; creditsUsed: number } {
  if (!input.content.trim()) {
    throw new Error("Web page extraction content must not be empty")
  }
  if (input.content.length > 100_000) {
    throw new Error("Web page extraction content exceeds the persisted limit")
  }
  return db.transaction((transaction) => {
    assertDeepSearchActive(transaction, input.jobId)
    assertPageOwnedByJob(transaction, input.jobId, input.pageId)
    const owner = transaction
      .select({ userId: deepSearchJobs.userId })
      .from(deepSearchJobs)
      .where(eq(deepSearchJobs.deepSearchJobId, input.jobId))
      .get()
    if (owner?.userId !== input.userId) {
      throw new Error("Web page must belong to the credit account owner")
    }
    const page = transaction
      .select({
        status: deepSearchWebPages.status,
        content: deepSearchWebPages.extractedContent,
        creditsUsed: deepSearchWebPages.creditsUsed,
      })
      .from(deepSearchWebPages)
      .where(eq(deepSearchWebPages.deepSearchWebPageId, input.pageId))
      .get()
    if (!page) throw new Error("Web page was not persisted")
    if (page.creditsUsed !== null) {
      if (
        page.creditsUsed !== input.creditsUsed ||
        (page.content !== null && page.content !== input.content)
      ) {
        throw new Error("Web page extraction conflicts with persisted settlement")
      }
      return { content: page.content, creditsUsed: page.creditsUsed }
    }
    const result = transaction
      .update(deepSearchWebPages)
      .set({
        status: "summarizing",
        extractedContent: input.content,
        creditsUsed: input.creditsUsed,
      })
      .where(
        and(
          eq(deepSearchWebPages.deepSearchWebPageId, input.pageId),
          eq(deepSearchWebPages.status, "extracting"),
          isNull(deepSearchWebPages.creditsUsed),
        ),
      )
      .run()
    if (result.changes !== 1) {
      throw new Error("Web page was not ready for extraction settlement")
    }
    debitCredits(transaction, input.userId, input.creditsUsed)
    return { content: input.content, creditsUsed: input.creditsUsed }
  })
}

export function completePageSummaryGeneration(
  transaction: TextStreamPersistenceTransaction,
  input: {
    jobId: string
    pageId: string
    generationId: string
  },
): void {
  assertDeepSearchActive(transaction, input.jobId)
  assertPageOwnedByJob(transaction, input.jobId, input.pageId)
  const stored = transaction
    .select({
      status: deepSearchWebPages.status,
      generationId: deepSearchWebPages.summaryGenerationId,
    })
    .from(deepSearchWebPages)
    .where(eq(deepSearchWebPages.deepSearchWebPageId, input.pageId))
    .get()
  if (stored?.status === "completed" && stored.generationId === input.generationId) {
    return
  }
  const result = transaction
    .update(deepSearchWebPages)
    .set({
      status: "completed",
      extractedContent: null,
      errorStage: null,
      errorMessage: null,
      completedAt: new Date(),
    })
    .where(
      and(
        eq(deepSearchWebPages.deepSearchWebPageId, input.pageId),
        eq(deepSearchWebPages.status, "summarizing"),
        eq(deepSearchWebPages.summaryGenerationId, input.generationId),
      ),
    )
    .run()
  if (result.changes !== 1) {
    throw new Error("Page summary generation was not registered")
  }
}

export function failPageSummaryGeneration(
  transaction: TextStreamPersistenceTransaction,
  input: {
    jobId: string
    pageId: string
    generationId: string
    message: string
  },
): void {
  assertDeepSearchActive(transaction, input.jobId)
  assertPageOwnedByJob(transaction, input.jobId, input.pageId)
  const stored = transaction
    .select({
      status: deepSearchWebPages.status,
      generationId: deepSearchWebPages.summaryGenerationId,
      errorStage: deepSearchWebPages.errorStage,
      errorMessage: deepSearchWebPages.errorMessage,
    })
    .from(deepSearchWebPages)
    .where(eq(deepSearchWebPages.deepSearchWebPageId, input.pageId))
    .get()
  if (
    stored?.status === "failed" &&
    stored.generationId === input.generationId &&
    stored.errorStage === "summary" &&
    stored.errorMessage === input.message
  ) {
    return
  }
  const result = transaction
    .update(deepSearchWebPages)
    .set({
      status: "failed",
      errorStage: "summary",
      errorMessage: input.message,
      completedAt: new Date(),
    })
    .where(
      and(
        eq(deepSearchWebPages.deepSearchWebPageId, input.pageId),
        eq(deepSearchWebPages.status, "summarizing"),
        eq(deepSearchWebPages.summaryGenerationId, input.generationId),
      ),
    )
    .run()
  if (result.changes !== 1) {
    throw new Error("Page summary generation was not registered")
  }
}

/** Cancellation cleanup runs after the effective root has become inactive. */
export function interruptPageSummaryGeneration(
  transaction: TextStreamPersistenceTransaction,
  input: {
    jobId: string
    pageId: string
    generationId: string
    message: string
  },
): void {
  assertPageOwnedByJob(transaction, input.jobId, input.pageId)
  const stored = transaction
    .select({
      status: deepSearchWebPages.status,
      generationId: deepSearchWebPages.summaryGenerationId,
      errorStage: deepSearchWebPages.errorStage,
      errorMessage: deepSearchWebPages.errorMessage,
    })
    .from(deepSearchWebPages)
    .where(eq(deepSearchWebPages.deepSearchWebPageId, input.pageId))
    .get()
  if (
    stored?.status === "failed" &&
    stored.generationId === input.generationId &&
    stored.errorStage === "summary" &&
    stored.errorMessage === input.message
  ) {
    return
  }
  const result = transaction
    .update(deepSearchWebPages)
    .set({
      status: "failed",
      errorStage: "summary",
      errorMessage: input.message,
      completedAt: new Date(),
    })
    .where(
      and(
        eq(deepSearchWebPages.deepSearchWebPageId, input.pageId),
        eq(deepSearchWebPages.status, "summarizing"),
        eq(deepSearchWebPages.summaryGenerationId, input.generationId),
      ),
    )
    .run()
  if (result.changes !== 1) {
    throw new Error("Page summary generation was not registered")
  }
}

export function savePageFailure(input: {
  jobId: string
  pageId: string
  stage: "extraction" | "summary"
  message: string
}): void {
  db.transaction((transaction) => {
    assertDeepSearchActive(transaction, input.jobId)
    assertPageOwnedByJob(
      transaction,
      input.jobId,
      input.pageId,
    )
    const stored = transaction
      .select({
        status: deepSearchWebPages.status,
        errorStage: deepSearchWebPages.errorStage,
        errorMessage: deepSearchWebPages.errorMessage,
      })
      .from(deepSearchWebPages)
      .where(eq(deepSearchWebPages.deepSearchWebPageId, input.pageId))
      .get()
    if (
      stored?.status === "failed" &&
      stored.errorStage === input.stage &&
      stored.errorMessage === input.message
    ) {
      return
    }
    const result = transaction
      .update(deepSearchWebPages)
      .set({
        status: "failed",
        errorStage: input.stage,
        errorMessage: input.message,
        completedAt: new Date(),
      })
      .where(
        and(
          eq(deepSearchWebPages.deepSearchWebPageId, input.pageId),
          eq(
            deepSearchWebPages.status,
            input.stage === "extraction" ? "extracting" : "summarizing",
          ),
        ),
      )
      .run()
    if (result.changes !== 1) throw new Error("Web page was not persisted")
  })
}

export function attachQuerySummaryGeneration(
  transaction: TextStreamPersistenceTransaction,
  input: {
    jobId: string
    queryId: string
    generationId: string
  },
): void {
  assertDeepSearchActive(transaction, input.jobId)
  assertGenerationOwnedByJob(
    transaction,
    input.jobId,
    input.generationId,
  )
  assertQueryOwnedByJob(
    transaction,
    input.jobId,
    input.queryId,
  )
  const stored = transaction
    .select({
      status: deepSearchQueries.status,
      generationId: deepSearchQueries.summaryGenerationId,
      errorStage: deepSearchQueries.errorStage,
    })
    .from(deepSearchQueries)
    .where(eq(deepSearchQueries.deepSearchQueryId, input.queryId))
    .get()
  if (stored?.status === "summarizing" && stored.generationId === input.generationId) {
    return
  }
  if (
    stored?.status === "failed" &&
    stored.errorStage === "summary" &&
    stored.generationId === null
  ) {
    const retried = transaction
      .update(deepSearchQueries)
      .set({
        status: "summarizing",
        summaryGenerationId: input.generationId,
        errorStage: null,
        errorMessage: null,
        completedAt: null,
      })
      .where(
        and(
          eq(deepSearchQueries.deepSearchQueryId, input.queryId),
          eq(deepSearchQueries.status, "failed"),
          eq(deepSearchQueries.errorStage, "summary"),
          isNull(deepSearchQueries.summaryGenerationId),
        ),
      )
      .run()
    if (retried.changes !== 1) {
      throw new Error("Query summary could not be reset for retry")
    }
    return
  }
  const result = transaction
    .update(deepSearchQueries)
    .set({ summaryGenerationId: input.generationId })
    .where(
      and(
        eq(deepSearchQueries.deepSearchQueryId, input.queryId),
        eq(deepSearchQueries.status, "summarizing"),
        isNull(deepSearchQueries.summaryGenerationId),
      ),
    )
    .run()
  if (result.changes !== 1) {
    throw new Error("Query summary generation is already registered")
  }
}

export function completeQuerySummaryGeneration(
  transaction: TextStreamPersistenceTransaction,
  input: {
    jobId: string
    queryId: string
    generationId: string
  },
): void {
  assertDeepSearchActive(transaction, input.jobId)
  assertQueryOwnedByJob(transaction, input.jobId, input.queryId)
  const stored = transaction
    .select({
      status: deepSearchQueries.status,
      generationId: deepSearchQueries.summaryGenerationId,
    })
    .from(deepSearchQueries)
    .where(eq(deepSearchQueries.deepSearchQueryId, input.queryId))
    .get()
  if (stored?.status === "completed" && stored.generationId === input.generationId) {
    return
  }
  const result = transaction
    .update(deepSearchQueries)
    .set({
      status: "completed",
      errorStage: null,
      errorMessage: null,
      completedAt: new Date(),
    })
    .where(
      and(
        eq(deepSearchQueries.deepSearchQueryId, input.queryId),
        eq(deepSearchQueries.status, "summarizing"),
        eq(deepSearchQueries.summaryGenerationId, input.generationId),
      ),
    )
    .run()
  if (result.changes !== 1) {
    throw new Error("Query summary generation was not registered")
  }
}

export function failQuerySummaryGeneration(
  transaction: TextStreamPersistenceTransaction,
  input: {
    jobId: string
    queryId: string
    generationId: string
    message: string
  },
): void {
  assertDeepSearchActive(transaction, input.jobId)
  assertQueryOwnedByJob(transaction, input.jobId, input.queryId)
  const stored = transaction
    .select({
      status: deepSearchQueries.status,
      generationId: deepSearchQueries.summaryGenerationId,
      errorStage: deepSearchQueries.errorStage,
      errorMessage: deepSearchQueries.errorMessage,
    })
    .from(deepSearchQueries)
    .where(eq(deepSearchQueries.deepSearchQueryId, input.queryId))
    .get()
  if (
    stored?.status === "failed" &&
    stored.generationId === input.generationId &&
    stored.errorStage === "summary" &&
    stored.errorMessage === input.message
  ) {
    return
  }
  const result = transaction
    .update(deepSearchQueries)
    .set({
      status: "failed",
      errorStage: "summary",
      errorMessage: input.message,
      completedAt: new Date(),
    })
    .where(
      and(
        eq(deepSearchQueries.deepSearchQueryId, input.queryId),
        eq(deepSearchQueries.status, "summarizing"),
        eq(deepSearchQueries.summaryGenerationId, input.generationId),
      ),
    )
    .run()
  if (result.changes !== 1) {
    throw new Error("Query summary generation was not registered")
  }
}

/** Cancellation cleanup runs after the effective root has become inactive. */
export function interruptQuerySummaryGeneration(
  transaction: TextStreamPersistenceTransaction,
  input: {
    jobId: string
    queryId: string
    generationId: string
    message: string
  },
): void {
  assertQueryOwnedByJob(transaction, input.jobId, input.queryId)
  const stored = transaction
    .select({
      status: deepSearchQueries.status,
      generationId: deepSearchQueries.summaryGenerationId,
      errorStage: deepSearchQueries.errorStage,
      errorMessage: deepSearchQueries.errorMessage,
    })
    .from(deepSearchQueries)
    .where(eq(deepSearchQueries.deepSearchQueryId, input.queryId))
    .get()
  if (
    stored?.status === "failed" &&
    stored.generationId === input.generationId &&
    stored.errorStage === "summary" &&
    stored.errorMessage === input.message
  ) {
    return
  }
  const result = transaction
    .update(deepSearchQueries)
    .set({
      status: "failed",
      errorStage: "summary",
      errorMessage: input.message,
      completedAt: new Date(),
    })
    .where(
      and(
        eq(deepSearchQueries.deepSearchQueryId, input.queryId),
        eq(deepSearchQueries.status, "summarizing"),
        eq(deepSearchQueries.summaryGenerationId, input.generationId),
      ),
    )
    .run()
  if (result.changes !== 1) {
    throw new Error("Query summary generation was not registered")
  }
}

type ReplaceGenerationAttemptInput = {
  jobId: string
  oldGenerationId: string
  newGenerationId: string
  /** Required only when startup reconciliation is replacing stale running work. */
  staleRunningMessage?: string
}

function prepareGenerationAttemptReplacement(
  transaction: TextStreamPersistenceTransaction,
  input: ReplaceGenerationAttemptInput,
): void {
  assertDeepSearchActive(transaction, input.jobId)
  if (input.oldGenerationId === input.newGenerationId) {
    throw new Error("Replacement generation must be a new attempt")
  }
  const attempts = transaction
    .select({
      generationId: llmGenerations.llmGenerationId,
      deepSearchJobId: llmGenerations.deepSearchJobId,
      status: llmGenerations.status,
    })
    .from(llmGenerations)
    .where(
      inArray(llmGenerations.llmGenerationId, [
        input.oldGenerationId,
        input.newGenerationId,
      ]),
    )
    .all()
  const attemptsById = new Map(
    attempts.map((attempt) => [attempt.generationId, attempt]),
  )
  const oldAttempt = attemptsById.get(input.oldGenerationId)
  const newAttempt = attemptsById.get(input.newGenerationId)
  if (oldAttempt?.deepSearchJobId !== input.jobId) {
    throw new Error("Old LLM generation must belong to the deep-search job")
  }
  if (
    newAttempt?.deepSearchJobId !== input.jobId ||
    newAttempt.status !== "running"
  ) {
    throw new Error("New LLM generation must be a running owned attempt")
  }
  if (oldAttempt.status === "completed") {
    throw new Error("Completed LLM generation cannot be replaced")
  }
  if (oldAttempt.status === "running") {
    if (!input.staleRunningMessage?.trim()) {
      throw new Error("Running LLM generation was not marked stale")
    }
    const interrupted = transaction
      .update(llmGenerations)
      .set({
        status: "interrupted",
        error: input.staleRunningMessage,
        completedAt: new Date(),
      })
      .where(
        and(
          eq(llmGenerations.llmGenerationId, input.oldGenerationId),
          eq(llmGenerations.status, "running"),
        ),
      )
      .run()
    if (interrupted.changes !== 1) {
      throw new Error("Stale LLM generation could not be interrupted")
    }
  }
}

function assertGenerationLink(
  actualGenerationId: string | null | undefined,
  expectedGenerationId: string,
  stage: string,
): void {
  if (actualGenerationId !== expectedGenerationId) {
    throw new Error(`${stage} no longer references the old generation attempt`)
  }
}

function assertGenerationLinkReplaced(
  result: { changes: number },
  stage: string,
): void {
  if (result.changes !== 1) {
    throw new Error(`${stage} generation attempt was not replaced`)
  }
}

export function replaceRoundPlanningGeneration(
  transaction: TextStreamPersistenceTransaction,
  input: ReplaceGenerationAttemptInput & { roundId: string },
): void {
  const round = transaction
    .select({
      jobId: deepSearchRounds.deepSearchJobId,
      generationId: deepSearchRounds.llmGenerationId,
    })
    .from(deepSearchRounds)
    .where(eq(deepSearchRounds.deepSearchRoundId, input.roundId))
    .get()
  if (round?.jobId !== input.jobId) {
    throw new Error("Deep-search round must belong to the deep-search job")
  }
  assertGenerationLink(round.generationId, input.oldGenerationId, "Round planning")
  prepareGenerationAttemptReplacement(transaction, input)
  const result = transaction
    .update(deepSearchRounds)
    .set({ llmGenerationId: input.newGenerationId })
    .where(
      and(
        eq(deepSearchRounds.deepSearchRoundId, input.roundId),
        eq(deepSearchRounds.deepSearchJobId, input.jobId),
        eq(deepSearchRounds.llmGenerationId, input.oldGenerationId),
      ),
    )
    .run()
  assertGenerationLinkReplaced(result, "Round planning")
}

export function replaceRoundAnswerGeneration(
  transaction: TextStreamPersistenceTransaction,
  input: ReplaceGenerationAttemptInput & { roundId: string },
): void {
  const round = transaction
    .select({
      jobId: deepSearchRounds.deepSearchJobId,
      generationId: deepSearchRounds.answerGenerationId,
    })
    .from(deepSearchRounds)
    .where(eq(deepSearchRounds.deepSearchRoundId, input.roundId))
    .get()
  if (round?.jobId !== input.jobId) {
    throw new Error("Deep-search round must belong to the deep-search job")
  }
  assertGenerationLink(round.generationId, input.oldGenerationId, "Round answer")
  prepareGenerationAttemptReplacement(transaction, input)
  const result = transaction
    .update(deepSearchRounds)
    .set({ answerGenerationId: input.newGenerationId })
    .where(
      and(
        eq(deepSearchRounds.deepSearchRoundId, input.roundId),
        eq(deepSearchRounds.deepSearchJobId, input.jobId),
        eq(deepSearchRounds.answerGenerationId, input.oldGenerationId),
      ),
    )
    .run()
  assertGenerationLinkReplaced(result, "Round answer")
}

export function replaceRoundReviewGeneration(
  transaction: TextStreamPersistenceTransaction,
  input: ReplaceGenerationAttemptInput & { roundId: string },
): void {
  const round = transaction
    .select({
      jobId: deepSearchRounds.deepSearchJobId,
      generationId: deepSearchRounds.reviewGenerationId,
    })
    .from(deepSearchRounds)
    .where(eq(deepSearchRounds.deepSearchRoundId, input.roundId))
    .get()
  if (round?.jobId !== input.jobId) {
    throw new Error("Deep-search round must belong to the deep-search job")
  }
  assertGenerationLink(round.generationId, input.oldGenerationId, "Round review")
  prepareGenerationAttemptReplacement(transaction, input)
  const result = transaction
    .update(deepSearchRounds)
    .set({
      reviewGenerationId: input.newGenerationId,
      reviewDecision: null,
      reviewReason: null,
      reviewError: null,
      reviewCompletedAt: null,
    })
    .where(
      and(
        eq(deepSearchRounds.deepSearchRoundId, input.roundId),
        eq(deepSearchRounds.deepSearchJobId, input.jobId),
        eq(deepSearchRounds.reviewGenerationId, input.oldGenerationId),
      ),
    )
    .run()
  assertGenerationLinkReplaced(result, "Round review")
}

export function replaceQuerySelectionGeneration(
  transaction: TextStreamPersistenceTransaction,
  input: ReplaceGenerationAttemptInput & { queryId: string },
): void {
  assertQueryOwnedByJob(transaction, input.jobId, input.queryId)
  const query = transaction
    .select({ generationId: deepSearchQueries.selectionGenerationId })
    .from(deepSearchQueries)
    .where(eq(deepSearchQueries.deepSearchQueryId, input.queryId))
    .get()
  assertGenerationLink(query?.generationId, input.oldGenerationId, "Query selection")
  prepareGenerationAttemptReplacement(transaction, input)
  const result = transaction
    .update(deepSearchQueries)
    .set({
      selectionGenerationId: input.newGenerationId,
      status: "selecting",
      errorStage: null,
      errorMessage: null,
      completedAt: null,
    })
    .where(
      and(
        eq(deepSearchQueries.deepSearchQueryId, input.queryId),
        eq(deepSearchQueries.selectionGenerationId, input.oldGenerationId),
      ),
    )
    .run()
  assertGenerationLinkReplaced(result, "Query selection")
}

export function replaceQuerySummaryGeneration(
  transaction: TextStreamPersistenceTransaction,
  input: ReplaceGenerationAttemptInput & { queryId: string },
): void {
  assertQueryOwnedByJob(transaction, input.jobId, input.queryId)
  const query = transaction
    .select({ generationId: deepSearchQueries.summaryGenerationId })
    .from(deepSearchQueries)
    .where(eq(deepSearchQueries.deepSearchQueryId, input.queryId))
    .get()
  assertGenerationLink(query?.generationId, input.oldGenerationId, "Query summary")
  prepareGenerationAttemptReplacement(transaction, input)
  const result = transaction
    .update(deepSearchQueries)
    .set({
      summaryGenerationId: input.newGenerationId,
      status: "summarizing",
      errorStage: null,
      errorMessage: null,
      completedAt: null,
    })
    .where(
      and(
        eq(deepSearchQueries.deepSearchQueryId, input.queryId),
        eq(deepSearchQueries.summaryGenerationId, input.oldGenerationId),
      ),
    )
    .run()
  assertGenerationLinkReplaced(result, "Query summary")
}

export function replacePageSummaryGeneration(
  transaction: TextStreamPersistenceTransaction,
  input: ReplaceGenerationAttemptInput & { pageId: string },
): void {
  assertPageOwnedByJob(transaction, input.jobId, input.pageId)
  const page = transaction
    .select({ generationId: deepSearchWebPages.summaryGenerationId })
    .from(deepSearchWebPages)
    .where(eq(deepSearchWebPages.deepSearchWebPageId, input.pageId))
    .get()
  assertGenerationLink(page?.generationId, input.oldGenerationId, "Page summary")
  prepareGenerationAttemptReplacement(transaction, input)
  const result = transaction
    .update(deepSearchWebPages)
    .set({
      summaryGenerationId: input.newGenerationId,
      status: "summarizing",
      errorStage: null,
      errorMessage: null,
      completedAt: null,
    })
    .where(
      and(
        eq(deepSearchWebPages.deepSearchWebPageId, input.pageId),
        eq(deepSearchWebPages.summaryGenerationId, input.oldGenerationId),
      ),
    )
    .run()
  assertGenerationLinkReplaced(result, "Page summary")
}

export function replaceResearchAnalysisGeneration(
  transaction: TextStreamPersistenceTransaction,
  input: ReplaceGenerationAttemptInput,
): void {
  const job = transaction
    .select({ generationId: deepSearchJobs.researchAnalysisGenerationId })
    .from(deepSearchJobs)
    .where(eq(deepSearchJobs.deepSearchJobId, input.jobId))
    .get()
  assertGenerationLink(job?.generationId, input.oldGenerationId, "Research analysis")
  prepareGenerationAttemptReplacement(transaction, input)
  const result = transaction
    .update(deepSearchJobs)
    .set({ researchAnalysisGenerationId: input.newGenerationId })
    .where(
      and(
        eq(deepSearchJobs.deepSearchJobId, input.jobId),
        eq(
          deepSearchJobs.researchAnalysisGenerationId,
          input.oldGenerationId,
        ),
      ),
    )
    .run()
  assertGenerationLinkReplaced(result, "Research analysis")
}

export function attachRoundReviewGeneration(
  transaction: TextStreamPersistenceTransaction,
  input: {
    jobId: string
    roundId: string
    generationId: string
  },
): void {
  assertDeepSearchActive(transaction, input.jobId)
  assertGenerationOwnedByJob(
    transaction,
    input.jobId,
    input.generationId,
  )
  assertRoundOwnedByJob(
    transaction,
    input.jobId,
    input.roundId,
  )
  const storedRound = transaction
    .select({
      reviewGenerationId:
        deepSearchRounds.reviewGenerationId,
    })
    .from(deepSearchRounds)
    .where(eq(deepSearchRounds.deepSearchRoundId, input.roundId))
    .get()
  if (!storedRound) throw new Error("Deep-search round was not persisted")
  if (
    storedRound.reviewGenerationId !== null &&
    storedRound.reviewGenerationId !== input.generationId
  ) {
    throw new Error("Deep-search round review is already registered")
  }
  if (storedRound.reviewGenerationId === input.generationId) return
  const result = transaction
    .update(deepSearchRounds)
    .set({
      reviewGenerationId: input.generationId,
      reviewDecision: null,
      reviewReason: null,
      reviewError: null,
      reviewCompletedAt: null,
    })
    .where(
      and(
        eq(deepSearchRounds.deepSearchRoundId, input.roundId),
        isNull(deepSearchRounds.reviewGenerationId),
        isNull(deepSearchRounds.reviewCompletedAt),
      ),
    )
    .run()
  if (result.changes !== 1) throw new Error("Deep-search round was not persisted")
}

export function attachRoundAnswerGeneration(
  transaction: TextStreamPersistenceTransaction,
  input: {
    jobId: string
    roundId: string
    generationId: string
  },
): void {
  assertDeepSearchActive(transaction, input.jobId)
  assertGenerationOwnedByJob(
    transaction,
    input.jobId,
    input.generationId,
  )
  assertRoundOwnedByJob(
    transaction,
    input.jobId,
    input.roundId,
  )
  const storedRound = transaction
    .select({ answerGenerationId: deepSearchRounds.answerGenerationId })
    .from(deepSearchRounds)
    .where(eq(deepSearchRounds.deepSearchRoundId, input.roundId))
    .get()
  if (!storedRound) throw new Error("Deep-search round was not persisted")
  if (
    storedRound.answerGenerationId !== null &&
    storedRound.answerGenerationId !== input.generationId
  ) {
    throw new Error("Deep-search round answer is already registered")
  }
  if (storedRound.answerGenerationId === input.generationId) return
  const result = transaction
    .update(deepSearchRounds)
    .set({ answerGenerationId: input.generationId })
    .where(
      and(
        eq(deepSearchRounds.deepSearchRoundId, input.roundId),
        isNull(deepSearchRounds.answerGenerationId),
      ),
    )
    .run()
  if (result.changes !== 1) throw new Error("Deep-search round was not persisted")
}

export function saveRoundReviewCompletion(
  transaction: TextStreamPersistenceTransaction,
  input: {
    jobId: string
    roundId: string
    generationId: string
    review: RoundReview
  },
): void {
  assertDeepSearchActive(transaction, input.jobId)
  assertRoundOwnedByJob(
    transaction,
    input.jobId,
    input.roundId,
  )
  const stored = transaction
    .select({
      generationId: deepSearchRounds.reviewGenerationId,
      decision: deepSearchRounds.reviewDecision,
      reason: deepSearchRounds.reviewReason,
      error: deepSearchRounds.reviewError,
      completedAt: deepSearchRounds.reviewCompletedAt,
    })
    .from(deepSearchRounds)
    .where(eq(deepSearchRounds.deepSearchRoundId, input.roundId))
    .get()
  if (
    stored?.generationId === input.generationId &&
    stored.decision === input.review.decision &&
    stored.reason === input.review.reason &&
    stored.error === null &&
    stored.completedAt !== null
  ) {
    return
  }
  const result = transaction
    .update(deepSearchRounds)
    .set({
      reviewDecision: input.review.decision,
      reviewReason: input.review.reason,
      reviewCompletedAt: new Date(),
    })
    .where(
      and(
        eq(
          deepSearchRounds.deepSearchRoundId,
          input.roundId,
        ),
        eq(
          deepSearchRounds.reviewGenerationId,
          input.generationId,
        ),
        isNull(deepSearchRounds.reviewCompletedAt),
      ),
    )
    .run()
  if (result.changes !== 1) {
    throw new Error("Deep-search round review was not registered")
  }
}

/** Records an interrupted review without requiring an active root. */
export function interruptRoundReviewGeneration(
  transaction: TextStreamPersistenceTransaction,
  input: {
    jobId: string
    roundId: string
    generationId: string
    message: string
  },
): void {
  assertRoundOwnedByJob(transaction, input.jobId, input.roundId)
  const stored = transaction
    .select({
      generationId: deepSearchRounds.reviewGenerationId,
      decision: deepSearchRounds.reviewDecision,
      reason: deepSearchRounds.reviewReason,
      error: deepSearchRounds.reviewError,
      completedAt: deepSearchRounds.reviewCompletedAt,
    })
    .from(deepSearchRounds)
    .where(eq(deepSearchRounds.deepSearchRoundId, input.roundId))
    .get()
  if (
    stored?.generationId === input.generationId &&
    stored.decision === null &&
    stored.reason === null &&
    stored.error === input.message &&
    stored.completedAt !== null
  ) {
    return
  }
  const result = transaction
    .update(deepSearchRounds)
    .set({
      reviewDecision: null,
      reviewReason: null,
      reviewError: input.message,
      reviewCompletedAt: new Date(),
    })
    .where(
      and(
        eq(deepSearchRounds.deepSearchRoundId, input.roundId),
        eq(deepSearchRounds.reviewGenerationId, input.generationId),
        isNull(deepSearchRounds.reviewCompletedAt),
      ),
    )
    .run()
  if (result.changes !== 1) {
    throw new Error("Deep-search round review was not registered")
  }
}

export function saveRoundReviewFailure(input: {
  jobId: string
  roundId: string
  generationId: string
  message: string
}): void {
  db.transaction((transaction) => {
    assertDeepSearchActive(transaction, input.jobId)
    const stored = transaction
      .select({
        generationId: deepSearchRounds.reviewGenerationId,
        error: deepSearchRounds.reviewError,
        completedAt: deepSearchRounds.reviewCompletedAt,
      })
      .from(deepSearchRounds)
      .where(eq(deepSearchRounds.deepSearchRoundId, input.roundId))
      .get()
    if (
      stored?.generationId === input.generationId &&
      stored.error === input.message &&
      stored.completedAt !== null
    ) {
      return
    }
    const result = transaction
      .update(deepSearchRounds)
      .set({
        reviewDecision: null,
        reviewReason: null,
        reviewError: input.message,
        reviewCompletedAt: new Date(),
      })
      .where(
        and(
          eq(deepSearchRounds.deepSearchRoundId, input.roundId),
          eq(deepSearchRounds.deepSearchJobId, input.jobId),
          eq(deepSearchRounds.reviewGenerationId, input.generationId),
          isNull(deepSearchRounds.reviewCompletedAt),
        ),
      )
      .run()
    if (result.changes !== 1) {
      throw new Error("Deep-search round was not persisted")
    }
  })
}

export function attachFinalAnswerGeneration(
  transaction: TextStreamPersistenceTransaction,
  input: {
    jobId: string
    generationId: string
  },
): void {
  assertDeepSearchActive(transaction, input.jobId)
  assertGenerationOwnedByJob(
    transaction,
    input.jobId,
    input.generationId,
  )
  const job = transaction
    .select({ generationId: deepSearchJobs.finalAnswerGenerationId })
    .from(deepSearchJobs)
    .where(eq(deepSearchJobs.deepSearchJobId, input.jobId))
    .get()
  if (job?.generationId === input.generationId) return
  const result = transaction
    .update(deepSearchJobs)
    .set({ finalAnswerGenerationId: input.generationId })
    .where(
      and(
        eq(deepSearchJobs.deepSearchJobId, input.jobId),
        isNull(deepSearchJobs.finalAnswerGenerationId),
      ),
    )
    .run()
  if (result.changes !== 1) {
    throw new Error("Deep-search job was not persisted")
  }
}

export function attachResearchAnalysisGeneration(
  transaction: TextStreamPersistenceTransaction,
  input: {
    jobId: string
    generationId: string
  },
): void {
  assertDeepSearchActive(transaction, input.jobId)
  assertGenerationOwnedByJob(
    transaction,
    input.jobId,
    input.generationId,
  )
  const storedJob = transaction
    .select({
      generationId: deepSearchJobs.researchAnalysisGenerationId,
    })
    .from(deepSearchJobs)
    .where(eq(deepSearchJobs.deepSearchJobId, input.jobId))
    .get()
  if (!storedJob) throw new Error("Deep-search job was not persisted")
  if (
    storedJob.generationId !== null &&
    storedJob.generationId !== input.generationId
  ) {
    throw new Error("Deep-search research analysis is already registered")
  }
  if (storedJob.generationId === input.generationId) return
  const result = transaction
    .update(deepSearchJobs)
    .set({ researchAnalysisGenerationId: input.generationId })
    .where(
      and(
        eq(deepSearchJobs.deepSearchJobId, input.jobId),
        isNull(deepSearchJobs.researchAnalysisGenerationId),
      ),
    )
    .run()
  if (result.changes !== 1) {
    throw new Error("Deep-search job was not persisted")
  }
}
