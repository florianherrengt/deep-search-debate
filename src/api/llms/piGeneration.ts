import {
  Type,
  type Api,
  type AssistantMessage,
  type AssistantMessageEvent,
  type Context,
  type Model,
  type Models,
  type OpenAICodexResponsesOptions,
  type OpenAICompletionsOptions,
  type Usage,
} from "@earendil-works/pi-ai"

import { config } from "../config.ts"
import {
  classifyCodexError,
  OpenAiCodexError,
} from "../openaiConnection/codexErrors.ts"
import type { LlmReasoningEffort } from "./modelSettings.ts"
import type {
  LlmFinishReason,
  LlmStreamPart,
  LlmUsage,
  StartedLlmStream,
} from "./streamTypes.ts"

const STRUCTURED_OUTPUT_TOOL = "submit_structured_output"

export type PiLlmRuntime = {
  models: Models
  model: Model<Api>
  provider: "server" | "codex"
  apiKey?: string
  reasoningEffort: LlmReasoningEffort
}

export type PiLlmRequest = {
  system: string
  prompt: string
  temperature?: number
  workflowSignal?: AbortSignal
  jsonSchema?: Record<string, unknown>
}

class LlmTimeoutError extends Error {
  override readonly name = "TimeoutError"
  constructor() {
    super("LLM generation timed out")
  }
}

function piUsage(usage: Usage): LlmUsage {
  const reasoning = usage.reasoning
  const inputTokens = usage.input + usage.cacheRead + usage.cacheWrite
  return {
    inputTokens,
    inputTokenDetails: {
      noCacheTokens: usage.input,
      cacheReadTokens: usage.cacheRead,
      cacheWriteTokens: usage.cacheWrite,
    },
    outputTokens: usage.output,
    outputTokenDetails: {
      textTokens: reasoning === undefined
        ? usage.output
        : Math.max(0, usage.output - reasoning),
      reasoningTokens: reasoning,
    },
    totalTokens: usage.totalTokens,
  }
}

function finishReason(
  reason: "stop" | "length" | "toolUse" | "deferred",
  structuredCodex: boolean,
): LlmFinishReason {
  switch (reason) {
    case "stop":
      return "stop"
    case "length":
      return "length"
    case "toolUse":
      return structuredCodex ? "stop" : "tool-calls"
    case "deferred":
      return "other"
  }
}

function providerFinishError(
  message: AssistantMessage,
): LlmFinishReason | undefined {
  if (message.rawStopReason === "content_filter") return "content-filter"
  if (
    message.rawStopReason &&
    message.rawStopReason !== "network_error" &&
    message.errorMessage?.includes("Provider finish_reason:")
  ) {
    return "other"
  }
  return undefined
}

function safeProviderError(
  provider: PiLlmRuntime["provider"],
  error: unknown,
): Error {
  return provider === "codex"
    ? classifyCodexError(error)
    : error instanceof Error
      ? error
      : new Error("LLM provider failed", { cause: error })
}

function structuredOutputTool(schema: Record<string, unknown>) {
  return {
    name: STRUCTURED_OUTPUT_TOOL,
    description: "Return the complete structured result for this request.",
    // Zod's JSON Schema result carries a non-enumerable Standard Schema
    // validator. Strip that runtime metadata before Pi clones the tool schema.
    parameters: Type.Unsafe(structuredClone(schema)),
    constrainedSampling: {
      type: "json_schema" as const,
      strict: "require" as const,
    },
  }
}

function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException("The operation was aborted", "AbortError")
}

async function nextWithDeadline<Value>(
  iterator: AsyncIterator<Value>,
  deadline: number,
  signal: AbortSignal,
): Promise<IteratorResult<Value>> {
  if (signal.aborted) throw abortReason(signal)
  const remaining = deadline - Date.now()
  if (remaining <= 0) throw new LlmTimeoutError()

  let timeout: NodeJS.Timeout | undefined
  let rejectOnAbort: ((reason: unknown) => void) | undefined
  const timedOut = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => reject(new LlmTimeoutError()), remaining)
  })
  const aborted = new Promise<never>((_resolve, reject) => {
    rejectOnAbort = reject
  })
  const onAbort = () => rejectOnAbort?.(abortReason(signal))
  signal.addEventListener("abort", onAbort, { once: true })
  try {
    return await Promise.race([iterator.next(), timedOut, aborted])
  } finally {
    if (timeout) clearTimeout(timeout)
    signal.removeEventListener("abort", onAbort)
  }
}

