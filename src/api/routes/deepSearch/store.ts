import { randomUUID } from "node:crypto"
import { and, eq, isNull } from "drizzle-orm"
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
import type {
  ExecutedQuery,
  PlannedQuery,
  SearchResultRecord,
  SearchRound,
  SelectedPage,
} from "./records.ts"

type SearchResultInput = DeepSearchSearch["results"][number]

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

export function createSearchRound(input: {
  jobId: string
  position: number
  generationId: string
}): SearchRound {
  const roundId = randomUUID()
  db.transaction((transaction) => {
    assertGenerationOwnedByJob(
      transaction,
      input.jobId,
      input.generationId,
    )
    transaction
      .insert(deepSearchRounds)
      .values({
        deepSearchRoundId: roundId,
        deepSearchJobId: input.jobId,
        position: input.position,
        llmGenerationId: input.generationId,
      })
      .run()
  })
  return {
    roundId,
    position: input.position,
    generationId: input.generationId,
  }
}

export function savePlannedQueries(input: {
  jobId: string
  roundId: string
  queries: string[]
}): PlannedQuery[] {
  const plannedQueries = input.queries.map((query, position) => ({
    queryId: randomUUID(),
    position,
    query,
  }))
  db.transaction((transaction) => {
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
  })
  return plannedQueries
}

export function saveSearchResults(input: {
  jobId: string
  roundId: string
  searches: Array<{
    plannedQuery: PlannedQuery
    results: SearchResultInput[]
  }>
}): ExecutedQuery[] {
  const storedSearches = input.searches.map((search) => ({
    ...search.plannedQuery,
    results: search.results.map((result, position) => ({
      resultId: randomUUID(),
      position,
      title: result.title,
      shortText: result.shortText,
      url: result.link,
    })) satisfies SearchResultRecord[],
  }))

  db.transaction((transaction) => {
    assertRoundOwnedByJob(
      transaction,
      input.jobId,
      input.roundId,
    )
    const plannedIds = new Set(
      transaction
        .select({ deepSearchQueryId: deepSearchQueries.deepSearchQueryId })
        .from(deepSearchQueries)
        .where(eq(deepSearchQueries.deepSearchRoundId, input.roundId))
        .all()
        .map(({ deepSearchQueryId }) => deepSearchQueryId),
    )
    const requestedIds = new Set(
      storedSearches.map(({ queryId }) => queryId),
    )
    if (requestedIds.size !== storedSearches.length) {
      throw new Error("Search results contain a duplicate generated query")
    }
    for (const deepSearchQueryId of requestedIds) {
      if (!plannedIds.has(deepSearchQueryId)) {
        throw new Error("Search query was not persisted for this round")
      }
    }

    for (const search of storedSearches) {
      const update = transaction
        .update(deepSearchQueries)
        .set({ status: "selecting" })
        .where(
          and(
            eq(deepSearchQueries.deepSearchQueryId, search.queryId),
            eq(deepSearchQueries.status, "searching"),
          ),
        )
        .run()
      if (update.changes !== 1) {
        throw new Error("Search query was not ready for results")
      }
      if (search.results.length > 0) {
        transaction
          .insert(deepSearchResults)
          .values(
            search.results.map((result) => ({
              deepSearchResultId: result.resultId,
              deepSearchQueryId: search.queryId,
              position: result.position,
              title: result.title,
              shortText: result.shortText,
              url: result.url,
            })),
          )
          .run()
      }
    }
  })
  return storedSearches
}

export function attachSelectionGeneration(input: {
  jobId: string
  queryId: string
  generationId: string
}): void {
  db.transaction((transaction) => {
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
    const result = transaction
      .update(deepSearchQueries)
      .set({
        selectionGenerationId: input.generationId,
      })
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
  })
}

