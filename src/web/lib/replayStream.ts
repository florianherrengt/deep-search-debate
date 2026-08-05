import z from "zod"
import { ApiError } from "./api.ts"
import { MalformedNdjsonError } from "./ndjson.ts"

class PrematureStreamEndError extends Error {
  override readonly name = "PrematureStreamEndError"

  constructor() {
    super("Stream ended before its terminal event")
  }
}

type FollowReplayableStreamOptions<Event> = {
  signal: AbortSignal
  subscribe: (onOpen: () => void) => AsyncIterable<Event>
  isTerminal: (event: Event) => boolean
  onOpen: () => void
  onReplayStart?: () => void
  onEvent: (event: Event) => void
  onDisconnect: (error: unknown, willRetry: boolean) => void
  initialRetryDelayMs?: number
  maximumRetryDelayMs?: number
}

export type ReplayStreamResult = "done" | "aborted" | "failed"

function isRetryable(error: unknown): boolean {
  if (error instanceof ApiError) {
    return (
      error.status === 408 ||
      error.status === 425 ||
      error.status === 429 ||
      error.status >= 500
    )
  }
  return !(
    error instanceof z.ZodError || error instanceof MalformedNdjsonError
  )
}

async function waitForRetry(delayMs: number, signal: AbortSignal) {
  if (signal.aborted) return

  await new Promise<void>((resolve) => {
    const timeout = setTimeout(finish, delayMs)

    function finish() {
      clearTimeout(timeout)
      signal.removeEventListener("abort", finish)
      resolve()
    }

    signal.addEventListener("abort", finish, { once: true })
  })
}

/** Follows a replayable event feed until its terminal event, reconnecting on transport loss. */
export async function followReplayableStream<Event>({
  signal,
  subscribe,
  isTerminal,
  onOpen,
  onReplayStart,
  onEvent,
  onDisconnect,
  initialRetryDelayMs = 100,
  maximumRetryDelayMs = 2_000,
}: FollowReplayableStreamOptions<Event>): Promise<ReplayStreamResult> {
  let retryDelayMs = initialRetryDelayMs

  while (!signal.aborted) {
    try {
      let opened = false
      let replayStarted = false
      const markOpen = () => {
        if (!opened && !signal.aborted) {
          opened = true
          onOpen()
        }
      }
      const markReplayStart = () => {
        markOpen()
        if (!replayStarted && !signal.aborted) {
          replayStarted = true
          onReplayStart?.()
        }
      }

      for await (const event of subscribe(markOpen)) {
        if (signal.aborted) return "aborted"

        // A yielded event proves both transport connection and validated replay,
        // including for custom subscribers that do not implement the callback.
        markReplayStart()
        onEvent(event)
        if (isTerminal(event)) return "done"
      }

      if (signal.aborted) return "aborted"
      throw new PrematureStreamEndError()
    } catch (error) {
      if (signal.aborted) return "aborted"

      const willRetry = isRetryable(error)
      onDisconnect(error, willRetry)
      if (!willRetry) return "failed"

      await waitForRetry(retryDelayMs, signal)
      retryDelayMs = Math.min(retryDelayMs * 2, maximumRetryDelayMs)
    }
  }

  return "aborted"
}
