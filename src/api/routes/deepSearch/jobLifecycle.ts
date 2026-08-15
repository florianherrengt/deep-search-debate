import { and, eq, inArray, isNotNull, isNull } from "drizzle-orm"
import { db } from "../../db/index.ts"
import {
  deepSearchJobs,
  deepSearchQueries,
  deepSearchRounds,
  deepSearchWebPages,
  llmGenerations,
} from "../../db/schema/index.ts"
import type { TextStreamPersistenceTransaction } from "../../llms/streams.ts"
import { assertEffectiveResearchRootRunning } from "../researchCancellation.ts"

const stoppedMessage = "Workflow stopped by user"

function assertDeepSearchActive(
  transaction: TextStreamPersistenceTransaction,
  jobId: string,
): void {
  assertEffectiveResearchRootRunning(transaction, {
    kind: "deep-search",
    jobId,
  })
}

function settleActiveDeepSearchRecords(
  transaction: TextStreamPersistenceTransaction,
  jobId: string,
  message: string,
  completedAt: Date,
): void {
  transaction
    .update(deepSearchRounds)
    .set({ reviewError: message, reviewCompletedAt: completedAt })
    .where(
      and(
        eq(deepSearchRounds.deepSearchJobId, jobId),
        isNotNull(deepSearchRounds.reviewGenerationId),
        isNull(deepSearchRounds.reviewCompletedAt),
      ),
    )
    .run()

  const queries = transaction
    .select({
      queryId: deepSearchQueries.deepSearchQueryId,
      status: deepSearchQueries.status,
    })
    .from(deepSearchQueries)
    .innerJoin(
      deepSearchRounds,
      eq(deepSearchQueries.deepSearchRoundId, deepSearchRounds.deepSearchRoundId),
    )
    .where(eq(deepSearchRounds.deepSearchJobId, jobId))
    .all()
  for (const query of queries) {
    if (query.status === "completed" || query.status === "failed") continue
    const errorStage =
      query.status === "selecting"
        ? "selection"
        : query.status === "summarizing"
          ? "summary"
          : "search"
    transaction
      .update(deepSearchQueries)
      .set({
        status: "failed",
        errorStage,
        errorMessage: message,
        completedAt,
      })
      .where(eq(deepSearchQueries.deepSearchQueryId, query.queryId))
      .run()
  }

  transaction
    .update(deepSearchWebPages)
    .set({
      status: "failed",
      errorStage: "extraction",
      errorMessage: message,
      completedAt,
    })
    .where(
      and(
        eq(deepSearchWebPages.deepSearchJobId, jobId),
        inArray(deepSearchWebPages.status, ["pending", "extracting"]),
      ),
    )
    .run()
  transaction
    .update(deepSearchWebPages)
    .set({
      status: "failed",
      errorStage: "summary",
      errorMessage: message,
      completedAt,
    })
    .where(
      and(
        eq(deepSearchWebPages.deepSearchJobId, jobId),
        eq(deepSearchWebPages.status, "summarizing"),
      ),
    )
    .run()
}

/**
 * Completes a job inside the final generation's terminal transaction.
 * Every generated query must have reached its own authoritative completion
 * boundary before the final answer can make the aggregate terminal.
 */
export function completeDeepSearchJob(
  transaction: TextStreamPersistenceTransaction,
  input: { jobId: string; generationId: string },
): void {
  assertDeepSearchActive(transaction, input.jobId)
  const job = transaction
    .select({
      status: deepSearchJobs.status,
      finalAnswerGenerationId: deepSearchJobs.finalAnswerGenerationId,
    })
    .from(deepSearchJobs)
    .where(eq(deepSearchJobs.deepSearchJobId, input.jobId))
    .get()
  if (!job) throw new Error("Deep-search job was not found")
  if (job.status !== "running") {
    throw new Error("Deep-search job is already terminal")
  }
  if (job.finalAnswerGenerationId !== input.generationId) {
    throw new Error("Final answer generation was not registered")
  }

  const incompleteQuery = transaction
    .select({
      queryId: deepSearchQueries.deepSearchQueryId,
      status: deepSearchQueries.status,
    })
    .from(deepSearchQueries)
    .innerJoin(
      deepSearchRounds,
      eq(deepSearchQueries.deepSearchRoundId, deepSearchRounds.deepSearchRoundId),
    )
    .where(eq(deepSearchRounds.deepSearchJobId, input.jobId))
    .all()
    .find(({ status }) => status !== "completed")
  if (incompleteQuery) {
    throw new Error(
      "Every search query must complete before the deep-search job",
    )
  }

  const finalGeneration = transaction
    .select({
      deepSearchJobId: llmGenerations.deepSearchJobId,
      status: llmGenerations.status,
      text: llmGenerations.text,
      error: llmGenerations.error,
    })
    .from(llmGenerations)
    .where(eq(llmGenerations.llmGenerationId, input.generationId))
    .get()
  if (finalGeneration?.deepSearchJobId !== input.jobId) {
    throw new Error("Final answer generation must belong to the deep-search job")
  }
  if (finalGeneration.status !== "completed" || finalGeneration.text === null) {
    throw new Error(
      finalGeneration.error ?? "Final answer generation did not complete",
    )
  }

  const result = transaction
    .update(deepSearchJobs)
    .set({ status: "completed", completedAt: new Date() })
    .where(
      and(
        eq(deepSearchJobs.deepSearchJobId, input.jobId),
        eq(deepSearchJobs.status, "running"),
        eq(deepSearchJobs.finalAnswerGenerationId, input.generationId),
      ),
    )
    .run()
  if (result.changes !== 1) {
    throw new Error("Deep-search job could not be completed")
  }
}

