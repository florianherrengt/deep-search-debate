import { and, eq, isNull } from "drizzle-orm"

import { db } from "../../db/index.ts"
import { ideaJobs } from "../../db/schema/index.ts"
import type { ResearchJobStatus } from "../researchCancellation.ts"

export type IdeaStopRequestResult =
  | { kind: "requested"; newlyRequested: boolean; cancelRequestedAt: Date }
  | { kind: "already-interrupted"; cancelRequestedAt: Date; completedAt: Date }
  | { kind: "not-found" }
  | { kind: "not-root" }
  | { kind: "not-cancellable"; status: ResearchJobStatus }

/** Atomically persists an owner request to stop a standalone idea workflow. */
export function requestIdeaStop(
  userId: string,
  ideaJobId: string,
): IdeaStopRequestResult {
  return db.transaction((transaction) => {
    const job = transaction
      .select({
        debateJobId: ideaJobs.debateJobId,
        status: ideaJobs.status,
        cancelRequestedAt: ideaJobs.cancelRequestedAt,
        completedAt: ideaJobs.completedAt,
      })
      .from(ideaJobs)
      .where(
        and(eq(ideaJobs.ideaJobId, ideaJobId), eq(ideaJobs.userId, userId)),
      )
      .get()
    if (!job) return { kind: "not-found" }
    if (job.debateJobId !== null) return { kind: "not-root" }
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
        .update(ideaJobs)
        .set({ cancelRequestedAt })
        .where(
          and(
            eq(ideaJobs.ideaJobId, ideaJobId),
            eq(ideaJobs.userId, userId),
            eq(ideaJobs.status, "running"),
            isNull(ideaJobs.debateJobId),
            isNull(ideaJobs.cancelRequestedAt),
          ),
        )
        .run()
      if (result.changes !== 1) {
        throw new Error("Idea stop request lost its checked update")
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
