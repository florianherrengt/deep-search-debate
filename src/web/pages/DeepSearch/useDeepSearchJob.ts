import { useEffect, useReducer, useState } from "react"
import { subscribeToDeepSearchJob } from "../../lib/deepSearchJobs.ts"
import { followReplayableStream } from "../../lib/replayStream.ts"
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
  const [observedSubscriptionError, setObservedSubscriptionError] = useState<{
    deepSearchJobId: string
    message: string
  } | null>(null)
  const subscriptionError =
    observedSubscriptionError?.deepSearchJobId === deepSearchJobId
      ? observedSubscriptionError.message
      : null

  useEffect(() => {
    const controller = new AbortController()
    dispatch({ type: "opened" })

    void followReplayableStream({
      signal: controller.signal,
      subscribe: (onOpen) =>
        subscribeToDeepSearchJob(
          deepSearchJobId,
          controller.signal,
          onOpen,
        ),
      isTerminal: (event) => event.type === "done",
      onOpen: () => {
        setObservedSubscriptionError(null)
      },
      onReplayStart: () => dispatch({ type: "opened" }),
      onEvent: dispatch,
      onDisconnect: (_error, willRetry) => {
        setObservedSubscriptionError({
          deepSearchJobId,
          message: willRetry
            ? "Live updates were interrupted. Reconnecting…"
            : "Live updates are unavailable. Reload the page to try again.",
        })
      },
    })

    return () => controller.abort()
  }, [deepSearchJobId])

  return { ...state, subscriptionError }
}
