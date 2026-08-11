import { randomUUID } from "node:crypto"
import { and, eq, type SQL } from "drizzle-orm"
import type { FinishReason, LanguageModelUsage, streamText } from "ai"
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

type GenerationFailureKind =
  | "empty-output"
  | "finish-reason"
  | "stream"

export type GenerationOutcome =
  | {
      status: "completed"
      text: string
      reasoning: string
      finishReason?: FinishReason
    }
  | {
      status: "failed"
      text: string
      reasoning: string
      error: string
      failureKind: GenerationFailureKind
      finishReason?: FinishReason
    }

export type GenerationHandle = {
  id: string
  /** Settles only after the generation's terminal database write commits. */
  completion: Promise<GenerationOutcome>
}

/** Returns durable text or throws the persisted provider/model failure. */
export async function awaitGenerationText(
  generation: GenerationHandle,
): Promise<string> {
  const outcome = await generation.completion
  if (outcome.status === "failed") throw new Error(outcome.error)
  return outcome.text
}

/**
 * Waits for both structured validation and durable terminal persistence. This
 * deliberately settles both promises so a validation failure cannot leave a
 * database write running after its owning stage has failed.
 */
export async function awaitGenerationOutput<Output>(
  generation: GenerationHandle,
  output: Promise<Output>,
): Promise<Output> {
  const [completionResult, outputResult] = await Promise.allSettled([
    generation.completion,
    output,
  ])
  if (completionResult.status === "rejected") throw completionResult.reason
  if (completionResult.value.status === "failed") {
    throw new Error(completionResult.value.error)
  }
  if (outputResult.status === "rejected") throw outputResult.reason
  return outputResult.value
}

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

type CompletedTextGeneration = {
  id: string
  text: string
  reasoning: string
}

type FailedTextGeneration = CompletedTextGeneration & {
  error: string
}

export type TextGenerationPersistenceCallbacks = {
  /** Runs atomically after generation insertion and before consumption starts. */
  onRegistered?: (
    id: string,
    transaction: TextStreamPersistenceTransaction,
  ) => void
  /** Runs inside the same transaction as the generation's terminal write. */
  onCompleted?: (
    completed: CompletedTextGeneration,
    transaction: TextStreamPersistenceTransaction,
  ) => void
  /** Runs inside the same transaction as a failed generation's terminal write. */
  onFailed?: (
    failed: FailedTextGeneration,
    transaction: TextStreamPersistenceTransaction,
  ) => void
}

type TextGenerationRegistrationMetadata = {
  modelId: string
  promptName: string
}

type TextGenerationTerminalMetadata = {
  finishReason?: PromiseLike<FinishReason>
  usage?: PromiseLike<LanguageModelUsage>
}

type TextGenerationMetadata = TextGenerationRegistrationMetadata &
  Partial<TextGenerationTerminalMetadata>

type RegisterTextStreamOptions = TextGenerationPersistenceCallbacks & {
  metadata?: TextGenerationMetadata
}

type PrepareTextGenerationOptions = TextGenerationPersistenceCallbacks & {
  metadata?: TextGenerationRegistrationMetadata
}

export type PreparedTextGeneration = {
  id: string
  start(
    source: AsyncIterable<SourceStreamPart>,
    metadata?: TextGenerationTerminalMetadata,
  ): GenerationHandle
  fail(error: unknown): GenerationHandle
}

type TerminalGenerationMetadata = {
  finishReason?: FinishReason
  finishReasonResolved?: boolean
  inputTokens?: number
  outputTokens?: number
  reasoningTokens?: number
}

export function getUnsuccessfulFinishReasonMessage(
  finishReason: FinishReason | undefined,
): string | undefined {
  if (finishReason === "stop") return undefined
  if (finishReason === undefined) {
    return "Text generation did not report a finish reason"
  }
  return `Text generation ended with finish reason "${finishReason}"`
}

const streams = new Map<string, TextStream>()

/**
 * Translates provider deltas into public events and always terminates the retained
 * event log with `done`, even when the provider throws or emits an error.
 */
