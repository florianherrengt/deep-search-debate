import { randomUUID } from "node:crypto"
import { and, eq, type SQL } from "drizzle-orm"
import type { FinishReason, LanguageModelUsage, streamText } from "ai"
import { debitCredits } from "../credits.ts"
import { db } from "../db/index.ts"
import { llmGenerations } from "../db/schema/index.ts"
import { getErrorMessage } from "../helpers/getErrorMessage.ts"
import {
  getWorkflowStopReason,
  type WorkflowStopReason,
  WorkflowInterruptedError,
} from "../workflowRuntime.ts"
import {
  assertEffectiveResearchRootRunning,
  EffectiveResearchRootInactiveError,
} from "../routes/researchCancellation.ts"
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
  | {
      status: "interrupted"
      text: string
      reasoning: string
      error: string
      reason: WorkflowStopReason
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
  if (outcome.status === "interrupted") {
    throw new WorkflowInterruptedError(outcome.reason)
  }
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
  if (completionResult.value.status === "interrupted") {
    throw new WorkflowInterruptedError(completionResult.value.reason)
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

type InterruptedTextGeneration = FailedTextGeneration & {
  reason: WorkflowStopReason
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
  /** Runs inside the interrupted generation's terminal transaction. */
  onInterrupted?: (
    interrupted: InterruptedTextGeneration,
    transaction: TextStreamPersistenceTransaction,
  ) => void
}

type TextGenerationRegistrationMetadata = {
  modelId: string
  promptName: string
  calculateCredits?: (usage: LanguageModelUsage) => number
}

type TextGenerationTerminalMetadata = {
  finishReason?: PromiseLike<FinishReason>
  usage?: PromiseLike<LanguageModelUsage>
}

type TextGenerationMetadata = TextGenerationRegistrationMetadata &
  Partial<TextGenerationTerminalMetadata>

type RegisterTextStreamOptions = TextGenerationPersistenceCallbacks & {
  metadata?: TextGenerationMetadata
  workflowSignal?: AbortSignal
}

type PrepareTextGenerationOptions = TextGenerationPersistenceCallbacks & {
  metadata?: TextGenerationRegistrationMetadata
  workflowSignal?: AbortSignal
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
  usage?: LanguageModelUsage
  inputTokens?: number
  outputTokens?: number
  reasoningTokens?: number
}

function getUnsuccessfulFinishReasonMessage(
  finishReason: FinishReason | undefined,
): string | undefined {
  if (finishReason === "stop") return undefined
  if (finishReason === undefined) {
    return "Text generation did not report a finish reason"
  }
  return `Text generation ended with finish reason "${finishReason}"`
}

const streams = new Map<string, TextStream>()

function assertWorkflowGenerationActive(
  transaction: TextStreamPersistenceTransaction,
  owner: LlmGenerationOwner,
): void {
  const debateJobId = "debateJobId" in owner
    ? owner.debateJobId
    : undefined
  if (debateJobId !== undefined) {
    assertEffectiveResearchRootRunning(transaction, {
      kind: "debate",
      jobId: debateJobId,
    })
    return
  }
  const deepSearchJobId = "deepSearchJobId" in owner
    ? owner.deepSearchJobId
    : undefined
  if (deepSearchJobId !== undefined) {
    assertEffectiveResearchRootRunning(transaction, {
      kind: "deep-search",
      jobId: deepSearchJobId,
    })
    return
  }
  const ideaJobId = "ideaJobId" in owner ? owner.ideaJobId : undefined
  if (ideaJobId !== undefined) {
    assertEffectiveResearchRootRunning(transaction, {
      kind: "idea",
      jobId: ideaJobId,
    })
  }
}

function getPersistedStopReason(
  error: unknown,
  owner: LlmGenerationOwner,
): WorkflowStopReason | undefined {
  if (
    !(error instanceof EffectiveResearchRootInactiveError) ||
    error.reason !== "stop-requested" ||
    ("standalone" in owner) ||
    !error.root
  ) {
    return undefined
  }
  const ownerKind = "debateJobId" in owner
    ? "debate"
    : "deepSearchJobId" in owner
      ? "deep-search"
      : "idea"
  const ownerJobId = "debateJobId" in owner
    ? owner.debateJobId
    : "deepSearchJobId" in owner
      ? owner.deepSearchJobId
      : owner.ideaJobId
  return error.root.kind === ownerKind && error.root.jobId === ownerJobId
    ? "user-stop"
    : "parent-stop"
}

/**
 * Translates provider deltas into public events and always terminates the retained
 * event log with `done`, even when the provider throws or emits an error.
 */
async function consume(
  id: string,
  userId: string,
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
  let interruptionReason = getWorkflowStopReason(options.workflowSignal)
  if (!interruptionReason && !errorMessage && options.metadata) {
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
  if (!interruptionReason && !errorMessage && !text.trim()) {
    errorMessage = "Text generation returned no content"
    failureKind = "empty-output"
    stream.publish({ type: "error", message: errorMessage })
  }
  const completedAt = new Date()
  let terminalStatus: "completed" | "failed" | "interrupted" =
    interruptionReason ? "interrupted" : errorMessage ? "failed" : "completed"

  try {
    // Deliberate business policy: failed or interrupted generations never charge
    // the user, even when the provider reports billable usage; RethinkLoop
    // absorbs it.
    db.transaction((transaction) => {
      if (!interruptionReason) {
        try {
          assertWorkflowGenerationActive(transaction, owner)
        } catch (error) {
          interruptionReason = getPersistedStopReason(error, owner)
          if (!interruptionReason) throw error
        }
      }
      terminalStatus = interruptionReason
        ? "interrupted"
        : errorMessage
          ? "failed"
          : "completed"
      const creditsUsed = errorMessage || interruptionReason
        ? null
        : options.metadata?.calculateCredits
          ? options.metadata.calculateCredits(
              terminalMetadata.usage ?? (() => {
                throw new Error("LLM generation did not report usage")
              })(),
            )
          : 0
      const terminalWrite = transaction
        .update(llmGenerations)
        .set({
          status: terminalStatus,
          text,
          reasoning,
          error: interruptionReason
            ? new WorkflowInterruptedError(interruptionReason).message
            : (errorMessage ?? null),
          finishReason: terminalMetadata.finishReason ?? null,
          inputTokens: terminalMetadata.inputTokens ?? null,
          outputTokens: terminalMetadata.outputTokens ?? null,
          reasoningTokens: terminalMetadata.reasoningTokens ?? null,
          creditsUsed,
          completedAt,
        })
        .where(eq(llmGenerations.llmGenerationId, id))
        .run()
      if (terminalWrite.changes !== 1) {
        throw new Error(`Text generation ${id} was not found`)
      }

      if (interruptionReason) {
        options.onInterrupted?.(
          {
            id,
            text,
            reasoning,
            error: new WorkflowInterruptedError(interruptionReason).message,
            reason: interruptionReason,
          },
          transaction,
        )
      } else if (errorMessage) {
        options.onFailed?.(
          { id, text, reasoning, error: errorMessage },
          transaction,
        )
      } else {
        debitCredits(transaction, userId, creditsUsed ?? 0)
        options.onCompleted?.({ id, text, reasoning }, transaction)
      }
    })
    logTerminalGeneration({
      id,
      owner,
      startedAt,
      completedAt,
      status: terminalStatus,
      metadata: options.metadata,
      terminalMetadata,
    })
  } catch (error) {
    const message = getErrorMessage(error, "Text generation failed")
    const failedAt = new Date()
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
          completedAt: failedAt,
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
      completedAt: failedAt,
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
  return interruptionReason
    ? {
        status: "interrupted",
        text,
        reasoning,
        error: new WorkflowInterruptedError(interruptionReason).message,
        reason: interruptionReason,
        ...finishReason,
      }
    : errorMessage
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
    usage: usage.status === "fulfilled" ? usage.value : undefined,
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
  status: "completed" | "failed" | "interrupted"
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
    onInterrupted: options.onInterrupted,
    workflowSignal: options.workflowSignal,
    metadata: options.metadata
      ? {
          modelId: options.metadata.modelId,
          promptName: options.metadata.promptName,
          calculateCredits: options.metadata.calculateCredits,
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
    assertWorkflowGenerationActive(transaction, owner)
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
      onInterrupted: options.onInterrupted,
      workflowSignal: options.workflowSignal,
      metadata: options.metadata
        ? { ...options.metadata, ...terminalMetadata }
        : undefined,
    }
    const completion = consume(
      id,
      userId,
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
