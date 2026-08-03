import { useEffect, useReducer } from "react"
import { subscribeToIdeaJob } from "../../lib/ideaJobs.ts"
import { getErrorMessage } from "../../lib/errors.ts"
import { ideaJobReducer, initialIdeaJobState } from "./ideaJobState.ts"

export function useIdeaJob(ideaJobId: string) {
  const [state, dispatch] = useReducer(ideaJobReducer, initialIdeaJobState)

  useEffect(() => {
    const controller = new AbortController()
    dispatch({ type: "opened" })

    void (async () => {
      try {
        for await (const event of subscribeToIdeaJob(
          ideaJobId,
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
  }, [ideaJobId])

  return state
}
