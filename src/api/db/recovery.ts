import { eq, inArray } from "drizzle-orm"
import { db } from "./index.ts"
import {
  deepSearchJobs,
  deepSearchQueries,
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

    for (const status of ["pending", "searching"] as const) {
      db.update(deepSearchQueries)
        .set({
          status: "failed",
          errorStage: "search",
          errorMessage: interruptionMessage,
          completedAt,
        })
        .where(eq(deepSearchQueries.status, status))
        .run()
    }
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
}
