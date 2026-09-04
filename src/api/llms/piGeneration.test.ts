import type {
  Api,
  AssistantMessage,
  AssistantMessageEvent,
  Context,
  Model,
  Models,
  Usage,
} from "@earendil-works/pi-ai"
import { afterEach, describe, expect, it, vi } from "vitest"
import z from "zod"
import { OpenAiCodexError } from "../openaiConnection/codexErrors.ts"
import {
  startPiLlmStream,
  type PiLlmRequest,
  type PiLlmRuntime,
} from "./piGeneration.ts"
import type { LlmStreamPart, StartedLlmStream } from "./streamTypes.ts"

vi.mock("../config.ts", () => ({
  config: {
    llmExecution: {
      totalTimeoutMs: 100,
      firstChunkTimeoutMs: 40,
      chunkTimeoutMs: 25,
      maxRetries: 3,
    },
  },
}))

const usage = (overrides: Partial<Usage> = {}): Usage => ({
  input: 10,
  output: 8,
  cacheRead: 4,
  cacheWrite: 2,
  reasoning: 3,
  totalTokens: 24,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  ...overrides,
})

const message = (
  overrides: Partial<AssistantMessage> = {},
): AssistantMessage => ({
  role: "assistant",
  content: [],
  api: "openai-completions",
  provider: "deepseek",
  model: "test-model",
  usage: usage(),
  stopReason: "stop",
  rawStopReason: "stop",
  timestamp: 2,
  ...overrides,
})

function event(
  value:
    | { type: "start" }
    | { type: "thinking_delta"; delta: string }
    | { type: "text_delta"; delta: string }
    | { type: "toolcall_start"; name: string }
    | { type: "toolcall_delta"; delta: string }
    | {
      type: "toolcall_end"
      name: string
      arguments?: Record<string, unknown>
    }
    | {
      type: "done"
      reason: "stop" | "length" | "toolUse" | "deferred"
      message?: AssistantMessage
    }
    | {
      type: "error"
      reason?: "aborted" | "error"
      message: AssistantMessage
    },
): AssistantMessageEvent {
  const partial = message()
  switch (value.type) {
    case "start":
      return { type: "start", partial }
    case "thinking_delta":
    case "text_delta":
      return {
        type: value.type,
        contentIndex: 0,
        delta: value.delta,
        partial,
      }
    case "toolcall_start":
      partial.content.push({
        type: "toolCall",
        id: "tool-1",
        name: value.name,
        arguments: {},
      })
      return { type: "toolcall_start", contentIndex: 0, partial }
    case "toolcall_delta":
      return {
        type: "toolcall_delta",
        contentIndex: 0,
        delta: value.delta,
        partial,
      }
    case "toolcall_end":
      return {
        type: "toolcall_end",
        contentIndex: 0,
        toolCall: {
          type: "toolCall",
          id: "tool-1",
          name: value.name,
          arguments: value.arguments ?? {},
        },
        partial,
      }
    case "done":
      return {
        type: "done",
        reason: value.reason,
        message: value.message ?? message(),
      }
    case "error":
      return {
        type: "error",
        reason: value.reason ?? "error",
        error: value.message,
      }
  }
}

async function* events(
  ...values: AssistantMessageEvent[]
): AsyncIterable<AssistantMessageEvent> {
  await Promise.resolve()
  for (const value of values) yield value
}

async function* delayedEvents(
  values: readonly { delay: number; event: AssistantMessageEvent }[],
): AsyncIterable<AssistantMessageEvent> {
  for (const value of values) {
    await new Promise<void>((resolve) => setTimeout(resolve, value.delay))
    yield value.event
  }
}