async function consume(
  id: string,
  source: AsyncIterable<SourceStreamPart>,
  stream: TextStream,
  owner: LlmGenerationOwner,
  startedAt: Date,
  options: RegisterTextStreamOptions,
): Promise<GenerationOutcome> {
  let text = ""
  let reasoning = ""
  let errorMessage: string | undefined
  let failureKind: GenerationFailureKind | undefined
  const terminalMetadataPromise = resolveTerminalMetadata(options.metadata)

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
          failureKind ??= "stream"
          stream.publish({ type: "error", message: errorMessage })
          break
        }
      }
    }
  } catch (error) {
    errorMessage ??= getErrorMessage(error, "Text generation failed")
    failureKind ??= "stream"
    stream.publish({ type: "error", message: errorMessage })
  }

  const terminalMetadata = await terminalMetadataPromise
  if (!errorMessage && options.metadata) {
    errorMessage = getUnsuccessfulFinishReasonMessage(
      terminalMetadata.finishReasonResolved
        ? terminalMetadata.finishReason
        : undefined,
    )
    if (errorMessage) {
      failureKind = "finish-reason"
      stream.publish({ type: "error", message: errorMessage })
    }
  }
  if (!errorMessage && !text.trim()) {
    errorMessage = "Text generation returned no content"
    failureKind = "empty-output"
    stream.publish({ type: "error", message: errorMessage })
  }
  let completedAt = new Date()

  try {
    db.transaction((transaction) => {
      const terminalWrite = transaction
        .update(llmGenerations)
        .set({
          status: errorMessage ? "failed" : "completed",
          text,
          reasoning,
          error: errorMessage ?? null,
          finishReason: terminalMetadata.finishReason ?? null,
          inputTokens: terminalMetadata.inputTokens ?? null,
          outputTokens: terminalMetadata.outputTokens ?? null,
          reasoningTokens: terminalMetadata.reasoningTokens ?? null,
          completedAt,
        })
        .where(eq(llmGenerations.llmGenerationId, id))
        .run()
      if (terminalWrite.changes !== 1) {
        throw new Error(`Text generation ${id} was not found`)
      }

      if (errorMessage) {
        options.onFailed?.(
          { id, text, reasoning, error: errorMessage },
          transaction,
        )
      } else {
        options.onCompleted?.({ id, text, reasoning }, transaction)
      }
    })
    logTerminalGeneration({
      id,
      owner,
      startedAt,
      completedAt,
      status: errorMessage ? "failed" : "completed",
      metadata: options.metadata,
      terminalMetadata,
    })
  } catch (error) {
    const message = getErrorMessage(error, "Text generation failed")
    completedAt = new Date()
    try {
      // The generation/result transaction rolled back. Record a separate
      // failure so recovery never mistakes this detached stream for live work.
      db.update(llmGenerations)
        .set({
          status: "failed",
          text,
          reasoning,
          error: message,
          finishReason: terminalMetadata.finishReason ?? null,
          inputTokens: terminalMetadata.inputTokens ?? null,
          outputTokens: terminalMetadata.outputTokens ?? null,
          reasoningTokens: terminalMetadata.reasoningTokens ?? null,
          completedAt,
        })
        .where(eq(llmGenerations.llmGenerationId, id))
        .run()
    } catch (fallbackError) {
      console.error(
        `Failed to persist text generation ${id} terminal failure`,
        fallbackError,
      )
    }
    logTerminalGeneration({
      id,
      owner,
      startedAt,
      completedAt,
      status: "failed",
      metadata: options.metadata,
      terminalMetadata,
    })
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

  const finishReason = terminalMetadata.finishReason
    ? { finishReason: terminalMetadata.finishReason }
    : {}
  return errorMessage
    ? {
        status: "failed",
        text,
        reasoning,
        error: errorMessage,
        failureKind: failureKind!,
        ...finishReason,
      }
    : { status: "completed", text, reasoning, ...finishReason }
}

async function resolveTerminalMetadata(
  metadata: TextGenerationMetadata | undefined,
): Promise<TerminalGenerationMetadata> {
  if (!metadata) return {}
  const [finishReason, usage] = await Promise.allSettled([
    metadata.finishReason ?? Promise.reject(new Error("Missing finish reason")),
    metadata.usage ?? Promise.reject(new Error("Missing usage")),
  ])
  return {
    finishReasonResolved: finishReason.status === "fulfilled",
    finishReason:
      finishReason.status === "fulfilled" ? finishReason.value : undefined,
    inputTokens:
      usage.status === "fulfilled" ? usage.value.inputTokens : undefined,
    outputTokens:
      usage.status === "fulfilled" ? usage.value.outputTokens : undefined,
    reasoningTokens:
      usage.status === "fulfilled"
        ? usage.value.outputTokenDetails.reasoningTokens
        : undefined,
  }
}

