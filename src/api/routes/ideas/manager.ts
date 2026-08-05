import { randomUUID } from "node:crypto"
import { eq } from "drizzle-orm"

import { db } from "../../db/index.ts"
import { ideaJobs } from "../../db/schema/index.ts"
import { createReplayableEventLog } from "../../helpers/replayableEventLog.ts"
import type { DeepSearchJobManager } from "../deepSearch/manager.ts"
import { runIdeaJob } from "./run.ts"
import type { IdeaJobEvent, LiveIdeaJob } from "./schemas.ts"

type StartIdeaJobInput = {
  prompt: string
  numberOfIdeas: number
  deepSearchCount: number
  maxSearches: number
  maxResultsPerSearch: number
  maxRetries?: number
}

type StartedIdeaJob = {
  ideaJobId: string
  /** Rejects with the persisted pipeline error when idea generation fails. */
  completion: Promise<void>
}

type IdeaJobCreationTransaction = Parameters<
  Parameters<typeof db.transaction>[0]
>[0]

type StartIdeaJobOptions = {
  /** Creates an owning row atomically before the idea runner can start. */
  createRelated?: (
    transaction: IdeaJobCreationTransaction,
    ideaJobId: string,
  ) => void
}

export type IdeaJobManager = {
  start(input: StartIdeaJobInput, options?: StartIdeaJobOptions): StartedIdeaJob
  getLiveJob(ideaJobId: string): LiveIdeaJob | undefined
}

function requireCompletedIdeaJob(ideaJobId: string): void {
  const job = db
    .select({ status: ideaJobs.status, error: ideaJobs.error })
    .from(ideaJobs)
    .where(eq(ideaJobs.ideaJobId, ideaJobId))
    .get()

  if (!job) throw new Error("Idea job was not found")
  if (job.status !== "completed") {
    throw new Error(job.error ?? "Idea generation did not complete")
  }
}

function hasDurableTerminalState(ideaJobId: string): boolean {
  try {
    const job = db
      .select({ status: ideaJobs.status })
      .from(ideaJobs)
      .where(eq(ideaJobs.ideaJobId, ideaJobId))
      .get()
    return job?.status !== undefined && job.status !== "running"
  } catch {
    // Retain the closed log if durable replay cannot be proven safe.
    return false
  }
}

/** Owns durable idea jobs so direct and debate-initiated runs share one path. */
export function createIdeaJobManager(
  deepSearchManager: DeepSearchJobManager,
): IdeaJobManager {
  const liveJobs = new Map<string, LiveIdeaJob>()

  return {
    start(input, options) {
      const ideaJobId = randomUUID()
      const job = createReplayableEventLog<IdeaJobEvent>()

      db.transaction((transaction) => {
        transaction
          .insert(ideaJobs)
          .values({
            ideaJobId,
            prompt: input.prompt,
            numberOfIdeas: input.numberOfIdeas,
            deepSearchCount: input.deepSearchCount,
          })
          .run()
        options?.createRelated?.(transaction, ideaJobId)
      })
      liveJobs.set(ideaJobId, job)

      const completion = runIdeaJob({
        ideaJobId,
        ...input,
        job,
        deepSearchManager,
      })
        .then(() => requireCompletedIdeaJob(ideaJobId))
        .finally(() => {
          if (hasDurableTerminalState(ideaJobId)) liveJobs.delete(ideaJobId)
        })

      return { ideaJobId, completion }
    },
    getLiveJob(ideaJobId) {
      return liveJobs.get(ideaJobId)
    },
  }
}
