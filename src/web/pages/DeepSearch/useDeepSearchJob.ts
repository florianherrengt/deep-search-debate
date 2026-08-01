import { useEffect, useReducer, useRef } from "react"
import {
  createDeepSearchJob,
  subscribeToDeepSearchJob,
} from "../../lib/deepSearchJobs.ts"
import { getErrorMessage } from "../../lib/errors.ts"
import {
  deepSearchReducer,
  initialDeepSearchState,
} from "./deepSearchState.ts"

/**
 * Owns creation, cancellation, and replay-and-follow consumption for the active
 * deep-search job. Text-stream content remains owned by `useTextStream` consumers.
 */
export function useDeepSearchJob() {
  const [state, dispatch] = useReducer(
    deepSearchReducer,
    initialDeepSearchState,
  )
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => () => abortRef.current?.abort(), [])

  const start = async (researchRequest: string): Promise<void> => {
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    dispatch({ type: "started" })

    try {
      const jobId = await createDeepSearchJob(
        { researchRequest },
        controller.signal,
      )
      dispatch({ type: "created", jobId })

      for await (const event of subscribeToDeepSearchJob(
        jobId,
        controller.signal,
      )) {
        dispatch(event)
      }
    } catch (error) {
      if (!controller.signal.aborted) {
        dispatch({
          type: "request-failed",
          message: getErrorMessage(error),
        })
      }
    } finally {
      if (abortRef.current === controller) abortRef.current = null
    }
  }

  return { state, start }
}