function logTerminalGeneration(input: {
  id: string
  owner: LlmGenerationOwner
  startedAt: Date
  completedAt: Date
  status: "completed" | "failed"
  metadata: TextGenerationMetadata | undefined
  terminalMetadata: TerminalGenerationMetadata
}): void {
  if (!input.metadata) return
  try {
    console.info("LLM generation", {
      generationId: input.id,
      ...("standalone" in input.owner ? {} : input.owner),
      stage: input.metadata.promptName,
      modelId: input.metadata.modelId,
      status: input.status,
      finishReason: input.terminalMetadata.finishReason ?? null,
      inputTokens: input.terminalMetadata.inputTokens ?? null,
      outputTokens: input.terminalMetadata.outputTokens ?? null,
      reasoningTokens: input.terminalMetadata.reasoningTokens ?? null,
      durationMs: Math.max(
        0,
        input.completedAt.getTime() - input.startedAt.getTime(),
      ),
    })
  } catch {
    // Observability must never change generation persistence or stream outcome.
    return
  }
}

/**
 * Allocates and stores a replayable text stream, starts consuming its source
 * immediately, and returns its stable ID plus its durable terminal outcome.
 */
export function registerTextStream(
  userId: string,
  owner: LlmGenerationOwner,
  source: AsyncIterable<SourceStreamPart>,
  options: RegisterTextStreamOptions = {},
): GenerationHandle {
  const prepared = prepareTextGeneration(userId, owner, {
    onRegistered: options.onRegistered,
    onCompleted: options.onCompleted,
    onFailed: options.onFailed,
    metadata: options.metadata
      ? {
          modelId: options.metadata.modelId,
          promptName: options.metadata.promptName,
        }
      : undefined,
  })
  return prepared.start(
    source,
    options.metadata
      ? {
          finishReason: options.metadata.finishReason,
          usage: options.metadata.usage,
        }
      : undefined,
  )
}

/**
 * Commits the durable row and owning-stage link before provider work exists.
 * The returned controller is single-use so one row cannot consume two calls.
 */
export function prepareTextGeneration(
  userId: string,
  owner: LlmGenerationOwner,
  options: PrepareTextGenerationOptions = {},
): PreparedTextGeneration {
  const id = randomUUID()
  const stream = createReplayableEventLog<TextStreamEvent>()
  const ownerColumns = "standalone" in owner ? {} : owner
  const startedAt = new Date()

  db.transaction((transaction) => {
    transaction
      .insert(llmGenerations)
      .values({
        llmGenerationId: id,
        userId,
        ...ownerColumns,
        modelId: options.metadata?.modelId,
        promptName: options.metadata?.promptName,
        startedAt,
      })
      .run()
    options.onRegistered?.(id, transaction)
  })
  streams.set(id, stream)
  let started = false

  const start = (
    source: AsyncIterable<SourceStreamPart>,
    terminalMetadata?: TextGenerationTerminalMetadata,
  ): GenerationHandle => {
    if (started) throw new Error(`Text generation ${id} was already started`)
    started = true
    const combinedOptions: RegisterTextStreamOptions = {
      onRegistered: options.onRegistered,
      onCompleted: options.onCompleted,
      onFailed: options.onFailed,
      metadata: options.metadata
        ? { ...options.metadata, ...terminalMetadata }
        : undefined,
    }
    const completion = consume(
      id,
      source,
      stream,
      owner,
      startedAt,
      combinedOptions,
    )
    void completion.then(
      () => {
        // Completed output is durable, so late readers can use the database
        // replay without retaining every token delta for the process lifetime.
        streams.delete(id)
      },
      () => {
        // If terminal persistence failed, the closed live log is the only copy
        // of its error and done events. Retain it until a process restart.
      },
    )
    return { id, completion }
  }

  return {
    id,
    start,
    fail(error) {
      const failedSource = {
        [Symbol.asyncIterator](): AsyncIterator<SourceStreamPart> {
          return {
            async next(): Promise<IteratorResult<SourceStreamPart>> {
              await Promise.resolve()
              throw error
            },
          }
        },
      }
      return start(failedSource)
    },
  }
}

/**
 * Returns a fresh replay-and-follow iterator for a retained stream, or `undefined`
 * when the ID was never registered. Reading never removes buffered events.
 */
export function subscribeToTextStream(
  id: string,
  readScope?: SQL,
): AsyncGenerator<TextStreamEvent> | undefined {
  const generation = db
    .select()
    .from(llmGenerations)
    .where(and(eq(llmGenerations.llmGenerationId, id), readScope))
    .get()
  if (!generation) return

  const stream = streams.get(id)
  if (stream) return stream.subscribe()

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
