import { randomUUID } from "node:crypto"
import { eq } from "drizzle-orm"

import { db } from "../../db/index.ts"
import { ideaJobs } from "../../db/schema/index.ts"
import {
  createPromptIdentity,
  type PromptIdentity,
} from "../../helpers/promptTitles.ts"
import { createReplayableEventLog } from "../../helpers/replayableEventLog.ts"
import { generatePromptTitle } from "../../llms/generateText.ts"
import type { DeepSearchJobManager } from "../deepSearch/manager.ts"
import { reserveRootResearchCapacity } from "../researchCapacity.ts"
import {
  createWorkflowController,
  getWorkflowStopReason,
  WorkflowInterruptedError,
  workflowAbortReason,
} from "../../workflowRuntime.ts"
import {
  requestIdeaStop,
  type IdeaStopRequestResult,
} from "./cancellation.ts"
import { runIdeaJob } from "./run.ts"
import { interruptIdeaJob, reopenIdeaJob } from "./jobLifecycle.ts"
import { reconstructIdeaJobEvents } from "./replay.ts"
import {
  createIdeaJobInputSchema,
  type CreateIdeaJobRequest,
  type IdeaJobEvent,
  type LiveIdeaJob,
} from "./schemas.ts"

type StartIdeaJobInput = CreateIdeaJobRequest & {
  title?: string
}

type StartedIdeaJob = {
  ideaJobId: string
  title: string
  slug: string
  /** Rejects with the persisted pipeline error when idea generation fails. */
  completion: Promise<void>
}

type IdeaJobCreationTransaction = Parameters<
  Parameters<typeof db.transaction>[0]
>[0]

type StartIdeaJobOptions = {
  /** Creates an optional parent before the owned idea row is inserted. */
  createParent?: (
    transaction: IdeaJobCreationTransaction,
    ideaJobId: string,
  ) => { debateJobId: string }
  /** Internal parent cancellation; never sourced from an HTTP request. */
  workflowSignal?: AbortSignal
}

export type IdeaJobManager = {
  start(
    userId: string,
    input: StartIdeaJobInput,
    options?: StartIdeaJobOptions,
  ): Promise<StartedIdeaJob>
  resumeExisting(
    ideaJobId: string,
    options?: Pick<StartIdeaJobOptions, "workflowSignal"> & { userId?: string },
  ): StartedIdeaJob
  stop(userId: string, ideaJobId: string): IdeaStopRequestResult
  getLiveJob(ideaJobId: string): LiveIdeaJob | undefined
}

