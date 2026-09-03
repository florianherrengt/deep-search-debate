import { Output, streamText } from "ai"
import { secureJsonParse } from "@ai-sdk/provider-utils"
import PQueue from "p-queue"
import z from "zod"
import { config } from "../config.ts"
import { requirePositiveCreditBalance } from "../credits.ts"
import { addAbortableQueueTask } from "../helpers/addAbortableQueueTask.ts"
import { classifyCodexError } from "../openaiConnection/codexErrors.ts"
import { FatalCodexContainmentError } from "../openaiConnection/codexSession/process.ts"
import { calculateLlmCredits } from "./costs/index.ts"
import { PromptName, loadPrompt } from "./prompts.ts"
import { snapshotLlmModelAssignment } from "./modelSettings.ts"
import {
  reserveLlmCall,
  type LlmCallReasoning,
  type ResolvedLlmCall,
} from "./provider.ts"
import {
  prepareTextGeneration,
  awaitGenerationOutput,
  type GenerationHandle,
  type LlmGenerationOwner,
  type TextGenerationPersistenceCallbacks,
  type TextStreamPersistenceTransaction,
} from "./streams.ts"

const promptTitleSchema = z.object({
  title: z.string().trim().min(1).max(80),
})

type GenerateStreamInput = {
  userId: string
  owner: LlmGenerationOwner
  prompt: string
  promptName: PromptName
  temperature?: number
  maxOutputTokens?: number
  workflowSignal?: AbortSignal
}

const streamTimeout = {
  totalMs: config.llmExecution.totalTimeoutMs,
  firstChunkMs: config.llmExecution.firstChunkTimeoutMs,
  chunkMs: config.llmExecution.chunkTimeoutMs,
}

const llmGenerationQueue = new PQueue({
  concurrency: config.llmExecution.maxConcurrentGenerations,
})

function asError(error: unknown, fallback: string): Error {
  return error instanceof Error ? error : new Error(fallback, { cause: error })
}

/** Keeps per-stage budgets below the operator's deployment-wide ceiling. */
function boundedOutputTokens(requested?: number): number {
  return Math.min(
    requested ?? config.llmExecution.maxOutputTokens,
    config.llmExecution.maxOutputTokens,
  )
}

async function enqueueStreamingGeneration<T extends GenerationHandle>(
  userId: string,
  promptName: PromptName,
  legacyReasoning: LlmCallReasoning,
  start: (call: ResolvedLlmCall) => T | Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  const modelSnapshot = snapshotLlmModelAssignment(userId, promptName)
  const reservation = await reserveLlmCall(userId, modelSnapshot, signal)
  const ready = Promise.withResolvers<T>()
  void addAbortableQueueTask(
    llmGenerationQueue,
    async () => {
      const call = await reservation.resolve(legacyReasoning, undefined)
      let generation: T
      try {
        generation = await start(call)
      } catch (error) {
        try {
          await call.release()
        } catch (releaseError) {
          if (releaseError instanceof FatalCodexContainmentError) {
            throw releaseError
          }
        }
        throw error
      }
      ready.resolve(generation)
      await generation.completion
    },
    signal,
  )
    .catch((error: unknown) => {
      reservation.release()
      ready.reject(asError(error, "LLM queue failed"))
    })
  return ready.promise
}

function rejectedOutput<OutputValue>(error: unknown): Promise<OutputValue> {
  const output = Promise.reject<OutputValue>(
    asError(error, "LLM generation failed"),
  )
  void output.catch(() => undefined)
  return output
}

function parseStructuredText<Result>(
  schema: z.ZodType<Result>,
  text: string,
): Result {
  return schema.parse(secureJsonParse(text))
}

// The SDK's default stream handler logs the complete provider error object,
// which can contain request details. Durable generation state and the bounded
// privacy-safe failure log provide the diagnostics this application exposes.
const suppressProviderErrorLogging = () => undefined

