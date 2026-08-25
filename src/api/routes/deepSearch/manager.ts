import { randomUUID } from "node:crypto"
import { eq } from "drizzle-orm"
import PQueue from "p-queue"
import { config } from "../../config.ts"
import { db } from "../../db/index.ts"
import {
  deepSearchJobs as deepSearchJobsTable,
} from "../../db/schema/index.ts"
import {
  createPromptIdentity,
  type PromptIdentity,
} from "../../helpers/promptTitles.ts"
import { createReplayableEventLog } from "../../helpers/replayableEventLog.ts"
import { addAbortableQueueTask } from "../../helpers/addAbortableQueueTask.ts"
import { generatePromptTitle } from "../../llms/generateText.ts"
import { reserveRootResearchCapacity } from "../researchCapacity.ts"
import { assertEffectiveResearchRootRunning } from "../researchCancellation.ts"
import {
  createWorkflowController,
  getWorkflowStopReason,
  WorkflowInterruptedError,
  workflowAbortReason,
} from "../../workflowRuntime.ts"
import {
  requestDeepSearchStop,
  type StopRequestResult,
} from "./cancellation.ts"
import { runDeepSearchJob } from "./run.ts"
import {
  interruptDeepSearchJob,
  reopenDeepSearchJob,
} from "./jobLifecycle.ts"
import { reconstructDeepSearchJobEvents } from "./replay.ts"
import {
  deepSearchExecutionInputSchema,
  type DeepSearchExecutionRequest,
} from "./resourceLimits.ts"
import type { DeepSearchJobEvent, LiveDeepSearchJob } from "./schemas.ts"

type StartDeepSearchJobInput = DeepSearchExecutionRequest & {
  title?: string
  ideaJobId?: string
  ideaJobPosition?: number
}

type StartedDeepSearchJob = {
  deepSearchJobId: string
  title: string
  slug: string
  /** Resolves to the persisted final answer, or rejects for any failed job. */
  completion: Promise<string>
}

type StartDeepSearchJobOptions = {
  /** Internal parent cancellation; never sourced from an HTTP request. */
  workflowSignal?: AbortSignal
}

const deepSearchJobQueue = new PQueue({
  concurrency: config.deepSearch.maxConcurrentJobs,
})

export type DeepSearchJobManager = {
  start(
    userId: string,
    input: StartDeepSearchJobInput,
    options?: StartDeepSearchJobOptions,
  ): Promise<StartedDeepSearchJob>
  resumeExisting(
    deepSearchJobId: string,
    options?: StartDeepSearchJobOptions & { userId?: string },
  ): StartedDeepSearchJob
  stop(userId: string, deepSearchJobId: string): StopRequestResult
  getLiveJob(deepSearchJobId: string): LiveDeepSearchJob | undefined
}

function createDeepSearchIdentity(generatedTitle: string): PromptIdentity {
  const usedSlugs = db
    .select({ slug: deepSearchJobsTable.slug })
    .from(deepSearchJobsTable)
    .all()
    .map(({ slug }) => slug)
  return createPromptIdentity(generatedTitle, usedSlugs)
}

function hasDurableTerminalState(deepSearchJobId: string): boolean {
  try {
    const job = db
      .select({ status: deepSearchJobsTable.status })
      .from(deepSearchJobsTable)
      .where(eq(deepSearchJobsTable.deepSearchJobId, deepSearchJobId))
      .get()
    return job?.status !== undefined && job.status !== "running"
  } catch {
    // A failed status read cannot prove that durable replay is safe. Retaining
    // the closed log preserves terminal events until the process restarts.
    return false
  }
}

