import {
  createContext,
  createElement,
  use,
  useEffect,
  useReducer,
  useState,
  type ReactNode,
} from "react"
import { subscribeToDeepSearchJob } from "./deepSearchJobs.ts"
import { followReplayableStream } from "./replayStream.ts"
import {
  deepSearchReducer,
  initialDeepSearchState,
} from "./deepSearchState.ts"

type DeepSearchSubscription = typeof subscribeToDeepSearchJob

const DeepSearchJobStreamContext = createContext<DeepSearchSubscription>(
  subscribeToDeepSearchJob,
)

export function DeepSearchJobStreamProvider({
  children,
  subscribe,
}: {
  children: ReactNode
  subscribe: DeepSearchSubscription
}) {
  return createElement(
    DeepSearchJobStreamContext.Provider,
    { value: subscribe },
    children,
  )
}

/** Replays and follows one durable deep-search job. */
export function useDeepSearchJob(deepSearchJobId: string) {
  const subscribe = use(DeepSearchJobStreamContext)
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
        subscribe(deepSearchJobId, controller.signal, onOpen),
      isTerminal: (event) => event.type === "done",
      onOpen: () => setObservedSubscriptionError(null),
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
  }, [deepSearchJobId, subscribe])

  return { ...state, subscriptionError }
}