async function loadStructuredPrompt(
  promptName: PromptName,
  schema: z.ZodType,
  supportsStructuredOutputs: boolean,
): Promise<string> {
  const system = await loadPrompt(promptName)
  if (supportsStructuredOutputs) return system

  const jsonSchema = z.toJSONSchema(schema, { target: "draft-7" })
  return [
    system,
    "",
    "Return only valid JSON matching this JSON Schema:",
    JSON.stringify(jsonSchema),
  ].join("\n")
}

function generationRegistrationMetadata(
  call: ResolvedLlmCall,
  promptName: PromptName,
) {
  return {
    modelId: call.modelId,
    promptName,
    provider: call.provider,
    ...(call.provider === "server" && {
      calculateCredits: (usage: Parameters<typeof calculateLlmCredits>[2]) =>
        calculateLlmCredits(config.llm, call.modelId, usage),
    }),
  }
}

function streamTextBaseOptions(
  call: ResolvedLlmCall,
  params: GenerateStreamInput,
  system: string,
) {
  return {
    model: call.model,
    prompt: params.prompt,
    system,
    temperature: params.temperature,
    maxOutputTokens: boundedOutputTokens(params.maxOutputTokens),
    maxRetries: config.llmExecution.maxRetries,
    timeout: streamTimeout,
    abortSignal: params.workflowSignal,
    onError: suppressProviderErrorLogging,
    ...call.callOptions,
  }
}

async function releaseAfterStartFailure(
  call: ResolvedLlmCall,
  error: unknown,
): Promise<unknown> {
  let failure = error
  try {
    await call.release()
  } catch (releaseError) {
    if (releaseError instanceof FatalCodexContainmentError) throw releaseError
    failure = releaseError
  }
  return call.provider === "codex" ? classifyCodexError(failure) : failure
}

export async function generateTextStream(
  params: GenerateStreamInput &
    TextGenerationPersistenceCallbacks & { reasoning: LlmCallReasoning },
): Promise<GenerationHandle> {
  return enqueueStreamingGeneration(
    params.userId,
    params.promptName,
    params.reasoning,
    async (call) => {
      if (call.provider === "server") {
        requirePositiveCreditBalance(params.userId)
      }
      const system = await loadPrompt(params.promptName)
      const prepared = prepareTextGeneration(params.userId, params.owner, {
        onRegistered: params.onRegistered,
        onCompleted: params.onCompleted,
        onFailed: params.onFailed,
        onInterrupted: params.onInterrupted,
        workflowSignal: params.workflowSignal,
        metadata: generationRegistrationMetadata(call, params.promptName),
      })
      let result: ReturnType<typeof streamText>
      try {
        result = streamText(streamTextBaseOptions(call, params, system))
      } catch (error) {
        return prepared.fail(await releaseAfterStartFailure(call, error))
      }
      return prepared.start(call.wrapStream(result.stream), {
        finishReason: result.finishReason,
        rawFinishReason: result.rawFinishReason,
        usage: result.usage,
      })
    },
    params.workflowSignal,
  )
}

/** Generates the immutable display title used before a durable job starts. */
export async function generatePromptTitle(
  userId: string,
  prompt: string,
  workflowSignal?: AbortSignal,
): Promise<string> {
  const generation = await generateObjectStream({
    userId,
    owner: { standalone: true },
    prompt: `<user_request>\n${prompt}\n</user_request>`,
    promptName: PromptName.GeneratePromptTitle,
    maxOutputTokens: 50,
    schema: promptTitleSchema,
    workflowSignal,
  })
  return (await awaitGenerationOutput(generation, generation.output)).title
}

export async function generateArrayStream<Element>(
  params: GenerateStreamInput & {
    element: z.ZodType<Element>
    onCompleted?: (
      completed: { id: string; output: Element[] },
      transaction: TextStreamPersistenceTransaction,
    ) => void
  } & Omit<TextGenerationPersistenceCallbacks, "onCompleted">,
): Promise<
  GenerationHandle & {
    output: Promise<Element[]>
  }
