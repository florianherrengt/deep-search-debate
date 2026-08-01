import { randomUUID } from "node:crypto"
import type { streamText } from "ai"
import {
  createReplayableEventLog,
  type ReplayableEventLog,
} from "../helpers/replayableEventLog.ts"

export type TextStreamEvent =
  | { type: "reasoning"; text: string }
  | { type: "text"; text: string }
  | { type: "error"; message: string }
  | { type: "done" }

type SourceStreamPart = ReturnType<
  typeof streamText
>["stream"] extends AsyncIterable<infer Part>
  ? Part
  : never

type TextStream = ReplayableEventLog<TextStreamEvent>

const streams = new Map<string, TextStream>()

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message
  if (typeof error === "string" && error) return error
  return "Text generation failed"
}

/**
 * Translates provider deltas into public events and always terminates the retained
 * event log with `done`, even when the provider throws or emits an error.
 */
async function consume(
  source: AsyncIterable<SourceStreamPart>,
  stream: TextStream,
): Promise<void> {
  try {
    for await (const part of source) {
      switch (part.type) {
        case "reasoning-delta":
          stream.publish({ type: "reasoning", text: part.text })
          break
        case "text-delta":
          stream.publish({ type: "text", text: part.text })
          break
        case "error":
          stream.publish({
            type: "error",
            message: getErrorMessage(part.error),
          })
          break
      }
    }
  } catch (error) {
    stream.publish({ type: "error", message: getErrorMessage(error) })
  } finally {
    stream.publish({ type: "done" })
    stream.close()
  }
}

/**
 * Allocates and stores a replayable text stream, starts consuming its source
 * immediately, and returns the stable ID used by all current and future readers.
 */
export function registerTextStream(
  source: AsyncIterable<SourceStreamPart>,
): string {
  const id = randomUUID()
  const stream = createReplayableEventLog<TextStreamEvent>()

  streams.set(id, stream)
  void consume(source, stream)

  return id
}

/**
 * Returns a fresh replay-and-follow iterator for a retained stream, or `undefined`
 * when the ID was never registered. Reading never removes buffered events.
 */
export function subscribeToTextStream(
  id: string,
): AsyncGenerator<TextStreamEvent> | undefined {
  const stream = streams.get(id)
  return stream?.subscribe()
}
