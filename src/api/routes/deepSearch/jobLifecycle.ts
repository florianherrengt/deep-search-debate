import { and, eq, inArray } from "drizzle-orm"
import { db } from "../../db/index.ts"
import {
  deepSearchGeneratedQueries,
  deepSearchJobs as deepSearchJobsTable,
  deepSearchQueries,
  deepSearchQueryGenerations,
  deepSearchWebPages,
  llmGenerations,
} from "../../db/schema/index.ts"

function findLlmGeneration(llmGenerationId: string | null) {
  if (!llmGenerationId) return
  return db
    .select({
      status: llmGenerations.status,
      error: llmGenerations.error,
    })
    .from(llmGenerations)
    .where(eq(llmGenerations.llmGenerationId, llmGenerationId))
    .get()
}

export function completeDeepSearchJob(deepSearchJobId: string): void {
    const completedAt = new Date()
    const queries = db
      .select()
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
      .all()

    for (const row of queries) {
      const query = row.deep_search_queries
      const generation = findLlmGeneration(query.summaryGenerationId)
      const failed = generation?.status !== "completed"
      db.update(deepSearchQueries)
        .set({
          status: failed ? "failed" : "completed",
          errorStage: failed ? "summary" : null,
          errorMessage: failed
            ? (generation?.error ?? "Query summary did not complete")
            : null,
          completedAt,
        })
        .where(eq(deepSearchQueries.deepSearchQueryId, query.deepSearchQueryId))
        .run()
    }

    const pages = db
      .select()
      .from(deepSearchWebPages)
      .where(eq(deepSearchWebPages.deepSearchJobId, deepSearchJobId))
      .all()
    for (const page of pages) {
      if (page.status === "failed") continue
      const generation = findLlmGeneration(page.summaryGenerationId)
      const failed = generation?.status !== "completed"
      db.update(deepSearchWebPages)
        .set({
          status: failed ? "failed" : "completed",
          errorStage: failed
            ? page.summaryGenerationId
              ? "summary"
              : "extraction"
            : null,
          errorMessage: failed
            ? (generation?.error ?? "Page summary did not complete")
            : null,
          completedAt,
        })
        .where(
          eq(deepSearchWebPages.deepSearchWebPageId, page.deepSearchWebPageId),
        )
        .run()
    }

    const job = db
      .select({
        finalAnswerGenerationId:
          deepSearchJobsTable.finalAnswerGenerationId,
      })
      .from(deepSearchJobsTable)
      .where(eq(deepSearchJobsTable.deepSearchJobId, deepSearchJobId))
      .get()
    const finalAnswerGeneration = findLlmGeneration(
      job?.finalAnswerGenerationId ?? null,
    )
    if (
      job?.finalAnswerGenerationId &&
      finalAnswerGeneration?.status !== "completed"
    ) {
      throw new Error(
        finalAnswerGeneration?.error ?? "Final answer did not complete",
      )
    }

    db.update(deepSearchJobsTable)
      .set({ status: "completed", completedAt })
      .where(eq(deepSearchJobsTable.deepSearchJobId, deepSearchJobId))
      .run()
}

export function failDeepSearchJob(
  deepSearchJobId: string,
  message: string,
): void {
    const completedAt = new Date()
    const queries = db
      .select()
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
      .all()
    for (const row of queries) {
      const query = row.deep_search_queries
      if (query.status === "completed" || query.status === "failed") continue
      const errorStage =
        query.status === "selecting"
          ? "selection"
          : query.status === "summarizing"
            ? "summary"
            : "search"
      db.update(deepSearchQueries)
        .set({
          status: "failed",
          errorStage,
          errorMessage: message,
          completedAt,
        })
        .where(eq(deepSearchQueries.deepSearchQueryId, query.deepSearchQueryId))
        .run()
    }

    const pages = db
      .select()
      .from(deepSearchWebPages)
      .where(
        and(
          eq(deepSearchWebPages.deepSearchJobId, deepSearchJobId),
          inArray(deepSearchWebPages.status, [
            "pending",
            "extracting",
            "summarizing",
          ]),
        ),
      )
      .all()
    for (const page of pages) {
      db.update(deepSearchWebPages)
        .set({
          status: "failed",
          errorStage:
            page.status === "summarizing" ? "summary" : "extraction",
          errorMessage: message,
          completedAt,
        })
        .where(
          eq(deepSearchWebPages.deepSearchWebPageId, page.deepSearchWebPageId),
        )
        .run()
    }

    db.update(deepSearchJobsTable)
      .set({ status: "failed", error: message, completedAt })
      .where(eq(deepSearchJobsTable.deepSearchJobId, deepSearchJobId))
      .run()
}
