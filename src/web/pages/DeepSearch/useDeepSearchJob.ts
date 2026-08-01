import { useEffect, useReducer } from "react"
import { subscribeToDeepSearchJob } from "../../lib/deepSearchJobs.ts"
import { getErrorMessage } from "../../lib/errors.ts"
import {
  deepSearchReducer,
  initialDeepSearchState,
} from "./deepSearchState.ts"

/** Replays and follows the durable job identified by the current URL. */
export function useDeepSearchJob(deepSearchJobId: string) {
  const [state, dispatch] = useReducer(
    deepSearchReducer,
    initialDeepSearchState,
  )

  useEffect(() => {
    const controller = new AbortController()
    dispatch({ type: "opened" })

    void (async () => {
      try {
        for await (const event of subscribeToDeepSearchJob(
          deepSearchJobId,
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
      }
    })()

    return () => controller.abort()
  }, [deepSearchJobId])

  return state
}
