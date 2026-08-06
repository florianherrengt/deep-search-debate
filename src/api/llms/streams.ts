import { randomUUID } from "node:crypto"
import { eq } from "drizzle-orm"
import type { streamText } from "ai"
import { db } from "../db/index.ts"
import { llmGenerations } from "../db/schema/index.ts"
import { getErrorMessage } from "../helpers/getErrorMessage.ts"
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

export type LlmGenerationOwner =
  | { standalone: true }
  | {
      debateJobId: string
      ideaJobId?: never
      deepSearchJobId?: never
    }
  | {
      debateJobId?: never
      ideaJobId: string
      deepSearchJobId?: never
    }
  | {
      debateJobId?: never
      ideaJobId?: never
      deepSearchJobId: string
    }

export type TextStreamPersistenceTransaction = Parameters<
  Parameters<typeof db.transaction>[0]
>[0]

type CompletedTextStream = {
  id: string
  text: string
  reasoning: string
}

type RegisterTextStreamOptions = {
  /** Runs inside the same transaction as the generation's terminal write. */
  onCompleted?: (
    completed: CompletedTextStream,
    transaction: TextStreamPersistenceTransaction,
  ) => void
}

const streams = new Map<string, TextStream>()
const completions = new Map<string, Promise<void>>()

/**
 * Translates provider deltas into public events and always terminates the retained
 * event log with `done`, even when the provider throws or emits an error.
 */
async function consume(
  id: string,
  source: AsyncIterable<SourceStreamPart>,
  stream: TextStream,
  options: RegisterTextStreamOptions,
): Promise<void> {
  let text = ""
  let reasoning = ""
  let errorMessage: string | undefined

  try {
    for await (const part of source) {
      switch (part.type) {
        case "reasoning-delta":
          reasoning += part.text
          stream.publish({ type: "reasoning", text: part.text })
          break
        case "text-delta":
          text += part.text
          stream.publish({ type: "text", text: part.text })
          break
        case "error": {
          errorMessage ??= getErrorMessage(part.error, "Text generation failed")
          stream.publish({ type: "error", message: errorMessage })
          break
        }
      }
    }
  } catch (error) {
    errorMessage ??= getErrorMessage(error, "Text generation failed")
    stream.publish({ type: "error", message: errorMessage })
  }

  if (!errorMessage && !text.trim()) {
    errorMessage = "Text generation returned no content"
    stream.publish({ type: "error", message: errorMessage })
  }

  try {
    db.transaction((transaction) => {
      transaction
        .update(llmGenerations)
        .set({
          status: errorMessage ? "failed" : "completed",
          text,
          reasoning,
          error: errorMessage ?? null,
          completedAt: new Date(),
        })
        .where(eq(llmGenerations.llmGenerationId, id))
        .run()

      if (!errorMessage) {
        options.onCompleted?.({ id, text, reasoning }, transaction)
      }
    })
  } catch (error) {
    const message = getErrorMessage(error, "Text generation failed")
    try {
      // The generation/result transaction rolled back. Record a separate
      // failure so recovery never mistakes this detached stream for live work.
      db.update(llmGenerations)
        .set({
          status: "failed",
          text,
          reasoning,
          error: message,
          completedAt: new Date(),
        })
        .where(eq(llmGenerations.llmGenerationId, id))
        .run()
    } catch (fallbackError) {
      console.error(
        `Failed to persist text generation ${id} terminal failure`,
        fallbackError,
      )
    }
    stream.publish({
      type: "error",
      message,
    })
    throw error
  } finally {
    try {
      stream.publish({ type: "done" })
    } finally {
      stream.close()
    }
  }
}

/**
 * Allocates and stores a replayable text stream, starts consuming its source
 * immediately, and returns the stable ID used by all current and future readers.
 */
export function registerTextStream(
  userId: string,
  owner: LlmGenerationOwner,
  source: AsyncIterable<SourceStreamPart>,
  options: RegisterTextStreamOptions = {},
): string {
  const id = randomUUID()
  const stream = createReplayableEventLog<TextStreamEvent>()
  const ownerColumns = "standalone" in owner ? {} : owner

  db.insert(llmGenerations)
    .values({ llmGenerationId: id, userId, ...ownerColumns })
    .run()
  streams.set(id, stream)
  const completion = consume(id, source, stream, options)
  completions.set(id, completion)
  void completion.then(
    () => {
      // Completed output is durable, so late readers can use the database
      // replay without retaining every token delta for the process lifetime.
      streams.delete(id)
      completions.delete(id)
    },
    () => {
      // If terminal persistence failed, the closed live log is the only copy
      // of its error and done events. Retain it until a process restart.
      completions.delete(id)
    },
  )

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
  if (stream) return stream.subscribe()

  const generation = db
    .select()
    .from(llmGenerations)
    .where(eq(llmGenerations.llmGenerationId, id))
    .get()
  if (!generation) return

  return replayPersistedGeneration(generation)
}

type LlmGeneration = typeof llmGenerations.$inferSelect

/** Reconstructs the same public stream shape from one terminal database row. */
async function* replayPersistedGeneration(
  generation: LlmGeneration,
): AsyncGenerator<TextStreamEvent> {
  await Promise.resolve()
  if (generation.reasoning) {
    yield { type: "reasoning", text: generation.reasoning }
  }
  if (generation.text) {
    yield { type: "text", text: generation.text }
  }
  if (generation.error) {
    yield { type: "error", message: generation.error }
  }
  yield { type: "done" }
}

/** Waits until a live generation has written its terminal database update. */
export async function waitForTextStream(id: string): Promise<void> {
  const completion = completions.get(id)
  if (completion) {
    await completion
    return
  }

  const generation = db
    .select({ status: llmGenerations.status })
    .from(llmGenerations)
    .where(eq(llmGenerations.llmGenerationId, id))
    .get()
  if (!generation) throw new Error(`Text stream ${id} was not found`)
  if (generation.status === "running") {
    throw new Error(`Text stream ${id} is no longer attached to this process`)
  }
}
