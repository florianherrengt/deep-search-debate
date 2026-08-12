import { Output, streamText } from "ai"
import PQueue from "p-queue"
import z from "zod"
import { config } from "../config.ts"
import { requirePositiveCreditBalance } from "../credits.ts"
import { calculateLlmCredits } from "./costs/index.ts"
import { PromptName, loadPrompt } from "./prompts.ts"
import { llm, type LlmCallReasoning } from "./provider.ts"
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
  model?: string
  temperature?: number
  maxOutputTokens?: number
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

function enqueueStreamingGeneration<T extends GenerationHandle>(
  start: () => T | Promise<T>,
): Promise<T> {
  const ready = Promise.withResolvers<T>()
  void llmGenerationQueue
    .add(async () => {
      const generation = await start()
      ready.resolve(generation)
      await generation.completion
    })
    .catch((error: unknown) =>
      ready.reject(asError(error, "LLM queue failed")),
    )
  return ready.promise
}

function rejectedOutput<OutputValue>(error: unknown): Promise<OutputValue> {
  const output = Promise.reject<OutputValue>(
    asError(error, "LLM generation failed"),
  )
  void output.catch(() => undefined)
  return output
}

// The SDK's default stream handler logs the complete provider error object,
// which can contain request details. Durable generation state and the bounded
// terminal log provide the diagnostics this application exposes instead.
const suppressProviderErrorLogging = () => undefined

async function loadStructuredPrompt(
  promptName: PromptName,
  schema: z.ZodType,
): Promise<string> {
  const system = await loadPrompt(promptName)
  if (llm.supportsStructuredOutputs) return system

  const jsonSchema = z.toJSONSchema(schema, { target: "draft-7" })
  return [
    system,
    "",
    "Return only valid JSON matching this JSON Schema:",
    JSON.stringify(jsonSchema),
  ].join("\n")
}

export async function generateTextStream(
  params: GenerateStreamInput &
    TextGenerationPersistenceCallbacks & { reasoning: LlmCallReasoning },
): Promise<GenerationHandle> {
  const model = llm.model(params.model)
  const system = await loadPrompt(params.promptName)
  return enqueueStreamingGeneration(() => {
    requirePositiveCreditBalance(params.userId)
    const prepared = prepareTextGeneration(params.userId, params.owner, {
      onRegistered: params.onRegistered,
      onCompleted: params.onCompleted,
      onFailed: params.onFailed,
      metadata: {
        modelId: model.modelId,
        promptName: params.promptName,
        calculateCredits: (usage) =>
          calculateLlmCredits(config.llm, model.modelId, usage),
      },
    })
    try {
      const result = streamText({
        model,
        prompt: params.prompt,
        system,
        temperature: params.temperature,
        maxOutputTokens: boundedOutputTokens(params.maxOutputTokens),
        maxRetries: config.llmExecution.maxRetries,
        timeout: streamTimeout,
        onError: suppressProviderErrorLogging,
        ...llm.callOptions(params.reasoning),
      })
      return prepared.start(result.stream, {
        finishReason: result.finishReason,
        usage: result.usage,
      })
    } catch (error) {
      return prepared.fail(error)
    }
  })
}

/** Generates the immutable display title used before a durable job starts. */
export async function generatePromptTitle(
  userId: string,
  prompt: string,
): Promise<string> {
  const generation = await generateObjectStream({
    userId,
    owner: { standalone: true },
    prompt: `<user_request>\n${prompt}\n</user_request>`,
    promptName: PromptName.GeneratePromptTitle,
    maxOutputTokens: 50,
    schema: promptTitleSchema,
  })
  return (await awaitGenerationOutput(generation, generation.output)).title
}

export async function generateArrayStream<Element>(
  params: GenerateStreamInput & {
    element: z.ZodType<Element>
    onRegistered?: TextGenerationPersistenceCallbacks["onRegistered"]
  },
): Promise<
  GenerationHandle & {
    output: Promise<Element[]>
  }
> {
  const outputSchema = z.object({ elements: z.array(params.element) })
  const model = llm.model(params.model)
  const system = await loadStructuredPrompt(params.promptName, outputSchema)
  return enqueueStreamingGeneration(() => {
    requirePositiveCreditBalance(params.userId)
    const prepared = prepareTextGeneration(params.userId, params.owner, {
      metadata: {
        modelId: model.modelId,
        promptName: params.promptName,
        calculateCredits: (usage) =>
          calculateLlmCredits(config.llm, model.modelId, usage),
      },
      onRegistered: params.onRegistered,
    })
    try {
      const result = streamText({
        model,
        prompt: params.prompt,
        system,
        temperature: params.temperature,
        maxOutputTokens: boundedOutputTokens(params.maxOutputTokens),
        maxRetries: config.llmExecution.maxRetries,
        timeout: streamTimeout,
        onError: suppressProviderErrorLogging,
        ...llm.callOptions("disabled"),
        output: Output.array({ element: params.element }),
      })
      const generation = prepared.start(result.stream, {
        finishReason: result.finishReason,
        usage: result.usage,
      })
      return { ...generation, output: Promise.resolve(result.output) }
    } catch (error) {
      return {
        ...prepared.fail(error),
        output: rejectedOutput<Element[]>(error),
      }
    }
  })
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
  },
): Promise<GenerationHandle & { output: Promise<Result> }> {
  const model = llm.model(params.model)
  const system = await loadStructuredPrompt(params.promptName, params.schema)
  return enqueueStreamingGeneration(() => {
    requirePositiveCreditBalance(params.userId)
    const prepared = prepareTextGeneration(params.userId, params.owner, {
      metadata: {
        modelId: model.modelId,
        promptName: params.promptName,
        calculateCredits: (usage) =>
          calculateLlmCredits(config.llm, model.modelId, usage),
      },
      onRegistered: params.onRegistered,
      onCompleted: params.onCompleted
        ? (completed, transaction) => {
            const output = params.schema.parse(
              JSON.parse(completed.text) as unknown,
            )
            params.onCompleted?.(
              { id: completed.id, output },
              transaction,
            )
          }
          : undefined,
    })
    try {
      const result = streamText({
        model,
        prompt: params.prompt,
        system,
        temperature: params.temperature,
        maxOutputTokens: boundedOutputTokens(params.maxOutputTokens),
        maxRetries: config.llmExecution.maxRetries,
        timeout: streamTimeout,
        onError: suppressProviderErrorLogging,
        ...llm.callOptions(params.reasoning ?? "disabled"),
        output: Output.object({ schema: params.schema }),
      })
      const generation = prepared.start(result.stream, {
        finishReason: result.finishReason,
        usage: result.usage,
      })
      return { ...generation, output: Promise.resolve(result.output) }
    } catch (error) {
      return {
        ...prepared.fail(error),
        output: rejectedOutput<Result>(error),
      }
    }
  })
}