> {
  const outputSchema = z.object({ elements: z.array(params.element) })
  return enqueueStreamingGeneration(
    params.userId,
    params.promptName,
    "disabled",
    async (call) => {
      if (call.provider === "server") {
        requirePositiveCreditBalance(params.userId)
      }
      const system = await loadStructuredPrompt(
        params.promptName,
        outputSchema,
        call.supportsStructuredOutputs,
      )
      const prepared = prepareTextGeneration(params.userId, params.owner, {
        metadata: generationRegistrationMetadata(call, params.promptName),
        onRegistered: params.onRegistered,
        onInterrupted: params.onInterrupted,
        onFailed: params.onFailed,
        workflowSignal: params.workflowSignal,
        // Validate the persisted payload inside the terminal transaction. The AI
        // SDK exposes result.output on a separate promise, which can reject only
        // after stream consumption would otherwise mark the call billable.
        onCompleted: (completed, transaction) => {
          const output = parseStructuredText(
            outputSchema,
            completed.text,
          ).elements
          params.onCompleted?.({ id: completed.id, output }, transaction)
        },
      })
      let result: ReturnType<typeof streamText>
      try {
        result = streamText({
          ...streamTextBaseOptions(call, params, system),
          output: Output.array({ element: params.element }),
        })
      } catch (error) {
        const failure = await releaseAfterStartFailure(call, error)
        return {
          ...prepared.fail(failure),
          output: rejectedOutput<Element[]>(failure),
        }
      }
      const generation = prepared.start(call.wrapStream(result.stream), {
        finishReason: result.finishReason,
        rawFinishReason: result.rawFinishReason,
        usage: result.usage,
      })
      return { ...generation, output: Promise.resolve(result.output) }
    },
    params.workflowSignal,
  )
}

export async function generateObjectStream<Result>(
  params: GenerateStreamInput & {
    schema: z.ZodType<Result>
    reasoning?: LlmCallReasoning
    onCompleted?: (
      completed: { id: string; output: Result },
      transaction: TextStreamPersistenceTransaction,
    ) => void
    onRegistered?: (
      id: string,
      transaction: TextStreamPersistenceTransaction,
    ) => void
    onFailed?: TextGenerationPersistenceCallbacks["onFailed"]
    onInterrupted?: TextGenerationPersistenceCallbacks["onInterrupted"]
  },
): Promise<GenerationHandle & { output: Promise<Result> }> {
  return enqueueStreamingGeneration(
    params.userId,
    params.promptName,
    params.reasoning ?? "disabled",
    async (call) => {
      if (call.provider === "server") {
        requirePositiveCreditBalance(params.userId)
      }
      const system = await loadStructuredPrompt(
        params.promptName,
        params.schema,
        call.supportsStructuredOutputs,
      )
      const prepared = prepareTextGeneration(params.userId, params.owner, {
        metadata: generationRegistrationMetadata(call, params.promptName),
        onRegistered: params.onRegistered,
        onFailed: params.onFailed,
        onInterrupted: params.onInterrupted,
        workflowSignal: params.workflowSignal,
        onCompleted: (completed, transaction) => {
          const output = parseStructuredText(params.schema, completed.text)
          params.onCompleted?.({ id: completed.id, output }, transaction)
        },
      })
      let result: ReturnType<typeof streamText>
      try {
        result = streamText({
          ...streamTextBaseOptions(call, params, system),
          output: Output.object({ schema: params.schema }),
        })
      } catch (error) {
        const failure = await releaseAfterStartFailure(call, error)
        return {
          ...prepared.fail(failure),
          output: rejectedOutput<Result>(failure),
        }
      }
      const generation = prepared.start(call.wrapStream(result.stream), {
        finishReason: result.finishReason,
        rawFinishReason: result.rawFinishReason,
        usage: result.usage,
      })
      return { ...generation, output: Promise.resolve(result.output) }
    },
    params.workflowSignal,
  )
}
