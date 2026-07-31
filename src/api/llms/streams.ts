import { randomUUID } from "node:crypto"
import type { streamText } from "ai"

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

type TextStream = {
  events: TextStreamEvent[]
  status: "streaming" | "completed" | "failed"
  nextEventSignal: ReturnType<typeof Promise.withResolvers<void>>
}

const streams = new Map<string, TextStream>()

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message
  if (typeof error === "string" && error) return error
  return "Text generation failed"
}

function publish(stream: TextStream, event: TextStreamEvent): void {
  stream.events.push(event)

  const nextEventSignal = stream.nextEventSignal
  stream.nextEventSignal = Promise.withResolvers<void>()
  nextEventSignal.resolve()
}

async function consume(
  source: AsyncIterable<SourceStreamPart>,
  stream: TextStream,
): Promise<void> {
  let failed = false

  try {
    for await (const part of source) {
      switch (part.type) {
        case "reasoning-delta":
          publish(stream, { type: "reasoning", text: part.text })
          break
        case "text-delta":
          publish(stream, { type: "text", text: part.text })
          break
        case "error":
          failed = true
          publish(stream, {
            type: "error",
            message: getErrorMessage(part.error),
          })
          break
      }
    }
  } catch (error) {
    failed = true
    publish(stream, { type: "error", message: getErrorMessage(error) })
  } finally {
    stream.status = failed ? "failed" : "completed"
    publish(stream, { type: "done" })
  }
}

export function registerTextStream(
  source: AsyncIterable<SourceStreamPart>,
): string {
  const id = randomUUID()
  const stream: TextStream = {
    events: [],
    status: "streaming",
    nextEventSignal: Promise.withResolvers<void>(),
  }

  streams.set(id, stream)
  void consume(source, stream)

  return id
}

async function* replayAndFollow(
  stream: TextStream,
): AsyncGenerator<TextStreamEvent> {
  let cursor = 0

  while (true) {
    if (cursor < stream.events.length) {
      yield stream.events[cursor++]
      continue
    }

    if (stream.status !== "streaming") return
    await stream.nextEventSignal.promise
  }
}

export function subscribeToTextStream(
  id: string,
): AsyncGenerator<TextStreamEvent> | undefined {
  const stream = streams.get(id)
  return stream ? replayAndFollow(stream) : undefined
}
