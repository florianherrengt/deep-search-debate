import { and, asc, eq, type SQL } from "drizzle-orm"
import { db } from "../../db/index.ts"
import {
  deepSearchGeneratedQueries,
  deepSearchJobs as deepSearchJobsTable,
  deepSearchQueries,
  deepSearchQueryGenerations,
  deepSearchResults,
  deepSearchWebPages,
} from "../../db/schema/index.ts"
import {
  type DeepSearchJobEvent,
} from "./schemas.ts"

/** Reconstructs reducer-compatible progress from normalized typed rows. */
export function reconstructDeepSearchJobEvents(
  deepSearchJobId: string,
  readScope?: SQL,
): DeepSearchJobEvent[] | undefined {
    const job = db
      .select()
      .from(deepSearchJobsTable)
      .where(
        and(
          eq(deepSearchJobsTable.deepSearchJobId, deepSearchJobId),
          readScope,
        ),
      )
      .get()
    if (!job) return

    const queryGeneration = db
      .select()
      .from(deepSearchQueryGenerations)
      .where(
        eq(deepSearchQueryGenerations.deepSearchJobId, deepSearchJobId),
      )
      .get()
    const queryGenerationEvents: DeepSearchJobEvent[] = queryGeneration
      ? [
          {
            type: "query-stream",
            streamId: queryGeneration.llmGenerationId,
          },
        ]
      : []

    const queryRows = db
      .select({
        deepSearchQueryId: deepSearchQueries.deepSearchQueryId,
        query: deepSearchGeneratedQueries.query,
        position: deepSearchGeneratedQueries.position,
        status: deepSearchQueries.status,
        selectionGenerationId: deepSearchQueries.selectionGenerationId,
        summaryGenerationId: deepSearchQueries.summaryGenerationId,
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
      .where(eq(deepSearchQueryGenerations.deepSearchJobId, deepSearchJobId))
      .orderBy(asc(deepSearchGeneratedQueries.position))
      .all()

    const resultsByQuery = new Map(
      queryRows.map(
        (query) =>
          [
            query.deepSearchQueryId,
            db
              .select()
              .from(deepSearchResults)
              .where(
                eq(deepSearchResults.deepSearchQueryId, query.deepSearchQueryId),
              )
              .orderBy(asc(deepSearchResults.position))
              .all(),
          ] as const,
      ),
    )

    const searchResultsEvents: DeepSearchJobEvent[] =
      queryRows.length > 0 || job.status === "completed"
        ? [
            {
              type: "search-results",
              searches: queryRows.map((query) => ({
                query: query.query,
                results: (resultsByQuery.get(query.deepSearchQueryId) ?? []).map(
                  (result) => ({
                    title: result.title,
                    shortText: result.shortText,
                    link: result.url,
                  }),
                ),
              })),
            },
          ]
        : []

    const queryProgressEvents = queryRows.flatMap<DeepSearchJobEvent>((query) => {
      const results = resultsByQuery.get(query.deepSearchQueryId) ?? []
      const selectionEvents: DeepSearchJobEvent[] = query.selectionGenerationId
        ? [
            {
              type: "selection-stream",
              query: query.query,
              streamId: query.selectionGenerationId,
            },
          ]
        : []
      const selectionCompleted =
        results.every((result) => result.selectionStatus !== "pending") &&
        query.status !== "selecting"
      const selectedResultsEvents: DeepSearchJobEvent[] = selectionCompleted
        ? [
            {
              type: "selected-search-results",
              query: query.query,
              selectedLinks: results
                .filter((result) => result.selectionStatus === "selected")
                .map((result) => result.url),
            },
          ]
        : []
      return [...selectionEvents, ...selectedResultsEvents]
    })

    const querySummaryEvents = queryRows.flatMap<DeepSearchJobEvent>((query) =>
      query.summaryGenerationId
        ? [
            {
              type: "query-summary-stream",
              query: query.query,
              streamId: query.summaryGenerationId,
            },
          ]
        : [],
    )

    const pages = db
      .select()
      .from(deepSearchWebPages)
      .where(eq(deepSearchWebPages.deepSearchJobId, deepSearchJobId))
      .orderBy(
        asc(deepSearchWebPages.createdAt),
        asc(deepSearchWebPages.deepSearchWebPageId),
      )
      .all()
    const pageEvents = pages.flatMap<DeepSearchJobEvent>((page) => {
      if (page.summaryGenerationId) {
        return [
          {
            type: "page-summary-stream",
            url: page.url,
            streamId: page.summaryGenerationId,
          },
        ]
      }
      if (page.errorStage && page.errorMessage) {
        return [
          {
            type: "page-summary-error",
            url: page.url,
            stage: page.errorStage,
            message: page.errorMessage,
          },
        ]
      }
      return []
    })

    const finalAnswerEvents: DeepSearchJobEvent[] =
      job.finalAnswerGenerationId
        ? [
            {
              type: "final-answer-stream",
              streamId: job.finalAnswerGenerationId,
            },
          ]
        : []

    const terminalEvents: DeepSearchJobEvent[] =
      job.status === "running"
        ? []
        : [
            ...(job.error
              ? [{ type: "error" as const, message: job.error }]
              : []),
            { type: "done" },
          ]

    return [
      ...queryGenerationEvents,
      ...searchResultsEvents,
      ...queryProgressEvents,
      ...pageEvents,
      ...querySummaryEvents,
      ...finalAnswerEvents,
      ...terminalEvents,
    ]
}
