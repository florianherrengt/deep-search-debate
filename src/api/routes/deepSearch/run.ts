import { getErrorMessage } from "../../helpers/getErrorMessage.ts"
import {
  failDeepSearchJob,
  interruptDeepSearchJob,
} from "./jobLifecycle.ts"
import { runDeepSearchPipeline } from "./pipeline.ts"
import { type LiveDeepSearchJob } from "./schemas.ts"
import {
  getWorkflowStopReason,
  WorkflowFailure,
  WorkflowInterruptedError,
} from "../../workflowRuntime.ts"
import { EffectiveResearchRootInactiveError } from "../researchCancellation.ts"

function getCancellationReason(
  error: unknown,
  signal: AbortSignal | undefined,
): "user-stop" | "parent-stop" | undefined {
  const signalReason = getWorkflowStopReason(signal)
  if (signalReason) return signalReason
  if (error instanceof WorkflowInterruptedError) return error.reason
  if (error instanceof WorkflowFailure && error.cause !== undefined) {
    return getCancellationReason(error.cause, signal)
  }
  if (
    error instanceof EffectiveResearchRootInactiveError &&
    error.reason === "stop-requested"
  ) {
    return error.root?.kind === "deep-search" ? "user-stop" : "parent-stop"
  }
}

/** Runs and persists one job while retaining its exact live event sequence. */
export async function runDeepSearchJob(
  deepSearchJobId: string,
  userId: string,
  job: LiveDeepSearchJob,
  researchRequest: string,
  maxSearches: number,
  maxResultsPerSearch: number,
  maxRounds: number,
  workflowSignal?: AbortSignal,
): Promise<string> {
  try {
    return await runDeepSearchPipeline({
      userId,
      deepSearchJobId,
      researchRequest,
      maxSearches,
      maxResultsPerSearch,
      maxRounds,
      workflowSignal,
      publish: (event) => job.publish(event),
    })
  } catch (error) {
    const cancellationReason = getCancellationReason(error, workflowSignal)
    if (cancellationReason) {
      const interrupted = new WorkflowInterruptedError(cancellationReason)
      interruptDeepSearchJob(deepSearchJobId, interrupted.message)
      job.publish({ type: "interrupted", message: interrupted.message })
      throw interrupted
    }
    const errorMessage = getErrorMessage(error, "Deep search failed")
    try {
      failDeepSearchJob(deepSearchJobId, errorMessage)
    } catch (persistenceError) {
      console.error(
        `Failed to persist deep-search job ${deepSearchJobId} failure`,
        persistenceError,
      )
    }
    job.publish({ type: "error", message: errorMessage })
    throw error
  } finally {
    job.publish({ type: "done" })
    job.close()
  }
}