function harness(
  source: AsyncIterable<AssistantMessageEvent>,
  overrides: Partial<PiLlmRuntime> = {},
) {
  const stream = vi.fn(
    (
      _model: Model<Api>,
      _context: Context,
      _options?: Record<string, unknown>,
    ) => source,
  )
  const model = { id: "test-model", provider: "deepseek" } as Model<Api>
  const runtime: PiLlmRuntime = {
    models: { stream } as unknown as Models,
    model,
    provider: "server",
    apiKey: "provider-key",
    reasoningEffort: "xhigh",
    ...overrides,
  }
  return { runtime, stream, model }
}

function recordedCall(stream: ReturnType<typeof harness>["stream"]) {
  const call = stream.mock.calls[0]
  if (!call?.[2]) throw new Error("Expected Pi stream call with options")
  return { model: call[0], context: call[1], options: call[2] }
}

const request = (overrides: Partial<PiLlmRequest> = {}): PiLlmRequest => ({
  system: "System instructions",
  prompt: "User request",
  temperature: 0.25,
  maxOutputTokens: 4_096,
  ...overrides,
})

async function collect(
  source: AsyncIterable<LlmStreamPart>,
): Promise<LlmStreamPart[]> {
  const result: LlmStreamPart[] = []
  for await (const part of source) result.push(part)
  return result
}

function terminalPromises(started: StartedLlmStream) {
  return Promise.allSettled([
    started.finishReason,
    started.rawFinishReason,
    started.usage,
  ])
}

afterEach(() => {
  vi.useRealTimers()
})

