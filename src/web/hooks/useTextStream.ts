import { useCallback, useEffect, useRef, useState } from "react"
import {
  createTextStream,
  subscribeToTextStream,
  type CreateTextStreamInput,
} from "../lib/textStreams.ts"

type TextStreamResult = {
  streamId: string | null
  text: string
  reasoning: string
}

export type UseTextStream = TextStreamResult & {
  isStreaming: boolean
  error: Error | null
  send: (input: CreateTextStreamInput) => Promise<TextStreamResult>
  cancel: () => void
  reset: () => void
}

export function useTextStream(): UseTextStream {
  const [streamId, setStreamId] = useState<string | null>(null)
  const [text, setText] = useState("")
  const [reasoning, setReasoning] = useState("")
  const [isStreaming, setIsStreaming] = useState(false)
  const [error, setError] = useState<Error | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  const cancel = useCallback(() => abortRef.current?.abort(), [])

  const reset = useCallback(() => {
    abortRef.current?.abort()
    abortRef.current = null
    setStreamId(null)
    setText("")
    setReasoning("")
    setError(null)
    setIsStreaming(false)
  }, [])

  useEffect(() => cancel, [cancel])

  const send = useCallback(
    async (input: CreateTextStreamInput): Promise<TextStreamResult> => {
      abortRef.current?.abort()
      const controller = new AbortController()
      abortRef.current = controller

      setStreamId(null)
      setText("")
      setReasoning("")
      setError(null)
      setIsStreaming(true)

      let activeStreamId: string | null = null
      let text = ""
      let reasoning = ""
      const { signal } = controller

      try {
        activeStreamId = await createTextStream(input, signal)
        setStreamId(activeStreamId)

        for await (const event of subscribeToTextStream(activeStreamId, signal)) {
          switch (event.type) {
            case "reasoning":
              reasoning += event.text
              setReasoning(reasoning)
              break
            case "text":
              text += event.text
              setText(text)
              break
            case "error":
              throw new Error(event.message)
            case "done":
              break
          }
        }

        return { streamId: activeStreamId, text, reasoning }
      } catch (caught) {
        if (signal.aborted) {
          return { streamId: activeStreamId, text, reasoning }
        }

        const next =
          caught instanceof Error ? caught : new Error(String(caught))
        setError(next)
        throw next
      } finally {
        if (abortRef.current === controller) {
          abortRef.current = null
          setIsStreaming(false)
        }
      }
    },
    [],
  )

  return {
    streamId,
    text,
    reasoning,
    isStreaming,
    error,
    send,
    cancel,
    reset,
  }
}
