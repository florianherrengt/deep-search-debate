import { eq } from "drizzle-orm"

import { db } from "../db/index.ts"
import {
  debateJobs,
  deepSearchJobs,
  ideaJobs,
} from "../db/schema/index.ts"
import type { jobStatuses } from "../db/schema/statuses.ts"

type ResearchWorkflowKind = "deep-search" | "idea" | "debate"
export type ResearchJobStatus = (typeof jobStatuses)[number]
export type ResearchWorkflowReference = {
  kind: ResearchWorkflowKind
  jobId: string
}

export type EffectiveResearchRoot = {
  kind: ResearchWorkflowKind
  jobId: string
  userId: string
  status: ResearchJobStatus
  cancelRequestedAt: Date | null
}

type ResearchJobLifecycle = {
  status: ResearchJobStatus
  cancelRequestedAt: Date | null
  completedAt: Date | null
}

/** Distinguishes work affected by a Stop from work terminal before a later
 * ancestor Stop. Interrupted descendants settle after the root timestamp. */
export function stopRequestAppliesToJob({
  status,
  cancelRequestedAt,
  completedAt,
}: ResearchJobLifecycle): boolean {
  if (cancelRequestedAt === null) return false
  if (status === "running") return true
  return (
    status === "interrupted" &&
    completedAt !== null &&
    cancelRequestedAt.getTime() <= completedAt.getTime()
  )
}

export type ResearchTransaction = Parameters<
  Parameters<typeof db.transaction>[0]
>[0]

/** Resolves the only row allowed to store cancellation for a workflow tree. */
export function resolveEffectiveResearchRoot(
  transaction: ResearchTransaction,
  reference: ResearchWorkflowReference,
): EffectiveResearchRoot | undefined {
  if (reference.kind === "debate") {
    const row = transaction
      .select({
        jobId: debateJobs.debateJobId,
        userId: debateJobs.userId,
        status: debateJobs.status,
        cancelRequestedAt: debateJobs.cancelRequestedAt,
      })
      .from(debateJobs)
      .where(eq(debateJobs.debateJobId, reference.jobId))
      .get()
    return row ? { kind: "debate", ...row } : undefined
  }

  if (reference.kind === "idea") {
    const row = transaction
      .select({
        ideaJobId: ideaJobs.ideaJobId,
        ideaUserId: ideaJobs.userId,
        ideaStatus: ideaJobs.status,
        ideaCancelRequestedAt: ideaJobs.cancelRequestedAt,
        debateJobId: debateJobs.debateJobId,
        debateUserId: debateJobs.userId,
        debateStatus: debateJobs.status,
        debateCancelRequestedAt: debateJobs.cancelRequestedAt,
      })
      .from(ideaJobs)
      .leftJoin(debateJobs, eq(ideaJobs.debateJobId, debateJobs.debateJobId))
      .where(eq(ideaJobs.ideaJobId, reference.jobId))
      .get()
    if (!row) return undefined
    return row.debateJobId === null
      ? {
          kind: "idea",
          jobId: row.ideaJobId,
          userId: row.ideaUserId,
          status: row.ideaStatus,
          cancelRequestedAt: row.ideaCancelRequestedAt,
        }
      : {
          kind: "debate",
          jobId: row.debateJobId,
          userId: row.debateUserId!,
          status: row.debateStatus!,
          cancelRequestedAt: row.debateCancelRequestedAt,
        }
  }

  const row = transaction
    .select({
      deepSearchJobId: deepSearchJobs.deepSearchJobId,
      deepSearchUserId: deepSearchJobs.userId,
      deepSearchStatus: deepSearchJobs.status,
      deepSearchCancelRequestedAt: deepSearchJobs.cancelRequestedAt,
      ideaJobId: ideaJobs.ideaJobId,
      ideaUserId: ideaJobs.userId,
      ideaStatus: ideaJobs.status,
      ideaCancelRequestedAt: ideaJobs.cancelRequestedAt,
      debateJobId: debateJobs.debateJobId,
      debateUserId: debateJobs.userId,
      debateStatus: debateJobs.status,
      debateCancelRequestedAt: debateJobs.cancelRequestedAt,
    })
    .from(deepSearchJobs)
    .leftJoin(ideaJobs, eq(deepSearchJobs.ideaJobId, ideaJobs.ideaJobId))
    .leftJoin(debateJobs, eq(ideaJobs.debateJobId, debateJobs.debateJobId))
    .where(eq(deepSearchJobs.deepSearchJobId, reference.jobId))
    .get()
  if (!row) return undefined
  if (row.debateJobId !== null) {
    return {
      kind: "debate",
      jobId: row.debateJobId,
      userId: row.debateUserId!,
      status: row.debateStatus!,
      cancelRequestedAt: row.debateCancelRequestedAt,
    }
  }
  if (row.ideaJobId !== null) {
    return {
      kind: "idea",
      jobId: row.ideaJobId,
      userId: row.ideaUserId!,
      status: row.ideaStatus!,
      cancelRequestedAt: row.ideaCancelRequestedAt,
    }
  }
  return {
    kind: "deep-search",
    jobId: row.deepSearchJobId,
    userId: row.deepSearchUserId,
    status: row.deepSearchStatus,
    cancelRequestedAt: row.deepSearchCancelRequestedAt,
  }
}

export class EffectiveResearchRootInactiveError extends Error {
  readonly reason: "not-found" | "stop-requested" | "terminal"
  readonly root: EffectiveResearchRoot | undefined

  constructor(
    reason: "not-found" | "stop-requested" | "terminal",
    root?: EffectiveResearchRoot,
  ) {
    super(`Effective research root is ${reason}`)
    this.name = "EffectiveResearchRootInactiveError"
    this.reason = reason
    this.root = root
  }
}

/** Transactional guard for any command about to create durable workflow work. */
export function assertEffectiveResearchRootRunning(
  transaction: ResearchTransaction,
  reference: ResearchWorkflowReference,
): EffectiveResearchRoot {
  const root = resolveEffectiveResearchRoot(transaction, reference)
  if (!root) throw new EffectiveResearchRootInactiveError("not-found")
  if (root.cancelRequestedAt !== null) {
    throw new EffectiveResearchRootInactiveError("stop-requested", root)
  }
  if (root.status !== "running") {
    throw new EffectiveResearchRootInactiveError("terminal", root)
  }
  return root
}