/** Atomically promotes one completed round answer and completes its job. */
export function promoteRoundAnswer(input: {
  jobId: string
  roundId: string
  generationId: string
}): void {
  db.transaction((transaction) => {
    assertDeepSearchActive(transaction, input.jobId)
    const round = transaction
      .select({
        deepSearchJobId: deepSearchRounds.deepSearchJobId,
        answerGenerationId: deepSearchRounds.answerGenerationId,
      })
      .from(deepSearchRounds)
      .where(eq(deepSearchRounds.deepSearchRoundId, input.roundId))
      .get()
    if (round?.deepSearchJobId !== input.jobId) {
      throw new Error("Deep-search round must belong to the deep-search job")
    }
    if (round.answerGenerationId !== input.generationId) {
      throw new Error("Round answer generation was not registered")
    }

    const registered = transaction
      .update(deepSearchJobs)
      .set({ finalAnswerGenerationId: input.generationId })
      .where(
        and(
          eq(deepSearchJobs.deepSearchJobId, input.jobId),
          eq(deepSearchJobs.status, "running"),
          isNull(deepSearchJobs.finalAnswerGenerationId),
        ),
      )
      .run()
    if (registered.changes !== 1) {
      throw new Error("Deep-search final answer could not be promoted")
    }

    completeDeepSearchJob(transaction, {
      jobId: input.jobId,
      generationId: input.generationId,
    })
  })
}

/** Fails all still-active work and its owning job in one transaction. */
export function failDeepSearchJob(jobId: string, message: string): void {
  const completedAt = new Date()
  db.transaction((transaction) => {
    assertDeepSearchActive(transaction, jobId)
    settleActiveDeepSearchRecords(transaction, jobId, message, completedAt)

    const result = transaction
      .update(deepSearchJobs)
      .set({ status: "failed", error: message, completedAt })
      .where(
        and(
          eq(deepSearchJobs.deepSearchJobId, jobId),
          eq(deepSearchJobs.status, "running"),
        ),
      )
      .run()
    if (result.changes !== 1) {
      throw new Error("Running deep-search job was not found")
    }
  })
}

/**
 * Settles every still-active deep-search record after Stop made the root
 * inactive. This intentionally does not use the normal active-root guard.
 */
export function interruptDeepSearchJob(
  jobId: string,
  message = stoppedMessage,
): void {
  const completedAt = new Date()
  db.transaction((transaction) => {
    settleActiveDeepSearchRecords(transaction, jobId, message, completedAt)

    const job = transaction
      .select({ status: deepSearchJobs.status })
      .from(deepSearchJobs)
      .where(eq(deepSearchJobs.deepSearchJobId, jobId))
      .get()
    if (!job) throw new Error("Deep-search job was not found")
    if (job.status === "interrupted") return
    if (job.status !== "running") {
      throw new Error("Deep-search job is already terminal")
    }
    const result = transaction
      .update(deepSearchJobs)
      .set({ status: "interrupted", error: message, completedAt })
      .where(
        and(
          eq(deepSearchJobs.deepSearchJobId, jobId),
          eq(deepSearchJobs.status, "running"),
        ),
      )
      .run()
    if (result.changes !== 1) {
      throw new Error("Running deep-search job was not found")
    }
  })
}