describe("startPiLlmStream", () => {
  it("passes the request context and exact server options to Pi", async () => {
    const done = message({ rawStopReason: "completed" })
    const { runtime, stream, model } = harness(
      events(event({ type: "done", reason: "stop", message: done })),
    )

    const started = startPiLlmStream(runtime, request())
    await collect(started.stream)

    expect(stream).toHaveBeenCalledOnce()
    const { model: actualModel, context, options } = recordedCall(stream)
    expect(actualModel).toBe(model)
    expect(context).toMatchObject({
      systemPrompt: "System instructions",
      messages: [
        {
          role: "user",
          content: "User request",
        },
      ],
    })
    const userMessage = context.messages[0]
    expect(userMessage?.role).toBe("user")
    expect(userMessage?.timestamp).toEqual(expect.any(Number))
    expect(options).toMatchObject({
      apiKey: "provider-key",
      timeoutMs: 100,
      maxRetries: 3,
      maxTokens: 4_096,
      temperature: 0.25,
      reasoningEffort: "xhigh",
      toolChoice: "none",
    })
    expect(options.signal).toBeInstanceOf(AbortSignal)
    expect(options).not.toHaveProperty("samplingParams")
  })

  it("requests server JSON mode and omits disabled reasoning", async () => {
    const { runtime, stream } = harness(
      events(event({ type: "done", reason: "stop" })),
      { reasoningEffort: "none" },
    )
    const schema = {
      type: "object",
      properties: { answer: { type: "string" } },
      required: ["answer"],
      additionalProperties: false,
    }

    const started = startPiLlmStream(runtime, request({ jsonSchema: schema }))
    await collect(started.stream)

    const { context, options } = recordedCall(stream)
    expect(context).not.toHaveProperty("tools")
    expect(options).not.toHaveProperty("reasoningEffort")
    expect(options).toMatchObject({
      toolChoice: "none",
      samplingParams: { response_format: { type: "json_object" } },
    })
  })

  it("rejects ultra instead of silently downgrading the selected effort", () => {
    const { runtime } = harness(events(), {
      provider: "codex",
      apiKey: undefined,
      reasoningEffort: "ultra",
    })

    expect(() => startPiLlmStream(runtime, request())).toThrow(
      expect.objectContaining({
        name: "OpenAiCodexError",
        code: "protocol-incompatible",
      }),
    )
  })

  it("uses one required strict synthetic tool for Codex structured output", async () => {
    const schema = z.toJSONSchema(z.object({ answer: z.string() }), {
      target: "draft-7",
    })
    const { runtime, stream } = harness(
      events(
        event({
          type: "toolcall_start",
          name: "submit_structured_output",
        }),
        event({ type: "toolcall_delta", delta: '{"answer":"yes"}' }),
        event({
          type: "toolcall_end",
          name: "submit_structured_output",
          arguments: { answer: "yes" },
        }),
        event({
          type: "done",
          reason: "toolUse",
          message: message({ rawStopReason: "completed" }),
        }),
      ),
      {
        provider: "codex",
        apiKey: undefined,
        reasoningEffort: "medium",
      },
    )

    const started = startPiLlmStream(runtime, request({ jsonSchema: schema }))
    await expect(collect(started.stream)).resolves.toEqual([
      { type: "text-delta", text: '{"answer":"yes"}' },
    ])
    await expect(started.finishReason).resolves.toBe("stop")

    const { context, options } = recordedCall(stream)
    expect(context.tools).toHaveLength(1)
    const tool = context.tools?.[0]
    expect(() => structuredClone(tool?.parameters)).not.toThrow()
    expect(tool).toMatchObject({
      name: "submit_structured_output",
      parameters: schema,
      constrainedSampling: { type: "json_schema", strict: "require" },
    })
    expect(tool?.description).toEqual(expect.any(String))
    expect(options).toMatchObject({
      timeoutMs: 100,
      maxRetries: 3,
      maxTokens: 4_096,
      temperature: 0.25,
      reasoningEffort: "medium",
      transport: "sse",
      toolChoice: "required",
    })
    expect(options.signal).toBeInstanceOf(AbortSignal)
    expect(options).not.toHaveProperty("apiKey")
    expect(options).not.toHaveProperty("samplingParams")
  })

  it("normalizes reasoning and text and preserves finish reasons and usage", async () => {
    const terminalMessage = message({
      rawStopReason: "max_tokens",
      usage: usage({
        input: 11,
        cacheRead: 5,
        cacheWrite: 2,
        output: 13,
        reasoning: 7,
        totalTokens: 31,
      }),
    })
    const { runtime } = harness(
      events(
        event({ type: "start" }),
        event({ type: "thinking_delta", delta: "consider" }),
        event({ type: "text_delta", delta: "answer" }),
        event({ type: "done", reason: "length", message: terminalMessage }),
      ),
    )

    const started = startPiLlmStream(runtime, request())
    await expect(collect(started.stream)).resolves.toEqual([
      { type: "reasoning-delta", text: "consider" },
      { type: "text-delta", text: "answer" },
    ])
    await expect(started.finishReason).resolves.toBe("length")
    await expect(started.rawFinishReason).resolves.toBe("max_tokens")
    await expect(started.usage).resolves.toEqual({
      inputTokens: 18,
      inputTokenDetails: {
        noCacheTokens: 11,
        cacheReadTokens: 5,
        cacheWriteTokens: 2,
      },
      outputTokens: 13,
      outputTokenDetails: { textTokens: 6, reasoningTokens: 7 },
      totalTokens: 31,
    })
  })

  it.each([
    ["stop", "stop"],
    ["length", "length"],
    ["toolUse", "tool-calls"],
    ["deferred", "other"],
  ] as const)("maps Pi %s completion to %s", async (reason, expected) => {
    const { runtime } = harness(
      events(event({ type: "done", reason, message: message() })),
    )
    const started = startPiLlmStream(runtime, request())
    await collect(started.stream)
    await expect(started.finishReason).resolves.toBe(expected)
  })

  it.each([
    ["content_filter", "content-filter"],
    ["new_provider_reason", "other"],
  ] as const)(
    "retains provider finish reason %s without surfacing an error part",
    async (rawStopReason, expected) => {
      const terminalMessage = message({
        rawStopReason,
        stopReason: "error",
        errorMessage: `Provider finish_reason: ${rawStopReason}`,
      })
      const { runtime } = harness(
        events(event({ type: "error", message: terminalMessage })),
      )

      const started = startPiLlmStream(runtime, request())
      await expect(collect(started.stream)).resolves.toEqual([])
      await expect(started.finishReason).resolves.toBe(expected)
      await expect(started.rawFinishReason).resolves.toBe(rawStopReason)
      await expect(started.usage).resolves.toEqual(
        expect.objectContaining({ inputTokens: 16, outputTokens: 8 }),
      )
    },
  )

  it("surfaces a regular server failure as an error part with terminal metadata", async () => {
    const providerError = message({
      rawStopReason: "network_error",
      stopReason: "error",
      errorMessage: "provider network failed",
    })
    const { runtime } = harness(
      events(event({ type: "error", reason: "error", message: providerError })),
    )

    const started = startPiLlmStream(runtime, request())
    const parts = await collect(started.stream)
    expect(parts).toHaveLength(1)
    const errorPart = parts[0]
    expect(errorPart?.type).toBe("error")
    if (errorPart?.type !== "error") throw new Error("Expected error part")
    expect(errorPart.error).toMatchObject({ message: "LLM provider failed" })
    await expect(started.finishReason).resolves.toBe("error")
    await expect(started.rawFinishReason).resolves.toBe("network_error")
  })

  it("classifies Codex errors without leaking provider error text", async () => {
    const providerError = message({
      rawStopReason: "unauthorized",
      stopReason: "error",
      errorMessage: "401 credential leaked-secret-value",
    })
    const { runtime } = harness(
      events(event({ type: "error", message: providerError })),
      { provider: "codex", apiKey: undefined },
    )

    const started = startPiLlmStream(runtime, request())
    const parts = await collect(started.stream)
    expect(parts).toHaveLength(1)
    const errorPart = parts[0]
    expect(errorPart?.type).toBe("error")
    if (errorPart?.type !== "error") throw new Error("Expected error part")
    expect(errorPart.error).toBeInstanceOf(OpenAiCodexError)
    expect(errorPart.error).toMatchObject({ code: "authentication-required" })
    expect(String(errorPart.error)).not.toContain("leaked-secret-value")
    await expect(started.finishReason).resolves.toBe("error")
    await expect(started.rawFinishReason).resolves.toBe("unauthorized")
  })

  it("rejects ordinary Codex tool calls", async () => {
    const { runtime } = harness(
      events(event({ type: "toolcall_start", name: "shell" })),
      { provider: "codex", apiKey: undefined },
    )
    const started = startPiLlmStream(runtime, request())
    const terminals = terminalPromises(started)

    await expect(collect(started.stream)).rejects.toMatchObject({
      name: "OpenAiCodexError",
      code: "tool-blocked",
    })
    const terminalResults = await terminals
    expect(terminalResults.every((result) => result.status === "rejected")).toBe(
      true,
    )
  })

  it("rejects an unavailable tool call from a server provider", async () => {
    const { runtime } = harness(
      events(event({ type: "toolcall_start", name: "shell" })),
    )
    const started = startPiLlmStream(runtime, request())
    const terminals = terminalPromises(started)

    await expect(collect(started.stream)).rejects.toThrow(
      "LLM provider attempted an unavailable tool",
    )
    await terminals
  })

  it("rejects Codex structured output that does not complete its required tool", async () => {
    const { runtime } = harness(
      events(
        event({ type: "text_delta", delta: "not a tool" }),
        event({ type: "done", reason: "stop" }),
      ),
      { provider: "codex", apiKey: undefined },
    )
    const started = startPiLlmStream(
      runtime,
      request({ jsonSchema: { type: "object" } }),
    )
    const terminals = terminalPromises(started)

    await expect(collect(started.stream)).rejects.toMatchObject({
      name: "OpenAiCodexError",
      code: "protocol-incompatible",
    })
    await terminals
  })

  it("serializes structured arguments when Pi emits no tool deltas", async () => {
    const { runtime } = harness(
      events(
        event({
          type: "toolcall_start",
          name: "submit_structured_output",
        }),
        event({
          type: "toolcall_end",
          name: "submit_structured_output",
          arguments: { answer: "yes" },
        }),
        event({ type: "done", reason: "toolUse" }),
      ),
      { provider: "codex", apiKey: undefined },
    )

    const started = startPiLlmStream(
      runtime,
      request({ jsonSchema: { type: "object" } }),
    )
    await expect(collect(started.stream)).resolves.toEqual([
      { type: "text-delta", text: '{"answer":"yes"}' },
    ])
  })

  it("times out before the first semantic content even when Pi emits metadata", async () => {
    vi.useFakeTimers()
    const { runtime, stream } = harness(
      delayedEvents([
        { delay: 0, event: event({ type: "start" }) },
        { delay: 41, event: event({ type: "text_delta", delta: "late" }) },
      ]),
    )
    const started = startPiLlmStream(runtime, request())
    const terminals = terminalPromises(started)
    const collected = collect(started.stream)
    void collected.catch(() => undefined)

    await vi.advanceTimersByTimeAsync(39)
    const { options } = recordedCall(stream)
    if (!(options.signal instanceof AbortSignal)) {
      throw new Error("Expected request signal")
    }
    expect(options.signal.aborted).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    await expect(collected).rejects.toMatchObject({ name: "TimeoutError" })
    expect(options.signal.aborted).toBe(true)
    await terminals
  })

  it("times out between semantic content chunks", async () => {
    vi.useFakeTimers()
    const { runtime } = harness(
      delayedEvents([
        { delay: 10, event: event({ type: "text_delta", delta: "first" }) },
        { delay: 26, event: event({ type: "text_delta", delta: "late" }) },
      ]),
    )
    const started = startPiLlmStream(runtime, request())
    const terminals = terminalPromises(started)
    const collected = collect(started.stream)
    void collected.catch(() => undefined)

    await vi.advanceTimersByTimeAsync(34)
    await vi.advanceTimersByTimeAsync(1)
    await expect(collected).rejects.toMatchObject({ name: "TimeoutError" })
    await terminals
  })

  it("does not let empty Pi deltas extend the inter-content deadline", async () => {
    vi.useFakeTimers()
    const { runtime } = harness(
      delayedEvents([
        { delay: 10, event: event({ type: "text_delta", delta: "first" }) },
        { delay: 20, event: event({ type: "text_delta", delta: "" }) },
        { delay: 6, event: event({ type: "text_delta", delta: "late" }) },
      ]),
    )
    const started = startPiLlmStream(runtime, request())
    const terminals = terminalPromises(started)
    const collected = collect(started.stream)
    void collected.catch(() => undefined)

    await vi.advanceTimersByTimeAsync(34)
    await vi.advanceTimersByTimeAsync(1)
    await expect(collected).rejects.toMatchObject({ name: "TimeoutError" })
    await terminals
  })

  it("enforces the total deadline despite regular content", async () => {
    vi.useFakeTimers()
    const { runtime } = harness(
      delayedEvents([
        { delay: 20, event: event({ type: "text_delta", delta: "1" }) },
        { delay: 20, event: event({ type: "text_delta", delta: "2" }) },
        { delay: 20, event: event({ type: "text_delta", delta: "3" }) },
        { delay: 20, event: event({ type: "text_delta", delta: "4" }) },
        { delay: 21, event: event({ type: "text_delta", delta: "late" }) },
      ]),
    )
    const started = startPiLlmStream(runtime, request())
    const terminals = terminalPromises(started)
    const collected = collect(started.stream)
    void collected.catch(() => undefined)

    await vi.advanceTimersByTimeAsync(99)
    await vi.advanceTimersByTimeAsync(1)
    await expect(collected).rejects.toMatchObject({ name: "TimeoutError" })
    await terminals
  })
})
