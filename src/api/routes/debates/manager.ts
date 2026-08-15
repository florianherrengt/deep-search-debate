import { randomBytes, randomUUID } from "node:crypto"
import { eq } from "drizzle-orm"

import { db } from "../../db/index.ts"
import { debateJobs } from "../../db/schema/index.ts"
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
import { interruptDebateJob } from "./jobLifecycle.ts"
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
      job: LiveDebateJob
      controller: AbortController
      completion: Promise<void>
    }
  >()

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
      const job = createReplayableEventLog<DebateJobEvent>()
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
      const completion = runDebateJob({
        debateJobId,
        userId,
        ideaJobId: ideaJob.ideaJobId,
        randomSeed,
        ideaCompletion: ideaJob.completion,
        job,
        workflowSignal: controller.signal,
      })
        .then(() => requireCompletedDebateJob(debateJobId))
        .finally(() => {
          if (hasDurableTerminalState(debateJobId)) {
            liveJobs.delete(debateJobId)
          }
        })
      liveJobs.set(debateJobId, { job, controller, completion })

      return {
        debateJobId,
        title: ideaJob.title,
        slug: ideaJob.slug,
        completion,
      }
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
