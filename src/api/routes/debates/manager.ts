import { randomBytes, randomUUID } from "node:crypto"
import { eq } from "drizzle-orm"

import { db } from "../../db/index.ts"
import { debateJobs } from "../../db/schema/index.ts"
import { createReplayableEventLog } from "../../helpers/replayableEventLog.ts"
import type { IdeaJobManager } from "../ideas/manager.ts"
import { runDebateJob } from "./run.ts"
import type { DebateJobEvent, LiveDebateJob } from "./schemas.ts"
import { DEBATE_TOURNAMENT_FORMAT } from "./tournament.ts"

type StartedDebateJob = {
  debateJobId: string
  title: string
  slug: string
  completion: Promise<void>
}

export type DebateJobManager = {
  start(
    userId: string,
    input: { prompt: string; isPublic: boolean },
  ): Promise<StartedDebateJob>
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
  const liveJobs = new Map<string, LiveDebateJob>()

  return {
    async start(userId, { isPublic, prompt }) {
      const debateJobId = randomUUID()
      const randomSeed = getRandomSeed()
      const job = createReplayableEventLog<DebateJobEvent>()
      const ideaJob = await ideaJobManager.start(
        userId,
        {
          prompt,
          numberOfIdeas: DEBATE_TOURNAMENT_FORMAT.participantCount,
          deepSearchCount: 2,
          maxSearches: 3,
          maxResultsPerSearch: 3,
          maxRetries: 0,
        },
        {
          createParent: (transaction) => {
            transaction
              .insert(debateJobs)
              .values({ debateJobId, userId, randomSeed, isPublic })
              .run()
            return { debateJobId }
          },
        },
      )
      liveJobs.set(debateJobId, job)

      const completion = runDebateJob({
        debateJobId,
        userId,
        ideaJobId: ideaJob.ideaJobId,
        randomSeed,
        ideaCompletion: ideaJob.completion,
        job,
      })
        .then(() => requireCompletedDebateJob(debateJobId))
        .finally(() => {
          if (hasDurableTerminalState(debateJobId)) {
            liveJobs.delete(debateJobId)
          }
        })

      return {
        debateJobId,
        title: ideaJob.title,
        slug: ideaJob.slug,
        completion,
      }
    },
    getLiveJob(debateJobId) {
      return liveJobs.get(debateJobId)
    },
  }
}