async function* withContentDeadlines(
  source: AsyncIterable<LlmStreamPart>,
  requestController: AbortController,
  signal: AbortSignal,
): AsyncIterable<LlmStreamPart> {
  const iterator = source[Symbol.asyncIterator]()
  const startedAt = Date.now()
  let lastContentAt: number | undefined
  let completed = false
  try {
    while (true) {
      const contentDeadline = lastContentAt === undefined
        ? startedAt + config.llmExecution.firstChunkTimeoutMs
        : lastContentAt + config.llmExecution.chunkTimeoutMs
      const deadline = Math.min(
        startedAt + config.llmExecution.totalTimeoutMs,
        contentDeadline,
      )
      const result = await nextWithDeadline(iterator, deadline, signal)
      if (result.done) {
        completed = true
        return
      }
      lastContentAt = Date.now()
      yield result.value
    }
  } catch (error) {
    if (error instanceof LlmTimeoutError) requestController.abort(error)
    throw error
  } finally {
    // A provider iterator can still be blocked in `next()` while this wrapper
    // times out. Do not let an uncooperative iterator delay the timeout that the
    // application has already decided to surface. The request signal above is
    // the authoritative cancellation mechanism; this is best-effort cleanup.
    if (!completed) void iterator.return?.().catch(() => undefined)
  }
}

function createPiOptions(
  runtime: PiLlmRuntime,
  request: PiLlmRequest,
  signal: AbortSignal,
): OpenAICompletionsOptions | OpenAICodexResponsesOptions {
  if (runtime.reasoningEffort === "ultra") {
    throw runtime.provider === "codex"
      ? new OpenAiCodexError("protocol-incompatible")
      : new Error("The selected provider does not support ultra reasoning")
  }
  const common = {
    ...(runtime.apiKey !== undefined && { apiKey: runtime.apiKey }),
    signal,
    timeoutMs: config.llmExecution.totalTimeoutMs,
    maxRetries: config.llmExecution.maxRetries,
    ...(request.temperature !== undefined && {
      temperature: request.temperature,
    }),
  }
  if (runtime.provider === "codex") {
    return {
      ...common,
      reasoningEffort: runtime.reasoningEffort,
      transport: "sse",
      toolChoice: request.jsonSchema ? "required" : "none",
    }
  }
  return {
    ...common,
    ...(runtime.reasoningEffort !== "none" && {
      reasoningEffort: runtime.reasoningEffort,
    }),
    toolChoice: "none",
    ...(request.jsonSchema && {
      samplingParams: { response_format: { type: "json_object" } },
    }),
  }
}

