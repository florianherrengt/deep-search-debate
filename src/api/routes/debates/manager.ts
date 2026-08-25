import { randomBytes, randomUUID } from "node:crypto"
import { eq } from "drizzle-orm"

import { db } from "../../db/index.ts"
import { debateJobs, ideaJobs } from "../../db/schema/index.ts"
import { createReplayableEventLog } from "../../helpers/replayableEventLog.ts"
import type { IdeaJobManager } from "../ideas/manager.ts"
import {
  createWorkflowController,
  WorkflowInterruptedError,
  workflowAbortReason,
} from "../../workflowRuntime.ts"
import {
  requestDebateStop,
  type DebateStopRequestResult,
} from "./cancellation.ts"
import { runDebateJob } from "./run.ts"
import { interruptDebateJob, reopenDebateJob } from "./jobLifecycle.ts"
import {
  createDebateJobInputSchema,
  type CreateDebateJobRequest,
  type DebateJobEvent,
  type LiveDebateJob,
} from "./schemas.ts"

type StartedDebateJob = {
  debateJobId: string
  title: string
  slug: string
  completion: Promise<void>
}

export type DebateJobManager = {
  start(
    userId: string,
    input: CreateDebateJobRequest,
  ): Promise<StartedDebateJob>
  resumeExisting(
    debateJobId: string,
    options?: { userId?: string },
  ): StartedDebateJob
  stop(userId: string, debateJobId: string): DebateStopRequestResult
  getLiveJob(debateJobId: string): LiveDebateJob | undefined
}

function getRandomSeed(): number {
  return randomBytes(4).readUInt32BE(0)
}

function requireCompletedDebateJob(debateJobId: string): void {
  const job = db
    .select({ status: debateJobs.status, error: debateJobs.error })
    .from(debateJobs)
    .where(eq(debateJobs.debateJobId, debateJobId))
    .get()
  if (!job) throw new Error("Debate job was not found")
  if (job.status !== "completed") {
    throw new Error(job.error ?? "Debate tournament did not complete")
  }
}

function hasDurableTerminalState(debateJobId: string): boolean {
  try {
    const job = db
      .select({ status: debateJobs.status })
      .from(debateJobs)
      .where(eq(debateJobs.debateJobId, debateJobId))
      .get()
    return job?.status !== undefined && job.status !== "running"
  } catch {
    return false
  }
}

/** Owns the live orchestration log while SQLite remains the replay source. */
export function createDebateJobManager(
  ideaJobManager: IdeaJobManager,
): DebateJobManager {
  const liveJobs = new Map<
    string,
    {
      userId: string
      title: string
      slug: string
      job: LiveDebateJob
      controller: AbortController
      completion: Promise<void>
    }
  >()

  function schedulePersistedJob(
    persistedJob: {
      debateJobId: string
      userId: string
      title: string
      slug: string
    },
    input?: { controller?: AbortController; seedFromPersistence?: boolean },
  ): StartedDebateJob {
    const existing = liveJobs.get(persistedJob.debateJobId)
    if (existing) {
      return {
        debateJobId: persistedJob.debateJobId,
        title: existing.title,
        slug: existing.slug,
        completion: existing.completion,
      }
    }

    const job = createReplayableEventLog<DebateJobEvent>()
    if (input?.seedFromPersistence) job.publish({ type: "updated" })
    const controller = input?.controller ?? createWorkflowController()
    const completion = runDebateJob({
      debateJobId: persistedJob.debateJobId,
      ideaJobManager,
      job,
      workflowSignal: controller.signal,
    })
      .then(() => requireCompletedDebateJob(persistedJob.debateJobId))
      .finally(() => {
        if (hasDurableTerminalState(persistedJob.debateJobId)) {
          liveJobs.delete(persistedJob.debateJobId)
        }
      })
    liveJobs.set(persistedJob.debateJobId, {
      userId: persistedJob.userId,
      title: persistedJob.title,
      slug: persistedJob.slug,
      job,
      controller,
      completion,
    })
    return {
      debateJobId: persistedJob.debateJobId,
      title: persistedJob.title,
      slug: persistedJob.slug,
      completion,
    }
  }

  return {
    async start(userId, input) {
      const {
        deepSearchCount,
        isPublic,
        maxResultsPerSearch,
        maxRounds,
        maxSearches,
        numberOfIdeas,
        prompt,
      } = createDebateJobInputSchema.parse(input)
      const debateJobId = randomUUID()
      const randomSeed = getRandomSeed()
      const controller = createWorkflowController()
      const ideaJob = await ideaJobManager.start(
        userId,
        {
          prompt,
          numberOfIdeas,
          deepSearchCount,
          maxSearches,
          maxResultsPerSearch,
          maxRounds,
        },
        {
          workflowSignal: controller.signal,
          createParent: (transaction) => {
            transaction
              .insert(debateJobs)
              .values({ debateJobId, userId, randomSeed, isPublic })
              .run()
            return { debateJobId }
          },
        },
      )
      return schedulePersistedJob({
        debateJobId,
        userId,
        title: ideaJob.title,
        slug: ideaJob.slug,
      }, { controller })
    },
    resumeExisting: function resumeExisting(
      debateJobId: string,
      options?: { userId?: string },
    ): StartedDebateJob {
      const active = liveJobs.get(debateJobId)
      if (active) {
        if (options?.userId !== undefined && active.userId !== options.userId) {
          throw new Error("Debate job was not found for the owner")
        }
        if (active.controller.signal.aborted) {
          const resumeAfterCleanup = () =>
            resumeExisting(debateJobId, options).completion
          return {
            debateJobId,
            title: active.title,
            slug: active.slug,
            completion: active.completion.then(
              resumeAfterCleanup,
              resumeAfterCleanup,
            ),
          }
        }
        return {
          debateJobId,
          title: active.title,
          slug: active.slug,
          completion: active.completion,
        }
      }

      const persistedJob = db
        .select({
          debateJobId: debateJobs.debateJobId,
          userId: debateJobs.userId,
          title: ideaJobs.title,
          slug: ideaJobs.slug,
          status: debateJobs.status,
        })
        .from(debateJobs)
        .innerJoin(ideaJobs, eq(ideaJobs.debateJobId, debateJobs.debateJobId))
        .where(eq(debateJobs.debateJobId, debateJobId))
        .get()
      if (
        !persistedJob ||
        (options?.userId !== undefined && persistedJob.userId !== options.userId)
      ) {
        throw new Error("Debate job was not found for the owner")
      }
      reopenDebateJob(debateJobId)
      return schedulePersistedJob(persistedJob, { seedFromPersistence: true })
    },
    stop(userId, debateJobId) {
      const result = requestDebateStop(userId, debateJobId)
      if (result.kind === "requested") {
        const active = liveJobs.get(debateJobId)
        if (result.newlyRequested) {
          try {
            active?.job.publish({ type: "updated" })
          } catch {
            // Durable replay remains authoritative if the retained log closed.
          }
        }
        if (active) {
          active.controller.abort(workflowAbortReason("user-stop"))
        } else {
          interruptDebateJob(
            debateJobId,
            new WorkflowInterruptedError("user-stop").message,
          )
        }
      }
      return result
    },
    getLiveJob(debateJobId) {
      return liveJobs.get(debateJobId)?.job
    },
  }
}
