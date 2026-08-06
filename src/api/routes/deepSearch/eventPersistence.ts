import { randomUUID } from "node:crypto"
import { and, asc, eq } from "drizzle-orm"
import type {
  DeepSearchEvent,
  DeepSearchSearchResults,
} from "../../agents/deep_search/schemas.ts"
import { db } from "../../db/index.ts"
import {
  deepSearchGeneratedQueries,
  deepSearchJobs,
  deepSearchQueries,
  deepSearchQueryGenerations,
  deepSearchResults,
  deepSearchWebPages,
  llmGenerations,
} from "../../db/schema/index.ts"

function assertGenerationOwnedByJob(
  deepSearchJobId: string,
  llmGenerationId: string,
): void {
  const ownedGeneration = db
    .select({ llmGenerationId: llmGenerations.llmGenerationId })
    .from(deepSearchJobs)
    .innerJoin(
      llmGenerations,
      and(
        eq(llmGenerations.llmGenerationId, llmGenerationId),
        eq(
          llmGenerations.deepSearchJobId,
          deepSearchJobs.deepSearchJobId,
        ),
      ),
    )
    .where(eq(deepSearchJobs.deepSearchJobId, deepSearchJobId))
    .get()
  if (!ownedGeneration) {
    throw new Error("LLM generation must belong to the deep-search job owner")
  }
}

function findQueryExecution(deepSearchJobId: string, query: string) {
  return db
    .select({
      deepSearchQueryId: deepSearchQueries.deepSearchQueryId,
      status: deepSearchQueries.status,
    })
    .from(deepSearchQueries)
    .innerJoin(
      deepSearchGeneratedQueries,
      eq(
        deepSearchQueries.deepSearchGeneratedQueryId,
        deepSearchGeneratedQueries.deepSearchGeneratedQueryId,
      ),
    )
    .innerJoin(
      deepSearchQueryGenerations,
      eq(
        deepSearchGeneratedQueries.deepSearchQueryGenerationId,
        deepSearchQueryGenerations.deepSearchQueryGenerationId,
      ),
    )
    .where(
      and(
        eq(deepSearchQueryGenerations.deepSearchJobId, deepSearchJobId),
        eq(deepSearchGeneratedQueries.query, query),
      ),
    )
    .get()
}

function persistSearchResults(
  deepSearchJobId: string,
  searches: DeepSearchSearchResults,
): void {
  const generatedByQuery = new Map(
    db
      .select({
        deepSearchGeneratedQueryId:
          deepSearchGeneratedQueries.deepSearchGeneratedQueryId,
        query: deepSearchGeneratedQueries.query,
      })
      .from(deepSearchGeneratedQueries)
      .innerJoin(
        deepSearchQueryGenerations,
        eq(
          deepSearchGeneratedQueries.deepSearchQueryGenerationId,
          deepSearchQueryGenerations.deepSearchQueryGenerationId,
        ),
      )
      .where(eq(deepSearchQueryGenerations.deepSearchJobId, deepSearchJobId))
      .orderBy(asc(deepSearchGeneratedQueries.position))
      .all()
      .map((entry) => [entry.query, entry.deepSearchGeneratedQueryId]),
  )

  db.transaction((transaction) => {
    for (const search of searches) {
      const deepSearchGeneratedQueryId = generatedByQuery.get(search.query)
      if (!deepSearchGeneratedQueryId) {
        throw new Error(`Generated query was not persisted: ${search.query}`)
      }

      const deepSearchQueryId = randomUUID()
      transaction
        .insert(deepSearchQueries)
        .values({
          deepSearchQueryId,
          deepSearchGeneratedQueryId,
          status: "selecting",
        })
        .run()

      if (search.results.length > 0) {
        transaction
          .insert(deepSearchResults)
          .values(
            search.results.map((result, position) => ({
              deepSearchResultId: randomUUID(),
              deepSearchQueryId,
              position,
              title: result.title,
              shortText: result.shortText,
              url: result.link,
            })),
          )
          .run()
      }
    }
  })
}