export function saveSelectedResults(input: {
  jobId: string
  queryId: string
  selectionGenerationId: string
  selectedResultIds: string[]
}): SelectedPage[] {
  return db.transaction((transaction) => {
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
      const deepSearchWebPageId = isSelected
        ? persistWebPage(result.url)
        : null
      const update = transaction
        .update(deepSearchResults)
        .set({
          deepSearchWebPageId,
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
  })
}

/** Completes a provider search that returned no usable rows without model work. */
export function completeEmptySearchQuery(input: {
  jobId: string
  queryId: string
}): void {
  db.transaction((transaction) => {
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

export function attachPageSummaryGeneration(
  transaction: TextStreamPersistenceTransaction,
  input: {
    jobId: string
    pageId: string
    generationId: string
  },
): void {
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
  const result = transaction
    .update(deepSearchWebPages)
    .set({
      status: "summarizing",
      summaryGenerationId: input.generationId,
    })
    .where(eq(deepSearchWebPages.deepSearchWebPageId, input.pageId))
    .run()
  if (result.changes !== 1) throw new Error("Web page was not persisted")
}

export function completePageSummaryGeneration(
  transaction: TextStreamPersistenceTransaction,
  input: {
    jobId: string
    pageId: string
    generationId: string
  },
): void {
  assertPageOwnedByJob(transaction, input.jobId, input.pageId)
  const result = transaction
    .update(deepSearchWebPages)
    .set({
      status: "completed",
      errorStage: null,
      errorMessage: null,
      completedAt: new Date(),
    })
    .where(
      and(
        eq(deepSearchWebPages.deepSearchWebPageId, input.pageId),
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
  assertPageOwnedByJob(transaction, input.jobId, input.pageId)
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
    assertPageOwnedByJob(
      transaction,
      input.jobId,
      input.pageId,
    )
    const result = transaction
      .update(deepSearchWebPages)
      .set({
        status: "failed",
        errorStage: input.stage,
        errorMessage: input.message,
        completedAt: new Date(),
      })
      .where(eq(deepSearchWebPages.deepSearchWebPageId, input.pageId))
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
  const result = transaction
    .update(deepSearchQueries)
    .set({
      status: "summarizing",
      summaryGenerationId: input.generationId,
    })
    .where(eq(deepSearchQueries.deepSearchQueryId, input.queryId))
    .run()
  if (result.changes !== 1) throw new Error("Search query was not persisted")
}

export function completeQuerySummaryGeneration(
  transaction: TextStreamPersistenceTransaction,
  input: {
    jobId: string
    queryId: string
    generationId: string
  },
): void {
  assertQueryOwnedByJob(transaction, input.jobId, input.queryId)
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
  assertQueryOwnedByJob(transaction, input.jobId, input.queryId)
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
        eq(deepSearchQueries.summaryGenerationId, input.generationId),
      ),
    )
    .run()
  if (result.changes !== 1) {
    throw new Error("Query summary generation was not registered")
  }
}

export function attachRoundReviewGeneration(
  transaction: TextStreamPersistenceTransaction,
  input: {
    jobId: string
    roundId: string
    generationId: string
  },
): void {
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
  const result = transaction
    .update(deepSearchRounds)
    .set({ reviewGenerationId: input.generationId })
    .where(
      eq(deepSearchRounds.deepSearchRoundId, input.roundId),
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
  assertRoundOwnedByJob(
    transaction,
    input.jobId,
    input.roundId,
  )
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
  message: string
}): void {
  const result = db
    .update(deepSearchRounds)
    .set({
      reviewDecision: null,
      reviewReason: null,
      reviewError: input.message,
      reviewCompletedAt: new Date(),
    })
    .where(
      and(
        eq(
          deepSearchRounds.deepSearchRoundId,
          input.roundId,
        ),
        eq(deepSearchRounds.deepSearchJobId, input.jobId),
      ),
    )
    .run()
  if (result.changes !== 1) throw new Error("Deep-search round was not persisted")
}

export function attachFinalAnswerGeneration(
  transaction: TextStreamPersistenceTransaction,
  input: {
    jobId: string
    generationId: string
  },
): void {
  assertGenerationOwnedByJob(
    transaction,
    input.jobId,
    input.generationId,
  )
  const result = transaction
    .update(deepSearchJobs)
    .set({ finalAnswerGenerationId: input.generationId })
    .where(eq(deepSearchJobs.deepSearchJobId, input.jobId))
    .run()
  if (result.changes !== 1) {
    throw new Error("Deep-search job was not persisted")
  }
}