/** Owns the live logs used by both direct and idea-pipeline deep searches. */
export function createDeepSearchJobManager(): DeepSearchJobManager {
  const liveJobs = new Map<
    string,
    {
      userId: string
      title: string
      slug: string
      job: LiveDeepSearchJob
      controller: AbortController
      completion: Promise<string>
      publishStopRequested: () => void
    }
  >()

  function schedulePersistedJob(
    persistedJob: typeof deepSearchJobsTable.$inferSelect,
    options?: StartDeepSearchJobOptions,
    replayEvents: DeepSearchJobEvent[] = [],
  ): StartedDeepSearchJob {
    const existing = liveJobs.get(persistedJob.deepSearchJobId)
    if (existing) {
      return {
        deepSearchJobId: persistedJob.deepSearchJobId,
        title: existing.title,
        slug: existing.slug,
        completion: existing.completion,
      }
    }

    const job = createReplayableEventLog<DeepSearchJobEvent>()
    for (const event of replayEvents) job.publish(event)
    const controller = createWorkflowController(options?.workflowSignal)
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

    let runnerStarted = false
    const completion = addAbortableQueueTask(
      deepSearchJobQueue,
      () => {
        runnerStarted = true
        return runDeepSearchJob(
          persistedJob.deepSearchJobId,
          persistedJob.userId,
          job,
          persistedJob.researchRequest,
          persistedJob.maxSearches,
          persistedJob.maxResultsPerSearch,
          persistedJob.maxRounds,
          controller.signal,
        )
      },
      controller.signal,
      { priority: persistedJob.ideaJobId === null ? 1 : 0 },
    )
      .catch((error: unknown) => {
        const stopReason = getWorkflowStopReason(controller.signal)
        if (!runnerStarted && stopReason) {
          const interrupted = new WorkflowInterruptedError(stopReason)
          interruptDeepSearchJob(
            persistedJob.deepSearchJobId,
            interrupted.message,
          )
          job.publish({ type: "interrupted", message: interrupted.message })
          job.publish({ type: "done" })
          job.close()
          throw interrupted
        }
        throw error
      })
      .finally(() => {
        if (hasDurableTerminalState(persistedJob.deepSearchJobId)) {
          // Existing subscribers retain their iterator. New subscribers use
          // durable replay instead of keeping every closed log in memory.
          liveJobs.delete(persistedJob.deepSearchJobId)
        }
      })

    liveJobs.set(persistedJob.deepSearchJobId, {
      userId: persistedJob.userId,
      title: persistedJob.title,
      slug: persistedJob.slug,
      job,
      controller,
      completion,
      publishStopRequested,
    })

    return {
      deepSearchJobId: persistedJob.deepSearchJobId,
      title: persistedJob.title,
      slug: persistedJob.slug,
      completion,
    }
  }

  return {
    async start(userId, input, options) {
      const validatedInput = deepSearchExecutionInputSchema.parse(input)
      const normalizedInput = { ...input, ...validatedInput }
      const isRootJob = normalizedInput.ideaJobId === undefined
      const releaseCapacity = isRootJob
        ? reserveRootResearchCapacity(userId, "deep-search")
        : undefined
      const deepSearchJobId = randomUUID()
      const controller = createWorkflowController(options?.workflowSignal)
      let identity: PromptIdentity
      try {
        const { title: suppliedTitle, ...persistedInput } = normalizedInput
        const generatedTitle =
          suppliedTitle ??
          (await generatePromptTitle(
            userId,
            normalizedInput.researchRequest,
            controller.signal,
          ))
        identity = createDeepSearchIdentity(generatedTitle)

        db.transaction((transaction) => {
          if (normalizedInput.ideaJobId !== undefined) {
            assertEffectiveResearchRootRunning(transaction, {
              kind: "idea",
              jobId: normalizedInput.ideaJobId,
            })
          }
          transaction
            .insert(deepSearchJobsTable)
            .values({
              deepSearchJobId,
              userId,
              ...identity,
              ...persistedInput,
              strictQuality: normalizedInput.ideaJobId !== undefined,
            })
            .run()
        })
      } finally {
        releaseCapacity?.()
      }

      const persistedJob = db
        .select()
        .from(deepSearchJobsTable)
        .where(eq(deepSearchJobsTable.deepSearchJobId, deepSearchJobId))
        .get()
      if (!persistedJob) throw new Error("Created deep-search job was not found")
      return schedulePersistedJob(persistedJob, {
        workflowSignal: controller.signal,
      })
    },
    resumeExisting: function resumeExisting(
      deepSearchJobId: string,
      options?: StartDeepSearchJobOptions & { userId?: string },
    ): StartedDeepSearchJob {
      const active = liveJobs.get(deepSearchJobId)
      if (active) {
        if (options?.userId !== undefined && active.userId !== options.userId) {
          throw new Error("Deep-search job was not found for the owner")
        }
        if (active.controller.signal.aborted) {
          const resumeAfterCleanup = () =>
            resumeExisting(deepSearchJobId, options).completion
          return {
            deepSearchJobId,
            title: active.title,
            slug: active.slug,
            completion: active.completion.then(
              resumeAfterCleanup,
              resumeAfterCleanup,
            ),
          }
        }
        return {
          deepSearchJobId,
          title: active.title,
          slug: active.slug,
          completion: active.completion,
        }
      }

      const persistedJob = db
        .select()
        .from(deepSearchJobsTable)
        .where(eq(deepSearchJobsTable.deepSearchJobId, deepSearchJobId))
        .get()
      if (
        !persistedJob ||
        (options?.userId !== undefined && persistedJob.userId !== options.userId)
      ) {
        throw new Error("Deep-search job was not found for the owner")
      }
      if (options?.userId !== undefined && persistedJob.ideaJobId !== null) {
        throw new Error("Only root deep-search jobs can be resumed")
      }
      const replayEvents = reconstructDeepSearchJobEvents(deepSearchJobId)
      if (!replayEvents) throw new Error("Deep-search job was not found")
      reopenDeepSearchJob({ jobId: deepSearchJobId, userId: options?.userId })
      return schedulePersistedJob(
        { ...persistedJob, status: "running", error: null, completedAt: null },
        options,
        replayEvents.filter(
          (event) =>
            event.type !== "stop-requested" &&
            event.type !== "error" &&
            event.type !== "interrupted" &&
            event.type !== "done",
        ),
      )
    },
    stop(userId, deepSearchJobId) {
      const result = requestDeepSearchStop(userId, deepSearchJobId)
      if (result.kind === "requested") {
        const active = liveJobs.get(deepSearchJobId)
        if (result.newlyRequested) active?.publishStopRequested()
        if (active) {
          active.controller.abort(workflowAbortReason("user-stop"))
        } else {
          interruptDeepSearchJob(
            deepSearchJobId,
            new WorkflowInterruptedError("user-stop").message,
          )
        }
      }
      return result
    },
    getLiveJob(deepSearchJobId) {
      return liveJobs.get(deepSearchJobId)?.job
    },
  }
}
