import {
  createContext,
  createElement,
  type ReactNode,
  use,
  useEffect,
  useState,
} from "react"
import { followReplayableStream } from "../../lib/replayStream.ts"
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

export type TextStreamState = {
  text: string
  reasoning: string
} & (
  | { status: "idle" }
  | { status: "streaming" }
  | { status: "reconnecting"; message: string }
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

/** Replays and follows one registered text stream until its explicit done event. */
export function useTextStream(streamId?: string | null): TextStreamState {
  const [observed, setObserved] = useState<ObservedStream | null>(null)
  const subscribe = use(TextStreamContext)
  const state = getCurrentState(streamId, observed)

  useEffect(() => {
    if (!streamId) return

    const controller = new AbortController()
    let text = ""
    let reasoning = ""
    let domainError: string | null = null

    void (async () => {
      const result = await followReplayableStream({
        signal: controller.signal,
        subscribe: (onOpen) =>
          subscribe(streamId, controller.signal, onOpen),
        isTerminal: (event) => event.type === "done",
        onOpen: () => {
          setObserved({
            streamId,
            state: { status: "streaming", text, reasoning },
          })
        },
        onReplayStart: () => {
          text = ""
          reasoning = ""
          domainError = null
          setObserved({ streamId, state: streamingState })
        },
        onEvent: (event) => {
          switch (event.type) {
            case "reasoning":
              reasoning += event.text
              break
            case "text":
              text += event.text
              break
            case "error":
              domainError = event.message
              break
            case "done":
              break
          }

          setObserved({
            streamId,
            state: domainError
              ? { status: "error", text, reasoning, message: domainError }
              : { status: "streaming", text, reasoning },
          })
        },
        onDisconnect: (_error, willRetry) => {
          setObserved({
            streamId,
            state: {
              status: willRetry ? "reconnecting" : "error",
              text,
              reasoning,
              message: willRetry
                ? "Live response interrupted. Reconnecting…"
                : "Live response unavailable. Reload the page to try again.",
            },
          })
        },
      })

      if (result === "done" && !controller.signal.aborted) {
        setObserved({
          streamId,
          state: domainError
            ? { status: "error", text, reasoning, message: domainError }
            : { status: "completed", text, reasoning },
        })
      }
    })()

    return () => controller.abort()
  }, [streamId, subscribe])

  return state
}
