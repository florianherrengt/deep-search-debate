import { getErrorMessage } from "../../helpers/getErrorMessage.ts"
import { failDeepSearchJob } from "./jobLifecycle.ts"
import { runDeepSearchPipeline } from "./pipeline.ts"
import { type LiveDeepSearchJob } from "./schemas.ts"

/** Runs and persists one job while retaining its exact live event sequence. */
export async function runDeepSearchJob(
  deepSearchJobId: string,
  userId: string,
  job: LiveDeepSearchJob,
  researchRequest: string,
  maxSearches: number,
  maxResultsPerSearch: number,
  maxRounds: number,
): Promise<string> {
  try {
    return await runDeepSearchPipeline({
      userId,
      deepSearchJobId,
      researchRequest,
      maxSearches,
      maxResultsPerSearch,
      maxRounds,
      publish: (event) => job.publish(event),
    })
  } catch (error) {
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
