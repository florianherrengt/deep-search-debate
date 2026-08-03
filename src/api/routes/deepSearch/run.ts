import { randomUUID } from "node:crypto"
import { eq } from "drizzle-orm"
import { deepSearch } from "../../agents/deep_search/index.ts"
import { db } from "../../db/index.ts"
import {
  deepSearchGeneratedQueries,
  deepSearchJobs,
  deepSearchQueries,
  deepSearchQueryGenerations,
  deepSearchWebPages,
} from "../../db/schema/index.ts"
import { getErrorMessage } from "../../helpers/getErrorMessage.ts"
import { waitForTextStream } from "../../llms/streams.ts"
import { persistDeepSearchEvent } from "./eventPersistence.ts"
import {
  completeDeepSearchJob,
  failDeepSearchJob,
} from "./jobLifecycle.ts"
import {
  type LiveDeepSearchJob,
} from "./schemas.ts"

/** Runs and persists one job while retaining its exact live event sequence. */
export async function runDeepSearchJob(
  deepSearchJobId: string,
  job: LiveDeepSearchJob,
  researchRequest: string,
  maxSearches: number,
  maxResultsPerSearch: number,
): Promise<void> {
      try {
        await deepSearch({
          researchRequest,
          maxSearches,
          maxResultsPerSearch,
          onQueriesGenerated: (queries) => {
            const queryGeneration = db
              .select()
              .from(deepSearchQueryGenerations)
              .where(
                eq(
                  deepSearchQueryGenerations.deepSearchJobId,
                  deepSearchJobId,
                ),
              )
              .get()
            if (!queryGeneration) {
              throw new Error("Query generation was not registered")
            }
            if (queries.length === 0) return

            db.insert(deepSearchGeneratedQueries)
              .values(
                queries.map((query, position) => ({
                  deepSearchGeneratedQueryId: randomUUID(),
                  deepSearchQueryGenerationId:
                    queryGeneration.deepSearchQueryGenerationId,
                  position,
                  query,
                })),
              )
              .run()
          },
          onEvent: (event) => {
            persistDeepSearchEvent(deepSearchJobId, event)
            job.publish(event)
          },
        })

        const queryGeneration = db
          .select({
            llmGenerationId: deepSearchQueryGenerations.llmGenerationId,
          })
          .from(deepSearchQueryGenerations)
          .where(
            eq(deepSearchQueryGenerations.deepSearchJobId, deepSearchJobId),
          )
          .get()
        const finalAnswerGeneration = db
          .select({
            llmGenerationId: deepSearchJobs.finalAnswerGenerationId,
          })
          .from(deepSearchJobs)
          .where(eq(deepSearchJobs.deepSearchJobId, deepSearchJobId))
          .get()
        const queryGenerations = db
          .select({
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
          .all()
        const pageGenerations = db
          .select({
            summaryGenerationId: deepSearchWebPages.summaryGenerationId,
          })
          .from(deepSearchWebPages)
          .where(eq(deepSearchWebPages.deepSearchJobId, deepSearchJobId))
          .all()
        const generationIds = [
          ...new Set([
            ...(queryGeneration ? [queryGeneration.llmGenerationId] : []),
            ...(finalAnswerGeneration?.llmGenerationId
              ? [finalAnswerGeneration.llmGenerationId]
              : []),
            ...queryGenerations.flatMap((query) =>
              [query.selectionGenerationId, query.summaryGenerationId].filter(
                (id): id is string => id !== null,
              ),
            ),
            ...pageGenerations.flatMap((page) =>
              page.summaryGenerationId ? [page.summaryGenerationId] : [],
            ),
          ]),
        ]

        await Promise.all(generationIds.map((id) => waitForTextStream(id)))
        completeDeepSearchJob(deepSearchJobId)
      } catch (error) {
        const errorMessage = getErrorMessage(error, "Deep search failed")
        try {
          failDeepSearchJob(deepSearchJobId, errorMessage)
        } catch (persistenceError) {
          console.error(
            `Failed to persist deep-search job ${deepSearchJobId} failure`,
            persistenceError,
          )
        }
        job.publish({ type: "error", message: errorMessage })
      } finally {
        job.publish({ type: "done" })
        job.close()
      }
}
