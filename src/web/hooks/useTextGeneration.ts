import { useCallback, useEffect, useRef, useState } from "react"
import {
  accumulateTextStream,
  type TextStreamContent,
} from "../lib/accumulateTextStream.ts"
import { getErrorMessage } from "../lib/errors.ts"
import {
  createTextStream,
  subscribeToTextStream,
  type CreateTextStreamInput,
} from "../lib/textStreams.ts"

type TextGenerationResult = TextStreamContent & {
  streamId: string | null
}

type TextGenerationState = TextGenerationResult & {
  isStreaming: boolean
  error: string | null
}

export type UseTextGeneration = TextGenerationState & {
  send: (input: CreateTextStreamInput) => Promise<TextGenerationResult>
  cancel: () => void
  reset: () => void
}

const initialState: TextGenerationState = {
  streamId: null,
  text: "",
  reasoning: "",
  isStreaming: false,
  error: null,
}

/** Creates a text generation and follows its registered stream to completion. */
export function useTextGeneration(): UseTextGeneration {
  const [state, setState] = useState(initialState)
  const abortRef = useRef<AbortController | null>(null)

  const cancel = useCallback(() => abortRef.current?.abort(), [])

  const reset = useCallback(() => {
    cancel()
    abortRef.current = null
    setState(initialState)
  }, [cancel])

  useEffect(() => cancel, [cancel])

  const send = useCallback(
    async (input: CreateTextStreamInput): Promise<TextGenerationResult> => {
      cancel()
      const controller = new AbortController()
      abortRef.current = controller
      setState({ ...initialState, isStreaming: true })

      let streamId: string | null = null
      let content: TextStreamContent = { text: "", reasoning: "" }

      try {
        streamId = await createTextStream(input, controller.signal)
        setState((current) => ({ ...current, streamId }))

        content = await accumulateTextStream(
          subscribeToTextStream(streamId, controller.signal),
          (next) => {
            content = next
            setState((current) => ({ ...current, ...next }))
          },
        )

        return { streamId, ...content }
      } catch (error) {
        if (controller.signal.aborted) return { streamId, ...content }

        const message = getErrorMessage(error)
        setState((current) => ({ ...current, error: message }))
        if (error instanceof Error) throw error
        throw new Error(message, { cause: error })
      } finally {
        if (abortRef.current === controller) {
          abortRef.current = null
          setState((current) => ({ ...current, isStreaming: false }))
        }
      }
    },
    [cancel],
  )

  return { ...state, send, cancel, reset }
}
