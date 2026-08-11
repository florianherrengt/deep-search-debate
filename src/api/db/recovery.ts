import { and, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm"
import { db } from "./index.ts"
import {
  debateJobs,
  debateMatches,
  debateRounds,
  deepSearchJobs,
  deepSearchQueries,
  deepSearchRounds,
  deepSearchWebPages,
  llmGenerations,
  ideaJobs,
} from "./schema/index.ts"

const interruptionMessage = "Interrupted by a server restart"

/** Converts work that cannot survive a process restart into typed terminal rows. */
export function recoverInterruptedWork(): void {
  const completedAt = new Date()

  db.update(llmGenerations)
    .set({
      status: "interrupted",
      error: interruptionMessage,
      completedAt,
    })
    .where(eq(llmGenerations.status, "running"))
    .run()

  db.update(deepSearchRounds)
    .set({
      reviewError: interruptionMessage,
      reviewCompletedAt: completedAt,
    })
    .where(
      and(
        isNotNull(deepSearchRounds.reviewGenerationId),
        isNull(deepSearchRounds.reviewCompletedAt),
      ),
    )
    .run()

  db.update(deepSearchQueries)
    .set({
      status: "failed",
      errorStage: "search",
      errorMessage: interruptionMessage,
      completedAt,
    })
    .where(eq(deepSearchQueries.status, "searching"))
    .run()
  db.update(deepSearchQueries)
    .set({
      status: "failed",
      errorStage: "selection",
      errorMessage: interruptionMessage,
      completedAt,
    })
    .where(eq(deepSearchQueries.status, "selecting"))
    .run()
  db.update(deepSearchQueries)
    .set({
      status: "failed",
      errorStage: "summary",
      errorMessage: interruptionMessage,
      completedAt,
    })
    .where(eq(deepSearchQueries.status, "summarizing"))
    .run()

  db.update(deepSearchWebPages)
    .set({
      status: "failed",
      errorStage: "extraction",
      errorMessage: interruptionMessage,
      completedAt,
    })
    .where(inArray(deepSearchWebPages.status, ["pending", "extracting"]))
    .run()
  db.update(deepSearchWebPages)
    .set({
      status: "failed",
      errorStage: "summary",
      errorMessage: interruptionMessage,
      completedAt,
    })
    .where(eq(deepSearchWebPages.status, "summarizing"))
    .run()

  db.update(deepSearchJobs)
    .set({
      status: "interrupted",
      error: interruptionMessage,
      completedAt,
    })
    .where(eq(deepSearchJobs.status, "running"))
    .run()

  db.update(ideaJobs)
    .set({
      status: "interrupted",
      error: interruptionMessage,
      completedAt,
    })
    .where(eq(ideaJobs.status, "running"))
    .run()

  // The final verdict and machine-readable winner commit atomically, just
  // before the runner marks its parent job complete. Close that small crash
  // window by recognizing the one fully completed final match on restart.
  db.update(debateJobs)
    .set({ status: "completed", completedAt })
    .where(
      and(
        eq(debateJobs.status, "running"),
        sql`1 = (
          select count(*)
          from ${debateRounds}
          inner join ${debateMatches}
            on ${debateMatches.debateRoundId} = ${debateRounds.debateRoundId}
          where ${debateRounds.debateJobId} = ${debateJobs.debateJobId}
            and ${debateRounds.stage} = 'final'
            and ${debateRounds.stageRoundNumber} = 1
            and ${debateMatches.winnerIdeaId} is not null
            and ${debateMatches.completedAt} is not null
        )`,
      ),
    )
    .run()

  db.update(debateJobs)
    .set({
      status: "interrupted",
      error: interruptionMessage,
      completedAt,
    })
    .where(eq(debateJobs.status, "running"))
    .run()
}