function normalizePiStream(
  piStream: AsyncIterable<AssistantMessageEvent>,
  runtime: PiLlmRuntime,
  structuredCodex: boolean,
  settle: (terminal: {
    finishReason: LlmFinishReason
    rawFinishReason: string | undefined
    usage: LlmUsage
  }) => void,
): AsyncIterable<LlmStreamPart> {
  return {
    async *[Symbol.asyncIterator]() {
      let structuredStarted = false
      let structuredCompleted = false
      let structuredText = ""
      for await (const event of piStream) {
        switch (event.type) {
          case "thinking_delta":
            if (event.delta) {
              yield { type: "reasoning-delta", text: event.delta }
            }
            break
          case "text_delta":
            if (structuredCodex) {
              throw new OpenAiCodexError("protocol-incompatible")
            }
            if (event.delta) yield { type: "text-delta", text: event.delta }
            break
          case "toolcall_start": {
            const content = event.partial.content[event.contentIndex]
            if (
              !structuredCodex ||
              structuredStarted ||
              content?.type !== "toolCall" ||
              content.name !== STRUCTURED_OUTPUT_TOOL
            ) {
              throw runtime.provider === "codex"
                ? new OpenAiCodexError("tool-blocked")
                : new Error("LLM provider attempted an unavailable tool")
            }
            structuredStarted = true
            break
          }
          case "toolcall_delta":
            if (!structuredCodex || !structuredStarted) {
              throw runtime.provider === "codex"
                ? new OpenAiCodexError("tool-blocked")
                : new Error("LLM provider attempted an unavailable tool")
            }
            structuredText += event.delta
            if (event.delta) yield { type: "text-delta", text: event.delta }
            break
          case "toolcall_end":
            if (
              !structuredCodex ||
              !structuredStarted ||
              structuredCompleted ||
              event.toolCall.name !== STRUCTURED_OUTPUT_TOOL
            ) {
              throw runtime.provider === "codex"
                ? new OpenAiCodexError("tool-blocked")
                : new Error("LLM provider attempted an unavailable tool")
            }
            structuredCompleted = true
            if (!structuredText) {
              yield {
                type: "text-delta",
                text: JSON.stringify(event.toolCall.arguments),
              }
            }
            break
          case "done":
            if (structuredCodex && !structuredCompleted) {
              throw new OpenAiCodexError("protocol-incompatible")
            }
            settle({
              finishReason: finishReason(event.reason, structuredCodex),
              rawFinishReason: event.message.rawStopReason,
              usage: piUsage(event.message.usage),
            })
            return
          case "error": {
            const normalizedFinish = providerFinishError(event.error)
            if (normalizedFinish) {
              settle({
                finishReason: normalizedFinish,
                rawFinishReason: event.error.rawStopReason,
                usage: piUsage(event.error.usage),
              })
              return
            }
            settle({
              finishReason: "error",
              rawFinishReason: event.error.rawStopReason ?? event.reason,
              usage: piUsage(event.error.usage),
            })
            yield {
              type: "error",
              error: safeProviderError(
                runtime.provider,
                event.error.errorMessage ?? event.reason,
              ),
            }
            return
          }
          case "start":
          case "text_start":
          case "text_end":
          case "thinking_start":
          case "thinking_end":
            break
        }
      }
      throw new Error("LLM provider stream ended without a terminal event")
    },
  }
}

/** Starts one Pi request while retaining the app's durable stream contract. */
export function startPiLlmStream(
  runtime: PiLlmRuntime,
  request: PiLlmRequest,
): StartedLlmStream {
  const requestController = new AbortController()
  const signal = request.workflowSignal
    ? AbortSignal.any([request.workflowSignal, requestController.signal])
    : requestController.signal
  const context: Context = {
    systemPrompt: request.system,
    messages: [{ role: "user", content: request.prompt, timestamp: Date.now() }],
    ...(runtime.provider === "codex" && request.jsonSchema && {
      tools: [structuredOutputTool(request.jsonSchema)],
    }),
  }
  const options = createPiOptions(runtime, request, signal)
  const terminal = Promise.withResolvers<{
    finishReason: LlmFinishReason
    rawFinishReason: string | undefined
    usage: LlmUsage
  }>()
  let settled = false
  const settle = (value: Parameters<typeof terminal.resolve>[0]) => {
    if (settled) return
    settled = true
    terminal.resolve(value)
  }
  const fail = (error: unknown) => {
    if (settled) return
    settled = true
    terminal.reject(error)
  }
  void terminal.promise.catch(() => undefined)

  const piStream = runtime.models.stream(runtime.model, context, options)
  const normalized = normalizePiStream(
    piStream,
    runtime,
    runtime.provider === "codex" && request.jsonSchema !== undefined,
    settle,
  )
  const timed = withContentDeadlines(normalized, requestController, signal)
  const stream: AsyncIterable<LlmStreamPart> = {
    async *[Symbol.asyncIterator]() {
      try {
        for await (const part of timed) yield part
      } catch (error) {
        const safeError = safeProviderError(runtime.provider, error)
        fail(safeError)
        throw safeError
      } finally {
        requestController.abort()
      }
    },
  }

  const finishReasonPromise = terminal.promise.then(
    (value) => value.finishReason,
  )
  const rawFinishReasonPromise = terminal.promise.then(
    (value) => value.rawFinishReason,
  )
  const usagePromise = terminal.promise.then((value) => value.usage)
  // Consumers commonly read terminal metadata after exhausting the stream.
  // Mark these derived promises handled immediately so a stream failure cannot
  // produce process-level unhandled-rejection noise in that interval.
  void finishReasonPromise.catch(() => undefined)
  void rawFinishReasonPromise.catch(() => undefined)
  void usagePromise.catch(() => undefined)

  return {
    stream,
    finishReason: finishReasonPromise,
    rawFinishReason: rawFinishReasonPromise,
    usage: usagePromise,
  }
}
