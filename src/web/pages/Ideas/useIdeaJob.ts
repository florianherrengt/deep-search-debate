import { useEffect, useReducer, useState } from "react"
import { subscribeToIdeaJob } from "../../lib/ideaJobs.ts"
import { followReplayableStream } from "../../lib/replayStream.ts"
import { ideaJobReducer, initialIdeaJobState } from "./ideaJobState.ts"

export function useIdeaJob(
  ideaJobId: string | null,
  onTerminal?: () => void,
  reconnectKey = 0,
) {
  const [state, dispatch] = useReducer(ideaJobReducer, initialIdeaJobState)
  const [observedSubscriptionError, setObservedSubscriptionError] = useState<{
    ideaJobId: string
    message: string
  } | null>(null)
  const subscriptionError =
    observedSubscriptionError?.ideaJobId === ideaJobId
      ? observedSubscriptionError.message
      : null

  useEffect(() => {
    if (ideaJobId === null) return
    const controller = new AbortController()
    dispatch({ type: "opened" })

    void followReplayableStream({
      signal: controller.signal,
      subscribe: (onOpen) =>
        subscribeToIdeaJob(
          ideaJobId,
          controller.signal,
          onOpen,
        ),
      isTerminal: (event) => event.type === "done",
      onOpen: () => {
        setObservedSubscriptionError(null)
      },
      onReplayStart: () => dispatch({ type: "opened" }),
      onEvent: (event) => {
        dispatch(event)
        if (event.type === "done") onTerminal?.()
      },
      onDisconnect: (_error, willRetry) => {
        setObservedSubscriptionError({
          ideaJobId,
          message: willRetry
            ? "Live updates were interrupted. Reconnecting…"
            : "Live updates are unavailable. Reload the page to try again.",
        })
      },
    })

    return () => controller.abort()
  }, [ideaJobId, onTerminal, reconnectKey])

  return { ...state, subscriptionError }
}
