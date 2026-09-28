import { randomBytes, randomUUID } from "node:crypto"
import { and, eq, isNull } from "drizzle-orm"
import { HTTPException } from "hono/http-exception"

import { db } from "../../db/index.ts"
import { debateJobs, ideaJobs } from "../../db/schema/index.ts"
import { createReplayableEventLog } from "../../helpers/replayableEventLog.ts"
import type { IdeaJobManager } from "../ideas/manager.ts"
import { reserveRootResearchCapacity } from "../researchCapacity.ts"
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
  startFromIdeas(userId: string, ideaJobId: string): Promise<StartedDebateJob>
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
    async startFromIdeas(userId, ideaJobId) {
      const pending = db.select().from(ideaJobs)
        .where(and(eq(ideaJobs.ideaJobId, ideaJobId), eq(ideaJobs.userId, userId))).get()
      if (!pending) throw new HTTPException(404, { message: "Idea job not found" })
      // Settle the old execution before its ready state is changed to running.
      if (pending.status === "ready" && ideaJobManager.getLiveJob(ideaJobId)) {
        await ideaJobManager.resumeExisting(ideaJobId).completion
      }
      let releaseCapacity: (() => void) | undefined
      let started: { debateJobId: string; title: string; slug: string; created: boolean }
      try {
        started = db.transaction((transaction) => {
          // The write lock makes concurrent Start requests observe one parent.
          const ideaJob = transaction.select().from(ideaJobs)
            .where(and(eq(ideaJobs.ideaJobId, ideaJobId), eq(ideaJobs.userId, userId))).get()
          if (!ideaJob) throw new HTTPException(404, { message: "Idea job not found" })
          if (ideaJob.debateJobId !== null) {
            return { debateJobId: ideaJob.debateJobId, title: ideaJob.title, slug: ideaJob.slug, created: false }
          }
          if (ideaJob.workflow !== "discovery" || ideaJob.status !== "ready") {
            throw new HTTPException(409, { message: "Ideas must be ready before starting a debate" })
          }
          if (!createDebateJobInputSchema.safeParse(ideaJob).success) {
            throw new HTTPException(409, { message: "Saved ideas exceed the debate research limits" })
          }
          releaseCapacity = reserveRootResearchCapacity(userId)
          const debateJobId = randomUUID()
          transaction.insert(debateJobs).values({ debateJobId, userId, randomSeed: getRandomSeed() }).run()
          const linked = transaction.update(ideaJobs)
            .set({ debateJobId, status: "running" })
            .where(and(eq(ideaJobs.ideaJobId, ideaJobId), eq(ideaJobs.userId, userId),
              eq(ideaJobs.workflow, "discovery"), eq(ideaJobs.status, "ready"),
              isNull(ideaJobs.debateJobId), isNull(ideaJobs.cancelRequestedAt))).run()
          if (linked.changes !== 1) throw new HTTPException(409, { message: "Ideas are no longer ready to start a debate" })
          return { debateJobId, title: ideaJob.title, slug: ideaJob.slug, created: true }
        }, { behavior: "immediate" })
      } finally {
        releaseCapacity?.()
      }
      const { debateJobId, title, slug, created } = started
      return created
        ? schedulePersistedJob({ debateJobId, userId, title, slug })
        : { debateJobId, title, slug, completion: Promise.resolve() }
    },
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
