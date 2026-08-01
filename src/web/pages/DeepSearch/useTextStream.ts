import {
  createContext,
  createElement,
  type ReactNode,
  use,
  useEffect,
  useState,
} from "react"
import {
  accumulateTextStream,
  type TextStreamContent,
} from "../../lib/accumulateTextStream.ts"
import { getErrorMessage } from "../../lib/errors.ts"
import { subscribeToTextStream } from "../../lib/textStreams.ts"

type TextStreamSubscriber = typeof subscribeToTextStream

const TextStreamContext = createContext<TextStreamSubscriber>(
  subscribeToTextStream,
)

/** Overrides stream subscription for isolated previews such as Storybook. */
export function TextStreamProvider({
  children,
  subscribe,
}: {
  children: ReactNode
  subscribe: TextStreamSubscriber
}) {
  return createElement(TextStreamContext.Provider, { value: subscribe }, children)
}

export type TextStreamState = TextStreamContent &
  (
    | { status: "idle" }
    | { status: "streaming" }
    | { status: "completed" }
    | { status: "error"; message: string }
  )

const idleState: TextStreamState = {
  status: "idle",
  text: "",
  reasoning: "",
}

const streamingState: TextStreamState = {
  status: "streaming",
  text: "",
  reasoning: "",
}

type ObservedStream = {
  streamId: string
  state: TextStreamState
}

function getCurrentState(
  streamId: string | null | undefined,
  observed: ObservedStream | null,
): TextStreamState {
  if (!streamId) return idleState
  if (observed?.streamId === streamId) return observed.state
  return streamingState
}

/**
 * Replays and follows one registered text stream, accumulating text while keeping
 * completion, failure, UUID changes, and unmount cancellation isolated per caller.
 */
export function useTextStream(streamId?: string | null): TextStreamState {
  const [observed, setObserved] = useState<ObservedStream | null>(null)
  const subscribe = use(TextStreamContext)
  const state = getCurrentState(streamId, observed)

  useEffect(() => {
    if (!streamId) return

    const controller = new AbortController()
    let content: TextStreamContent = { text: "", reasoning: "" }

    void (async () => {
      try {
        content = await accumulateTextStream(
          subscribe(streamId, controller.signal),
          (next) => {
            content = next
            setObserved({
              streamId,
              state: { status: "streaming", ...content },
            })
          },
        )

        if (!controller.signal.aborted) {
          setObserved({
            streamId,
            state: { status: "completed", ...content },
          })
        }
      } catch (error) {
        if (!controller.signal.aborted) {
          setObserved({
            streamId,
            state: {
              status: "error",
              ...content,
              message: getErrorMessage(error),
            },
          })
        }
      }
    })()

    return () => controller.abort()
  }, [streamId, subscribe])

  return state
}
