import { randomUUID } from "node:crypto"
import { and, eq } from "drizzle-orm"
import PQueue from "p-queue"
import { config } from "../../config.ts"
import { db } from "../../db/index.ts"
import {
  deepSearchJobs as deepSearchJobsTable,
  deepSearchQueries,
  deepSearchRounds,
  deepSearchWebPages,
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
import { interruptDeepSearchJob } from "./jobLifecycle.ts"
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

function getParentQualityFailure(deepSearchJobId: string): string | undefined {
  const failedQuery = db
    .select({ message: deepSearchQueries.errorMessage })
    .from(deepSearchQueries)
    .innerJoin(
      deepSearchRounds,
      eq(deepSearchQueries.deepSearchRoundId, deepSearchRounds.deepSearchRoundId),
    )
    .where(
      and(
        eq(deepSearchRounds.deepSearchJobId, deepSearchJobId),
        eq(deepSearchQueries.status, "failed"),
      ),
    )
    .get()
  if (failedQuery) return failedQuery.message ?? "Research query failed"

  const failedPage = db
    .select({ message: deepSearchWebPages.errorMessage })
    .from(deepSearchWebPages)
    .where(
      and(
        eq(deepSearchWebPages.deepSearchJobId, deepSearchJobId),
        eq(deepSearchWebPages.status, "failed"),
        // Source availability is outside our control. Extraction failures
        // retain their snippet fallback and do not invalidate the research;
        // a failed model-generated page summary remains an internal failure.
        eq(deepSearchWebPages.errorStage, "summary"),
      ),
    )
    .get()
  return failedPage?.message ?? (failedPage ? "Research page failed" : undefined)
}

export type DeepSearchJobManager = {
  start(
    userId: string,
    input: StartDeepSearchJobInput,
    options?: StartDeepSearchJobOptions,
  ): Promise<StartedDeepSearchJob>
  stop(userId: string, deepSearchJobId: string): StopRequestResult
  /** Applies the idea pipeline's stricter policy after durable completion. */
  requireParentQualityAcceptance(deepSearchJobId: string): void
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

/** Applies parent-only quality policy without redefining durable job success. */
function requireParentQualityAcceptance(deepSearchJobId: string): void {
  const job = db
    .select({
      status: deepSearchJobsTable.status,
      error: deepSearchJobsTable.error,
    })
    .from(deepSearchJobsTable)
    .where(eq(deepSearchJobsTable.deepSearchJobId, deepSearchJobId))
    .get()

  if (!job) throw new Error("Deep search job was not found")
  if (job.status !== "completed") {
    throw new Error(job.error ?? "Deep search did not complete")
  }
  // Blocked or unavailable pages are expected research misses and already fall
  // back to search snippets. The idea pipeline only rejects failures in work we
  // control: query processing and model-generated page summaries.
  const qualityFailure = getParentQualityFailure(deepSearchJobId)
  if (qualityFailure) throw new Error(qualityFailure)
}

/** Owns the live logs used by both direct and idea-pipeline deep searches. */
export function createDeepSearchJobManager(): DeepSearchJobManager {
  const liveJobs = new Map<
    string,
    {
      job: LiveDeepSearchJob
      controller: AbortController
      completion: Promise<string>
      publishStopRequested: () => void
    }
  >()

  return {
    async start(userId, input, options) {
      const validatedInput = deepSearchExecutionInputSchema.parse(input)
      const normalizedInput = { ...input, ...validatedInput }
      const isRootJob = normalizedInput.ideaJobId === undefined
      const releaseCapacity = isRootJob
        ? reserveRootResearchCapacity(userId, "deep-search")
        : undefined
      const deepSearchJobId = randomUUID()
      const job = createReplayableEventLog<DeepSearchJobEvent>()
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
            .values({ deepSearchJobId, userId, ...identity, ...persistedInput })
            .run()
        })
      } finally {
        releaseCapacity?.()
      }

      // The route serving child events reads this same log while the durable
      // database rows remain the source used after a process restart.
      // A newly admitted root should not wait behind an entire eagerly queued
      // child batch. Running jobs are never pre-empted.
      let runnerStarted = false
      const completion = addAbortableQueueTask(
        deepSearchJobQueue,
        () => {
          runnerStarted = true
          return runDeepSearchJob(
            deepSearchJobId,
            userId,
            job,
            normalizedInput.researchRequest,
            normalizedInput.maxSearches,
            normalizedInput.maxResultsPerSearch,
            normalizedInput.maxRounds,
            controller.signal,
          )
        },
        controller.signal,
        { priority: isRootJob ? 1 : 0 },
      ).catch((error: unknown) => {
        const stopReason = getWorkflowStopReason(controller.signal)
        if (!runnerStarted && stopReason) {
          const interrupted = new WorkflowInterruptedError(stopReason)
          interruptDeepSearchJob(deepSearchJobId, interrupted.message)
          job.publish({ type: "interrupted", message: interrupted.message })
          job.publish({ type: "done" })
          job.close()
          throw interrupted
        }
        throw error
      })
        .finally(() => {
          if (hasDurableTerminalState(deepSearchJobId)) {
            // Existing subscribers retain their iterator. New subscribers use
            // durable replay instead of keeping every closed log in memory.
            liveJobs.delete(deepSearchJobId)
          }
        })
      liveJobs.set(deepSearchJobId, {
        job,
        controller,
        completion,
        publishStopRequested,
      })

      return { deepSearchJobId, ...identity, completion }
    },
    requireParentQualityAcceptance,
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
