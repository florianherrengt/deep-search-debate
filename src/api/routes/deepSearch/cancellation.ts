import { and, eq, isNull } from "drizzle-orm"

import { db } from "../../db/index.ts"
import { deepSearchJobs } from "../../db/schema/index.ts"
import type { ResearchJobStatus } from "../researchCancellation.ts"

export type StopRequestResult =
  | { kind: "requested"; newlyRequested: boolean; cancelRequestedAt: Date }
  | { kind: "already-interrupted"; cancelRequestedAt: Date; completedAt: Date }
  | { kind: "not-found" }
  | { kind: "not-root" }
  | { kind: "not-cancellable"; status: ResearchJobStatus }

/** Atomically persists an owner request to stop a standalone deep search. */
export function requestDeepSearchStop(
  userId: string,
  deepSearchJobId: string,
): StopRequestResult {
  return db.transaction((transaction) => {
    const job = transaction
      .select({
        ideaJobId: deepSearchJobs.ideaJobId,
        status: deepSearchJobs.status,
        cancelRequestedAt: deepSearchJobs.cancelRequestedAt,
        completedAt: deepSearchJobs.completedAt,
      })
      .from(deepSearchJobs)
      .where(
        and(
          eq(deepSearchJobs.deepSearchJobId, deepSearchJobId),
          eq(deepSearchJobs.userId, userId),
        ),
      )
      .get()
    if (!job) return { kind: "not-found" }
    if (job.ideaJobId !== null) return { kind: "not-root" }
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
        .update(deepSearchJobs)
        .set({ cancelRequestedAt })
        .where(
          and(
            eq(deepSearchJobs.deepSearchJobId, deepSearchJobId),
            eq(deepSearchJobs.userId, userId),
            eq(deepSearchJobs.status, "running"),
            isNull(deepSearchJobs.ideaJobId),
            isNull(deepSearchJobs.cancelRequestedAt),
          ),
        )
        .run()
      if (result.changes !== 1) {
        throw new Error("Deep-search stop request lost its checked update")
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