function persistSelectedResults(
  deepSearchJobId: string,
  query: string,
  selectedLinks: string[],
): void {
  const execution = findQueryExecution(deepSearchJobId, query)
  if (!execution) throw new Error(`Search query was not persisted: ${query}`)

  const selected = new Set(selectedLinks)
  const results = db
    .select()
    .from(deepSearchResults)
    .where(eq(deepSearchResults.deepSearchQueryId, execution.deepSearchQueryId))
    .all()

  db.transaction((transaction) => {
    const persistWebPage = (url: string): string => {
      transaction
        .insert(deepSearchWebPages)
        .values({
          deepSearchWebPageId: randomUUID(),
          deepSearchJobId,
          url,
          status: "extracting",
        })
        .onConflictDoNothing()
        .run()

      const webPage = transaction
        .select({
          deepSearchWebPageId: deepSearchWebPages.deepSearchWebPageId,
        })
        .from(deepSearchWebPages)
        .where(
          and(
            eq(deepSearchWebPages.deepSearchJobId, deepSearchJobId),
            eq(deepSearchWebPages.url, url),
          ),
        )
        .get()
      if (!webPage) throw new Error(`Web page was not persisted: ${url}`)
      return webPage.deepSearchWebPageId
    }

    for (const result of results) {
      const isSelected = selected.has(result.url)
      const deepSearchWebPageId = isSelected
        ? persistWebPage(result.url)
        : null

      transaction
        .update(deepSearchResults)
        .set({
          selectionStatus: isSelected ? "selected" : "rejected",
          deepSearchWebPageId,
        })
        .where(
          eq(deepSearchResults.deepSearchResultId, result.deepSearchResultId),
        )
        .run()
    }

    transaction
      .update(deepSearchQueries)
      .set({ status: "summarizing" })
      .where(
        eq(deepSearchQueries.deepSearchQueryId, execution.deepSearchQueryId),
      )
      .run()
  })
}

export function persistDeepSearchEvent(
  deepSearchJobId: string,
  event: DeepSearchEvent,
): void {
  switch (event.type) {
    case "query-stream":
      assertGenerationOwnedByJob(deepSearchJobId, event.streamId)
      db.insert(deepSearchQueryGenerations)
        .values({
          deepSearchQueryGenerationId: randomUUID(),
          deepSearchJobId,
          llmGenerationId: event.streamId,
        })
        .run()
      break
    case "search-results":
      persistSearchResults(deepSearchJobId, event.searches)
      break
    case "selection-stream": {
      assertGenerationOwnedByJob(deepSearchJobId, event.streamId)
      const execution = findQueryExecution(deepSearchJobId, event.query)
      if (!execution) {
        throw new Error(`Search query was not persisted: ${event.query}`)
      }
      db.update(deepSearchQueries)
        .set({
          status: "selecting",
          selectionGenerationId: event.streamId,
        })
        .where(
          eq(deepSearchQueries.deepSearchQueryId, execution.deepSearchQueryId),
        )
        .run()
      break
    }
    case "selected-search-results":
      persistSelectedResults(deepSearchJobId, event.query, event.selectedLinks)
      break
    case "page-summary-stream":
      assertGenerationOwnedByJob(deepSearchJobId, event.streamId)
      db.update(deepSearchWebPages)
        .set({ status: "summarizing", summaryGenerationId: event.streamId })
        .where(
          and(
            eq(deepSearchWebPages.deepSearchJobId, deepSearchJobId),
            eq(deepSearchWebPages.url, event.url),
          ),
        )
        .run()
      break
    case "page-summary-error":
      db.update(deepSearchWebPages)
        .set({
          status: "failed",
          errorStage: event.stage,
          errorMessage: event.message,
          completedAt: new Date(),
        })
        .where(
          and(
            eq(deepSearchWebPages.deepSearchJobId, deepSearchJobId),
            eq(deepSearchWebPages.url, event.url),
          ),
        )
        .run()
      break
    case "query-summary-stream": {
      assertGenerationOwnedByJob(deepSearchJobId, event.streamId)
      const execution = findQueryExecution(deepSearchJobId, event.query)
      if (!execution) {
        throw new Error(`Search query was not persisted: ${event.query}`)
      }
      db.update(deepSearchQueries)
        .set({ status: "summarizing", summaryGenerationId: event.streamId })
        .where(
          eq(deepSearchQueries.deepSearchQueryId, execution.deepSearchQueryId),
        )
        .run()
      break
    }
    case "final-answer-stream":
      assertGenerationOwnedByJob(deepSearchJobId, event.streamId)
      db.update(deepSearchJobs)
        .set({ finalAnswerGenerationId: event.streamId })
        .where(eq(deepSearchJobs.deepSearchJobId, deepSearchJobId))
        .run()
      break
  }
}
