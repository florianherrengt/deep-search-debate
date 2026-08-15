import { and, eq, isNull } from "drizzle-orm"

import { db } from "../../db/index.ts"
import { debateJobs } from "../../db/schema/index.ts"
import type { ResearchJobStatus } from "../researchCancellation.ts"

export type DebateStopRequestResult =
  | { kind: "requested"; newlyRequested: boolean; cancelRequestedAt: Date }
  | { kind: "already-interrupted"; cancelRequestedAt: Date; completedAt: Date }
  | { kind: "not-found" }
  | { kind: "not-cancellable"; status: ResearchJobStatus }

/** Atomically persists an owner request to stop a debate root. */
export function requestDebateStop(
  userId: string,
  debateJobId: string,
): DebateStopRequestResult {
  return db.transaction((transaction) => {
    const job = transaction
      .select({
        status: debateJobs.status,
        cancelRequestedAt: debateJobs.cancelRequestedAt,
        completedAt: debateJobs.completedAt,
      })
      .from(debateJobs)
      .where(
        and(eq(debateJobs.debateJobId, debateJobId), eq(debateJobs.userId, userId)),
      )
      .get()
    if (!job) return { kind: "not-found" }
    if (job.status === "running") {
      if (job.cancelRequestedAt !== null) {
        return {
          kind: "requested",
          newlyRequested: false,
          cancelRequestedAt: job.cancelRequestedAt,
        }
      }
      const cancelRequestedAt = new Date()
      const result = transaction
        .update(debateJobs)
        .set({ cancelRequestedAt })
        .where(
          and(
            eq(debateJobs.debateJobId, debateJobId),
            eq(debateJobs.userId, userId),
            eq(debateJobs.status, "running"),
            isNull(debateJobs.cancelRequestedAt),
          ),
        )
        .run()
      if (result.changes !== 1) {
        throw new Error("Debate stop request lost its checked update")
      }
      return { kind: "requested", newlyRequested: true, cancelRequestedAt }
    }
    if (
      job.status === "interrupted" &&
      job.cancelRequestedAt !== null &&
      job.completedAt !== null
    ) {
      return {
        kind: "already-interrupted",
        cancelRequestedAt: job.cancelRequestedAt,
        completedAt: job.completedAt,
      }
    }
    return { kind: "not-cancellable", status: job.status }
  })
}
