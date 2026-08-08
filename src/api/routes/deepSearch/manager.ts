import { randomUUID } from "node:crypto"
import { and, eq } from "drizzle-orm"
import { db } from "../../db/index.ts"
import {
  deepSearchJobs as deepSearchJobsTable,
  deepSearchGeneratedQueries,
  deepSearchQueries,
  deepSearchQueryGenerations,
  deepSearchWebPages,
  llmGenerations,
} from "../../db/schema/index.ts"
import {
  createPromptIdentity,
  type PromptIdentity,
} from "../../helpers/promptTitles.ts"
import { createReplayableEventLog } from "../../helpers/replayableEventLog.ts"
import { generatePromptTitle } from "../../llms/generateText.ts"
import { runDeepSearchJob } from "./run.ts"
import type { DeepSearchJobEvent, LiveDeepSearchJob } from "./schemas.ts"

type StartDeepSearchJobInput = {
  title?: string
  researchRequest: string
  maxSearches: number
  maxResultsPerSearch: number
  ideaJobId?: string
  ideaJobPosition?: number
  maxRetries?: number
}

type StartedDeepSearchJob = {
  deepSearchJobId: string
  title: string
  slug: string
  /** Resolves to the persisted final answer, or rejects for any failed job. */
  completion: Promise<string>
}

function getInternalFailure(deepSearchJobId: string): string | undefined {
  const failedQuery = db
    .select({ message: deepSearchQueries.errorMessage })
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
        eq(deepSearchQueries.status, "failed"),
      ),
    )
    .get()
  if (failedQuery) return failedQuery.message ?? "Research query failed"

  const failedPage = db
    .select({ message: deepSearchWebPages.errorMessage })
    .from(deepSearchWebPages)
    .where(
      and(
        eq(deepSearchWebPages.deepSearchJobId, deepSearchJobId),
        eq(deepSearchWebPages.status, "failed"),
        // Source availability is outside our control. Extraction failures
        // retain their snippet fallback and do not invalidate the research;
        // a failed model-generated page summary remains an internal failure.
        eq(deepSearchWebPages.errorStage, "summary"),
      ),
    )
    .get()
  return failedPage?.message ?? (failedPage ? "Research page failed" : undefined)
}

export type DeepSearchJobManager = {
  start(
    userId: string,
    input: StartDeepSearchJobInput,
  ): Promise<StartedDeepSearchJob>
  getLiveJob(deepSearchJobId: string): LiveDeepSearchJob | undefined
}

function createDeepSearchIdentity(
  userId: string,
  generatedTitle: string,
): PromptIdentity {
  const usedSlugs = db
    .select({ slug: deepSearchJobsTable.slug })
    .from(deepSearchJobsTable)
    .where(eq(deepSearchJobsTable.userId, userId))
    .all()
    .map(({ slug }) => slug)
  return createPromptIdentity(generatedTitle, usedSlugs)
}

function hasDurableTerminalState(deepSearchJobId: string): boolean {
  try {
    const job = db
      .select({ status: deepSearchJobsTable.status })
      .from(deepSearchJobsTable)
      .where(eq(deepSearchJobsTable.deepSearchJobId, deepSearchJobId))
      .get()
    return job?.status !== undefined && job.status !== "running"
  } catch {
    // A failed status read cannot prove that durable replay is safe. Retaining
    // the closed log preserves terminal events until the process restarts.
    return false
  }
}

/** Turns the deep-search job's persisted terminal state into a parent result. */
function getCompletedAnswer(deepSearchJobId: string): string {
  const result = db
    .select({
      jobStatus: deepSearchJobsTable.status,
      jobError: deepSearchJobsTable.error,
      generationStatus: llmGenerations.status,
      generationText: llmGenerations.text,
      generationError: llmGenerations.error,
    })
    .from(deepSearchJobsTable)
    .leftJoin(
      llmGenerations,
      eq(
        deepSearchJobsTable.finalAnswerGenerationId,
        llmGenerations.llmGenerationId,
      ),
    )
    .where(eq(deepSearchJobsTable.deepSearchJobId, deepSearchJobId))
    .get()

  if (!result) throw new Error("Deep search job was not found")
  if (result.jobStatus !== "completed") {
    throw new Error(result.jobError ?? "Deep search failed")
  }
  // Blocked or unavailable pages are expected research misses and already fall
  // back to search snippets. The idea pipeline only rejects failures in work we
  // control: query processing and model-generated page summaries.
  const internalFailure = getInternalFailure(deepSearchJobId)
  if (internalFailure) throw new Error(internalFailure)
  if (
    result.generationStatus !== "completed" ||
    result.generationText === null
  ) {
    throw new Error(
      result.generationError ?? "Deep search final answer did not complete",
    )
  }
  return result.generationText
}

/** Owns the live logs used by both direct and idea-pipeline deep searches. */
export function createDeepSearchJobManager(): DeepSearchJobManager {
  const liveJobs = new Map<string, LiveDeepSearchJob>()

  return {
    async start(userId, input) {
      const deepSearchJobId = randomUUID()
      const job = createReplayableEventLog<DeepSearchJobEvent>()
      const { maxRetries, title: suppliedTitle, ...persistedInput } = input
      const generatedTitle =
        suppliedTitle ?? (await generatePromptTitle(input.researchRequest))
      const identity = createDeepSearchIdentity(userId, generatedTitle)

      db.insert(deepSearchJobsTable)
        .values({ deepSearchJobId, userId, ...identity, ...persistedInput })
        .run()

      // The route serving child events reads this same log while the durable
      // database rows remain the source used after a process restart.
      liveJobs.set(deepSearchJobId, job)

      // runDeepSearchJob persists normal failures instead of throwing them.
      // Reading the terminal row converts those failures into a rejection so
      // an owning idea pipeline can enforce its all-or-nothing contract.
      const completion = runDeepSearchJob(
        deepSearchJobId,
        userId,
        job,
        input.researchRequest,
        input.maxSearches,
        input.maxResultsPerSearch,
        maxRetries,
      )
        .then(() => getCompletedAnswer(deepSearchJobId))
        .finally(() => {
          if (hasDurableTerminalState(deepSearchJobId)) {
            // Existing subscribers retain their iterator. New subscribers use
            // durable replay instead of keeping every closed log in memory.
            liveJobs.delete(deepSearchJobId)
          }
        })

      return { deepSearchJobId, ...identity, completion }
    },
    getLiveJob(deepSearchJobId) {
      return liveJobs.get(deepSearchJobId)
    },
  }
}