function createIdeaIdentity(generatedTitle: string): PromptIdentity {
  const usedSlugs = db
    .select({ slug: ideaJobs.slug })
    .from(ideaJobs)
    .all()
    .map(({ slug }) => slug)
  return createPromptIdentity(generatedTitle, usedSlugs)
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
  const liveJobs = new Map<
    string,
    {
      userId: string
      title: string
      slug: string
      job: LiveIdeaJob
      controller: AbortController
      completion: Promise<void>
      publishStopRequested: () => void
    }
  >()

  function schedulePersistedJob(
    persistedJob: typeof ideaJobs.$inferSelect,
    options?: {
      controller?: AbortController
      workflowSignal?: AbortSignal
      replayEvents?: IdeaJobEvent[]
    },
  ): StartedIdeaJob {
    const existing = liveJobs.get(persistedJob.ideaJobId)
    if (existing) {
      return {
        ideaJobId: persistedJob.ideaJobId,
        title: existing.title,
        slug: existing.slug,
        completion: existing.completion,
      }
    }

    const job = createReplayableEventLog<IdeaJobEvent>()
    for (const event of options?.replayEvents ?? []) job.publish(event)
    const controller =
      options?.controller ?? createWorkflowController(options?.workflowSignal)
    let stopRequestedPublished = false
    const publishStopRequested = () => {
      if (stopRequestedPublished) return
      stopRequestedPublished = true
      try {
        job.publish({ type: "stop-requested" })
      } catch {
        // Durable replay remains authoritative if the retained log closed.
      }
    }
    controller.signal.addEventListener(
      "abort",
      () => {
        if (getWorkflowStopReason(controller.signal) === "parent-stop") {
          publishStopRequested()
        }
      },
      { once: true },
    )
    const completion = runIdeaJob({
      ideaJobId: persistedJob.ideaJobId,
      userId: persistedJob.userId,
      prompt: persistedJob.prompt,
      numberOfIdeas: persistedJob.numberOfIdeas,
      deepSearchCount: persistedJob.deepSearchCount,
      maxSearches: persistedJob.maxSearches,
      maxResultsPerSearch: persistedJob.maxResultsPerSearch,
      maxRounds: persistedJob.maxRounds,
      job,
      deepSearchManager,
      workflowSignal: controller.signal,
    })
      .then(() => requireCompletedIdeaJob(persistedJob.ideaJobId))
      .finally(() => {
        if (hasDurableTerminalState(persistedJob.ideaJobId)) {
          liveJobs.delete(persistedJob.ideaJobId)
        }
      })
    liveJobs.set(persistedJob.ideaJobId, {
      userId: persistedJob.userId,
      title: persistedJob.title,
      slug: persistedJob.slug,
      job,
      controller,
      completion,
      publishStopRequested,
    })
    return {
      ideaJobId: persistedJob.ideaJobId,
      title: persistedJob.title,
      slug: persistedJob.slug,
      completion,
    }
  }

  return {
    async start(userId, input, options) {
      const validatedInput = createIdeaJobInputSchema.parse(input)
      const normalizedInput = { ...input, ...validatedInput }
      const releaseCapacity = reserveRootResearchCapacity(
        userId,
        options?.createParent ? "debate" : "idea",
      )
      const ideaJobId = randomUUID()
      const controller = createWorkflowController(options?.workflowSignal)
      const { title: suppliedTitle } = normalizedInput
      let identity: PromptIdentity
      try {
        const generatedTitle =
          suppliedTitle ??
          (await generatePromptTitle(
            userId,
            normalizedInput.prompt,
            controller.signal,
          ))
        identity = createIdeaIdentity(generatedTitle)

        db.transaction((transaction) => {
          const parent = options?.createParent?.(transaction, ideaJobId)
          transaction
            .insert(ideaJobs)
            .values({
              ideaJobId,
              userId,
              ...parent,
              ...identity,
              prompt: normalizedInput.prompt,
              numberOfIdeas: normalizedInput.numberOfIdeas,
              deepSearchCount: normalizedInput.deepSearchCount,
              maxSearches: normalizedInput.maxSearches,
              maxResultsPerSearch: normalizedInput.maxResultsPerSearch,
              maxRounds: normalizedInput.maxRounds,
            })
            .run()
        })
      } finally {
        releaseCapacity()
      }
      const persistedJob = db
        .select()
        .from(ideaJobs)
        .where(eq(ideaJobs.ideaJobId, ideaJobId))
        .get()
      if (!persistedJob) throw new Error("Created idea job was not found")
      return schedulePersistedJob(persistedJob, { controller })
    },
    resumeExisting: function resumeExisting(
      ideaJobId: string,
      options?: Pick<StartIdeaJobOptions, "workflowSignal"> & {
        userId?: string
      },
    ): StartedIdeaJob {
      const active = liveJobs.get(ideaJobId)
      if (active) {
        if (options?.userId !== undefined && active.userId !== options.userId) {
          throw new Error("Idea job was not found for the owner")
        }
        if (active.controller.signal.aborted) {
          const resumeAfterCleanup = () =>
            resumeExisting(ideaJobId, options).completion
          return {
            ideaJobId,
            title: active.title,
            slug: active.slug,
            completion: active.completion.then(
              resumeAfterCleanup,
              resumeAfterCleanup,
            ),
          }
        }
        return {
          ideaJobId,
          title: active.title,
          slug: active.slug,
          completion: active.completion,
        }
      }

      const persistedJob = db
        .select()
        .from(ideaJobs)
        .where(eq(ideaJobs.ideaJobId, ideaJobId))
        .get()
      if (
        !persistedJob ||
        (options?.userId !== undefined && persistedJob.userId !== options.userId)
      ) {
        throw new Error("Idea job was not found for the owner")
      }
      if (options?.userId !== undefined && persistedJob.debateJobId !== null) {
        throw new Error("Only root idea jobs can be resumed")
      }
      if (persistedJob.status === "completed") {
        if (options?.userId !== undefined) {
          throw new Error("Completed idea jobs cannot be resumed")
        }
        return {
          ideaJobId,
          title: persistedJob.title,
          slug: persistedJob.slug,
          completion: Promise.resolve(),
        }
      }
      const replayEvents = reconstructIdeaJobEvents(ideaJobId)
      if (!replayEvents) throw new Error("Idea job was not found")
      reopenIdeaJob(ideaJobId)
      return schedulePersistedJob(
        { ...persistedJob, status: "running", error: null, completedAt: null },
        {
          workflowSignal: options?.workflowSignal,
          replayEvents: replayEvents.filter(
            (event) =>
              event.type !== "stop-requested" &&
              event.type !== "interrupted" &&
              event.type !== "error" &&
              event.type !== "done",
          ),
        },
      )
    },
    stop(userId, ideaJobId) {
      const result = requestIdeaStop(userId, ideaJobId)
      if (result.kind === "requested") {
        const active = liveJobs.get(ideaJobId)
        if (result.newlyRequested) active?.publishStopRequested()
        if (active) {
          active.controller.abort(workflowAbortReason("user-stop"))
        } else {
          interruptIdeaJob(
            ideaJobId,
            new WorkflowInterruptedError("user-stop").message,
          )
        }
      }
      return result
    },
    getLiveJob(ideaJobId) {
      return liveJobs.get(ideaJobId)?.job
    },
  }
}
