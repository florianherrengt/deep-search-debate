import type {
  Api,
  AssistantMessage,
  AssistantMessageEvent,
  Context,
  Model,
  Models,
  Usage,
} from "@earendil-works/pi-ai"
import { createModels, InMemoryCredentialStore } from "@earendil-works/pi-ai"
import { deepseekProvider } from "@earendil-works/pi-ai/providers/deepseek"
import { openaiCodexProvider } from "@earendil-works/pi-ai/providers/openai-codex"
import { afterEach, describe, expect, it, vi } from "vitest"
import z from "zod"
import { OpenAiCodexError } from "../openaiConnection/codexErrors.ts"
import { workflowAbortReason } from "../workflowRuntime.ts"
import {
  createLlmProviderDiagnostics,
  observeLlmProviderRequests,
} from "./providerDiagnostics.ts"
import {
  startPiLlmStream,
  type PiLlmRequest,
  type PiLlmRuntime,
} from "./piGeneration.ts"
import type { LlmStreamPart, StartedLlmStream } from "./streamTypes.ts"

vi.mock("../config.ts", () => ({
  config: {
    llmExecution: {
      // Deliberately retain the obsolete setting to prove it cannot cap a stream.
      totalTimeoutMs: 300_000,
      firstChunkTimeoutMs: 600_000,
      chunkTimeoutMs: 600_000,
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
  ...overrides,
})

async function collect(
  source: AsyncIterable<LlmStreamPart>,
): Promise<LlmStreamPart[]> {
  const result: LlmStreamPart[] = []
  for await (const part of source) result.push(part)
  return result
}

async function codexRuntime() {
  const credentials = new InMemoryCredentialStore()
  const tokenPayload = Buffer.from(JSON.stringify({
    "https://api.openai.com/auth": { chatgpt_account_id: "synthetic-account" },
  })).toString("base64url")
  await credentials.modify("openai-codex", () => Promise.resolve({
    type: "oauth",
    access: `synthetic.${tokenPayload}.signature`,
    refresh: "synthetic-refresh-token",
    expires: Date.now() + 3_600_000,
    accountId: "synthetic-account",
  }))
  const models = createModels({ credentials })
  models.setProvider(openaiCodexProvider())
  const model = models.getModel("openai-codex", "gpt-5.6-sol")
  if (!model) throw new Error("Expected the configured Codex model")
  return { models, model, provider: "codex" as const, reasoningEffort: "medium" as const }
}

function responseEvents(...events: Record<string, unknown>[]) {
  const body = events.map((value) => `data: ${JSON.stringify(value)}\n\n`).join("")
  return new Response(body, {
    headers: { "content-type": "text/event-stream", "x-request-id": "req_sse_123" },
  })
}

const structuredCodexEvents = () => {
  const item = {
    id: "fc_test",
    type: "function_call",
    call_id: "call_test",
    name: "submit_structured_output",
    arguments: '{"answer":"answer"}',
    status: "completed",
  }
  return [
    { type: "response.created", response: { id: "resp_test", status: "in_progress" } },
    { type: "response.output_item.added", output_index: 0, item: { ...item, arguments: "", status: "in_progress" } },
    { type: "response.function_call_arguments.delta", output_index: 0, delta: '{"answer":"answer"}' },
    { type: "response.function_call_arguments.done", output_index: 0, arguments: '{"answer":"answer"}' },
    { type: "response.output_item.done", output_index: 0, item },
    { type: "response.completed", response: { id: "resp_test", status: "completed", output: [item] } },
  ]
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
  vi.unstubAllGlobals()
})

describe("startPiLlmStream", () => {
  it("retains safe SSE diagnostics when a successful HTTP response fails mid-stream", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(() => Promise.resolve(responseEvents({
      type: "response.failed",
      response: {
        error: {
          code: "upstream_overloaded",
          type: "server_error",
          param: "model",
          message: "private provider detail and synthetic-access-token",
        },
      },
    })))
    vi.stubGlobal("fetch", fetch)
    const started = startPiLlmStream(await codexRuntime(), request({
      prompt: "private prompt content",
    }))

    const parts = await collect(started.stream)
    expect(parts).toMatchObject([{
      type: "error",
      error: {
        name: "OpenAiCodexError",
        code: "temporarily-unavailable",
        message: "OpenAI Codex is temporarily unavailable. Try again later.",
      },
    }])
    const diagnostics = started.diagnostics
    expect(diagnostics).toMatchObject({
      attempts: [{
        attempt: 1,
        status: 200,
        requestId: "req_sse_123",
      }],
      failures: [{
        attempt: 1,
        source: "sse",
        eventType: "response.failed",
        code: "upstream_overloaded",
        type: "server_error",
        param: "model",
      }],
    })
    expect(diagnostics?.attemptCount).toBe(1)
    expect(diagnostics?.maxRetries).toBe(3)
    expect(diagnostics?.firstChunkTimeoutMs).toBeGreaterThan(0)
    expect(diagnostics?.chunkTimeoutMs).toBeGreaterThan(0)
    expect(typeof diagnostics?.attempts[0]?.durationMs).toBe("number")
    expect(diagnostics?.attempts[0]?.durationMs).toBeGreaterThanOrEqual(0)
    const serialized = JSON.stringify(diagnostics)
    expect(serialized).not.toContain("synthetic-access-token")
    expect(serialized).not.toContain("private prompt content")
    expect(serialized).not.toContain("private provider detail")
    expect(fetch).toHaveBeenCalledOnce()
  })

  it("retains the safe code from a top-level Codex error event", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(() => Promise.resolve(responseEvents({
      type: "error",
      code: "server_error",
      message: "private top-level error detail",
    })))
    vi.stubGlobal("fetch", fetch)
    const started = startPiLlmStream(await codexRuntime(), request())

    await expect(collect(started.stream)).resolves.toMatchObject([{
      type: "error",
      error: { code: "temporarily-unavailable" },
    }])
    expect(started.diagnostics?.failures).toMatchObject([{
      attempt: 1,
      source: "sse",
      eventType: "error",
      code: "server_error",
    }])
    expect(JSON.stringify(started.diagnostics)).not.toContain("private top-level error detail")
    expect(fetch).toHaveBeenCalledOnce()
  })

  it("records request IDs and each HTTP retry while allowing the eventual response through", async () => {
    vi.useFakeTimers()
    let attempt = 0
    const fetch = vi.fn<typeof globalThis.fetch>(() => {
      attempt += 1
      if (attempt < 3) {
        return Promise.resolve(new Response(JSON.stringify({
          error: {
            code: "server_overloaded",
            type: "server_error",
            message: "synthetic retry detail",
          },
        }), {
          status: 503,
          headers: {
            "content-type": "application/json",
            "x-request-id": `req_http_${attempt}`,
            "retry-after-ms": "0",
          },
        }))
      }
      const item = {
        id: "fc_test",
        type: "function_call",
        call_id: "call_test",
        name: "submit_structured_output",
        arguments: '{"answer":"answer"}',
        status: "completed",
      }
      return Promise.resolve(responseEvents(
        { type: "response.created", response: { id: "resp_test", status: "in_progress" } },
        { type: "response.output_item.added", output_index: 0, item: { ...item, arguments: "", status: "in_progress" } },
        { type: "response.function_call_arguments.delta", output_index: 0, delta: '{"answer":"answer"}' },
        { type: "response.function_call_arguments.done", output_index: 0, arguments: '{"answer":"answer"}' },
        { type: "response.output_item.done", output_index: 0, item },
        { type: "response.completed", response: { id: "resp_test", status: "completed", output: [item] } },
      ))
    })
    vi.stubGlobal("fetch", fetch)
    const started = startPiLlmStream(await codexRuntime(), request({
      jsonSchema: {
        type: "object",
        properties: { answer: { type: "string" } },
        required: ["answer"],
        additionalProperties: false,
      },
    }))
    const collected = collect(started.stream)
    void collected.catch(() => undefined)
    await vi.runAllTimersAsync()
    expect(fetch).toHaveBeenCalledTimes(3)
    await expect(collected).resolves.toContainEqual({
      type: "text-delta",
      text: '{"answer":"answer"}',
    })

    const diagnostics = started.diagnostics
    expect(diagnostics?.attempts).toHaveLength(3)
    expect(diagnostics?.attempts).toMatchObject([
      { attempt: 1, status: 503, requestId: "req_http_1", retryAfterMs: 0 },
      { attempt: 2, status: 503, requestId: "req_http_2", retryAfterMs: 0 },
      { attempt: 3, status: 200, requestId: "req_sse_123" },
    ])
    for (const attempt of diagnostics?.attempts ?? []) {
      expect(typeof attempt.durationMs).toBe("number")
      expect(attempt.durationMs).toBeGreaterThanOrEqual(0)
    }
    expect(diagnostics?.attemptCount).toBe(3)
    expect(diagnostics?.maxRetries).toBe(3)
    expect(diagnostics?.failures).toMatchObject([
      { attempt: 1, source: "http", code: "server_overloaded", type: "server_error" },
      { attempt: 2, source: "http", code: "server_overloaded", type: "server_error" },
    ])
    expect(fetch).toHaveBeenCalledTimes(3)
  })

  it("classifies retried ECONNRESET failures without retaining raw transport text", async () => {
    vi.useFakeTimers()
    const fetch = vi.fn<typeof globalThis.fetch>(() => Promise.reject(
      Object.assign(new Error("socket hang up with synthetic-access-token"), {
        code: "ECONNRESET",
      }),
    ))
    vi.stubGlobal("fetch", fetch)
    const started = startPiLlmStream(await codexRuntime(), request())
    const collected = collect(started.stream)
    void collected.catch(() => undefined)
    await vi.runAllTimersAsync()
    await expect(collected).resolves.toMatchObject([{
      type: "error",
      error: { code: "temporarily-unavailable" },
    }])

    const diagnostics = started.diagnostics
    expect(diagnostics?.attempts).toHaveLength(4)
    expect(diagnostics?.attempts).toEqual(expect.arrayContaining([
      expect.objectContaining({ transportFailure: "connection-reset", transportCode: "ECONNRESET" }),
    ]))
    expect(JSON.stringify(diagnostics)).not.toContain("socket hang up")
    expect(JSON.stringify(diagnostics)).not.toContain("synthetic-access-token")
    expect(fetch).toHaveBeenCalledTimes(4)
  })

  it.each([
    [
      "an upstream stream that closes before a terminal event",
      "data: {\"type\":\"response.created\",\"response\":{\"id\":\"resp_open\",\"status\":\"in_progress\"}}\n\n",
      { streamEnd: "eof-before-terminal" },
    ],
    [
      "malformed SSE JSON",
      "data: {\"type\":\"response.created\",\n\n",
      { parseFailure: "invalid-sse-json" },
    ],
  ] as const)("records bounded diagnostics for %s", async (_description, body, expected) => {
    const fetch = vi.fn<typeof globalThis.fetch>(() => Promise.resolve(new Response(body, {
      headers: { "content-type": "text/event-stream", "x-request-id": "req_bad_sse" },
    })))
    vi.stubGlobal("fetch", fetch)
    const started = startPiLlmStream(await codexRuntime(), request())
    await collect(started.stream)

    expect(started.diagnostics).toMatchObject({
      attempts: [{ attempt: 1, status: 200, requestId: "req_bad_sse" }],
      ...expected,
    })
    expect(fetch).toHaveBeenCalledOnce()
  })

  it("records malformed non-JSON SSE data without masking the provider parser error", async () => {
    const body = "data: garbage\n\n"
    const fetch = vi.fn<typeof globalThis.fetch>(() => Promise.resolve(new Response(body, {
      headers: { "content-type": "text/event-stream", "x-request-id": "req_garbage_sse" },
    })))
    vi.stubGlobal("fetch", fetch)
    const started = startPiLlmStream(await codexRuntime(), request())

    await expect(collect(started.stream)).resolves.toMatchObject([{
      type: "error",
      error: { code: "temporarily-unavailable" },
    }])
    expect(started.diagnostics).toMatchObject({
      attempts: [{ status: 200, requestId: "req_garbage_sse" }],
      parseFailure: "invalid-sse-json",
    })
    expect(fetch).toHaveBeenCalledOnce()
  })

  it("passes malformed SSE bytes unchanged while recording the parse failure", async () => {
    const originalBytes = new TextEncoder().encode("data: garbage\n\n")
    const diagnostics = createLlmProviderDiagnostics({
      maxRetries: 3,
      firstChunkTimeoutMs: 10,
      chunkTimeoutMs: 10,
      reasoningEffort: "medium",
    })
    const fetch = vi.fn<typeof globalThis.fetch>(() => Promise.resolve(new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(originalBytes.slice(0, 8))
          controller.enqueue(originalBytes.slice(8))
          controller.close()
        },
      }),
      { headers: { "content-type": "text/event-stream" } },
    )))
    const observedFetch = observeLlmProviderRequests(diagnostics, fetch)
    const response = await observedFetch("https://codex.test/responses")

    await expect(response.arrayBuffer()).resolves.toEqual(originalBytes.buffer.slice(
      originalBytes.byteOffset,
      originalBytes.byteOffset + originalBytes.byteLength,
    ))
    expect(diagnostics.parseFailure).toBe("invalid-sse-json")
    expect(fetch).toHaveBeenCalledOnce()
  })

  it("waits for an upstream cancellation requested before reading and does not label it EOF", async () => {
    const upstreamCancellation = Promise.withResolvers<void>()
    const cancel = vi.fn(() => upstreamCancellation.promise)
    const diagnostics = createLlmProviderDiagnostics({
      maxRetries: 3,
      firstChunkTimeoutMs: 10,
      chunkTimeoutMs: 10,
      reasoningEffort: "medium",
    })
    const fetch = vi.fn<typeof globalThis.fetch>(() => Promise.resolve(new Response(
      new ReadableStream<Uint8Array>({ cancel }),
      { headers: { "content-type": "text/event-stream" } },
    )))
    const response = await observeLlmProviderRequests(diagnostics, fetch)(
      "https://codex.test/responses",
    )
    let settled = false
    const cancellation = response.body?.cancel("user stopped")
    void cancellation?.then(() => {
      settled = true
    })
    await Promise.resolve()
    expect(cancel).toHaveBeenCalledOnce()
    expect(settled).toBe(false)
    expect(diagnostics.streamEnd).toBeUndefined()

    upstreamCancellation.resolve()
    await cancellation
    expect(settled).toBe(true)
    expect(cancel).toHaveBeenCalledOnce()
    expect(diagnostics.streamEnd).toBeUndefined()
  })

  it("preserves an upstream cancellation rejection without recording a provider failure", async () => {
    const cancellationError = new Error("upstream cancellation failed")
    const cancel = vi.fn(() => Promise.reject(cancellationError))
    const diagnostics = createLlmProviderDiagnostics({
      maxRetries: 3,
      firstChunkTimeoutMs: 10,
      chunkTimeoutMs: 10,
      reasoningEffort: "medium",
    })
    const fetch = vi.fn<typeof globalThis.fetch>(() => Promise.resolve(new Response(
      new ReadableStream<Uint8Array>({ cancel }),
      { headers: { "content-type": "text/event-stream" } },
    )))
    const response = await observeLlmProviderRequests(diagnostics, fetch)(
      "https://codex.test/responses",
    )

    await expect(response.body?.cancel("user stopped")).rejects.toBe(cancellationError)
    expect(cancel).toHaveBeenCalledOnce()
    expect(diagnostics.attempts[0]?.transportFailure).toBeUndefined()
    expect(diagnostics.streamEnd).toBeUndefined()
  })

  it.each([
    ["a timed out fetch", "AbortError", "TimeoutError", "timeout"],
    ["a user abort", "AbortError", "AbortError", undefined],
  ] as const)("classifies %s without confusing it with a transport reset", async (_description, errorName, reasonName, category) => {
    const error = new DOMException("request stopped", errorName)
    const signal = AbortSignal.abort(new DOMException("signal stopped", reasonName))
    const diagnostics = createLlmProviderDiagnostics({
      maxRetries: 3,
      firstChunkTimeoutMs: 10,
      chunkTimeoutMs: 10,
      reasoningEffort: "medium",
    })
    const fetch = vi.fn<typeof globalThis.fetch>(() => Promise.reject(error))
    const observedFetch = observeLlmProviderRequests(diagnostics, fetch)

    await expect(observedFetch("https://codex.test/responses", { signal })).rejects.toBe(error)
    expect(diagnostics.attempts).toHaveLength(1)
    expect(diagnostics.attempts[0]?.transportFailure).toBe(category)
    expect(fetch).toHaveBeenCalledOnce()
  })

  it("preserves split and oversized SSE frames for the provider parser", async () => {
    const events = structuredCodexEvents()
    const unknownFrame = `data: ${JSON.stringify({
      type: "response.unknown",
      padding: "x".repeat(128 * 1024),
    })}\n\n`
    const body = `${unknownFrame}${events.map((value) => `data: ${JSON.stringify(value)}\n\n`).join("")}`
    const bytes = new TextEncoder().encode(body)
    const chunks = [bytes.slice(0, 11), bytes.slice(11, 29), bytes.slice(29, 65), bytes.slice(65)]
    const fetch = vi.fn<typeof globalThis.fetch>(() => Promise.resolve(new Response(
      new ReadableStream({
        start(controller) {
          for (const chunk of chunks) controller.enqueue(chunk)
          controller.close()
        },
      }),
      { headers: { "content-type": "text/event-stream", "x-request-id": "req_split_sse" } },
    )))
    vi.stubGlobal("fetch", fetch)
    const started = startPiLlmStream(await codexRuntime(), request({
      jsonSchema: {
        type: "object",
        properties: { answer: { type: "string" } },
        required: ["answer"],
        additionalProperties: false,
      },
    }))

    await expect(collect(started.stream)).resolves.toContainEqual({
      type: "text-delta",
      text: '{"answer":"answer"}',
    })
    expect(started.diagnostics?.truncated).toBe(true)
    expect(fetch).toHaveBeenCalledOnce()
  })

  it.each([
    ["LF", "\n\n"],
    ["CRLF", "\r\n\r\n"],
  ] as const)("captures an error after an oversized %s frame when its delimiter spans chunks", async (_newline, delimiter) => {
    const oversizedFrame = `:${"x".repeat(128 * 1024)}${delimiter}`
    const errorFrame = `data: ${JSON.stringify({
      type: "error",
      code: "server_error",
      message: "private error after oversized frame",
    })}\n\n`
    const body = `${oversizedFrame}${errorFrame}`
    const encoder = new TextEncoder()
    const bytes = encoder.encode(body)
    const splitAt = encoder.encode(`:${"x".repeat(128 * 1024)}${delimiter.slice(0, -1)}`).byteLength
    const fetch = vi.fn<typeof globalThis.fetch>(() => Promise.resolve(new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(bytes.slice(0, splitAt))
          controller.enqueue(bytes.slice(splitAt))
          controller.close()
        },
      }),
      { headers: { "content-type": "text/event-stream", "x-request-id": "req_oversized_error" } },
    )))
    vi.stubGlobal("fetch", fetch)
    const started = startPiLlmStream(await codexRuntime(), request())

    await expect(collect(started.stream)).resolves.toMatchObject([{
      type: "error",
      error: { code: "temporarily-unavailable" },
    }])
    expect(started.diagnostics).toMatchObject({
      attempts: [{ status: 200, requestId: "req_oversized_error" }],
      failures: [{ source: "sse", eventType: "error", code: "server_error" }],
      truncated: true,
    })
    expect(JSON.stringify(started.diagnostics)).not.toContain("private error after oversized frame")
    expect(fetch).toHaveBeenCalledOnce()
  })

  it("receives reasoning and a title through real Pi after six quiet minutes and a nine-minute content gap without output or total caps", async () => {
    vi.useFakeTimers()
    const models = createModels()
    models.setProvider(deepseekProvider())
    const model = models.getModel("deepseek", "deepseek-v4-flash")
    if (!model) throw new Error("Expected the configured DeepSeek model")
    let payload: unknown
    const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
      const outbound = new Request(input, init)
      expect(outbound.url).toBe("https://api.deepseek.com/chat/completions")
      payload = JSON.parse(await outbound.text()) as unknown
      const chunks = [
        { choices: [{ index: 0, delta: { reasoning_content: "Consider the best title." }, finish_reason: null }] },
        { choices: [{ index: 0, delta: { content: '{"title":"Café Ideas"}' }, finish_reason: null }] },
        {
          choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
          usage: { prompt_tokens: 10, completion_tokens: 92, total_tokens: 102 },
        },
      ]
      const encoder = new TextEncoder()
      return new Response(new ReadableStream({
        async start(controller) {
          for (const [index, chunk] of chunks.entries()) {
            await new Promise<void>((resolve) => setTimeout(
              resolve,
              [360_000, 540_000, 1][index],
            ))
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`))
          }
          controller.enqueue(encoder.encode("data: [DONE]\n\n"))
          controller.close()
        },
      }), { headers: { "content-type": "text/event-stream" } })
    })
    vi.stubGlobal("fetch", fetch)

    const started = startPiLlmStream(
      { models, model, provider: "server", apiKey: "test-key", reasoningEffort: "medium" },
      request({
        jsonSchema: {
          type: "object",
          properties: { title: { type: "string" } },
          required: ["title"],
          additionalProperties: false,
        },
      }),
    )

    const collected = collect(started.stream)
    void collected.catch(() => undefined)
    await vi.advanceTimersByTimeAsync(900_001)
    await expect(collected).resolves.toEqual([
      { type: "reasoning-delta", text: "Consider the best title." },
      { type: "text-delta", text: '{"title":"Café Ideas"}' },
    ])
    expect(fetch).toHaveBeenCalledOnce()
    expect(payload).toMatchObject({
      model: "deepseek-v4-flash",
      stream: true,
      response_format: { type: "json_object" },
    })
    for (const field of ["max_tokens", "max_completion_tokens", "max_output_tokens"]) {
      expect(payload).not.toHaveProperty(field)
    }
    await expect(started.finishReason).resolves.toBe("stop")
    await expect(started.usage).resolves.toMatchObject({ outputTokens: 92 })
  })

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
      maxRetries: 3,
      temperature: 0.25,
      reasoningEffort: "xhigh",
      toolChoice: "none",
    })
    expect(options.signal).toBeInstanceOf(AbortSignal)
    expect(options).not.toHaveProperty("samplingParams")
    expect(options).not.toHaveProperty("maxTokens")
    expect(options).not.toHaveProperty("timeoutMs")
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
      maxRetries: 3,
      temperature: 0.25,
      reasoningEffort: "medium",
      transport: "sse",
      toolChoice: "required",
    })
    expect(options.signal).toBeInstanceOf(AbortSignal)
    expect(options).not.toHaveProperty("apiKey")
    expect(options).not.toHaveProperty("samplingParams")
    expect(options).not.toHaveProperty("maxTokens")
    expect(options).not.toHaveProperty("timeoutMs")
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
        { delay: 600_001, event: event({ type: "text_delta", delta: "late" }) },
      ]),
    )
    const started = startPiLlmStream(runtime, request())
    const terminals = terminalPromises(started)
    const collected = collect(started.stream)
    void collected.catch(() => undefined)

    await vi.advanceTimersByTimeAsync(599_999)
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
    const { runtime, stream } = harness(
      delayedEvents([
        { delay: 10, event: event({ type: "text_delta", delta: "first" }) },
        { delay: 600_001, event: event({ type: "text_delta", delta: "late" }) },
      ]),
    )
    const started = startPiLlmStream(runtime, request())
    const terminals = terminalPromises(started)
    const collected = collect(started.stream)
    void collected.catch(() => undefined)

    await vi.advanceTimersByTimeAsync(600_009)
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

  it.each(["text_delta", "thinking_delta"] as const)("does not let an empty %s extend the inter-content deadline", async (type) => {
    vi.useFakeTimers()
    const { runtime, stream } = harness(
      delayedEvents([
        { delay: 10, event: event({ type: "text_delta", delta: "first" }) },
        { delay: 300_000, event: event({ type, delta: "" }) },
        { delay: 300_001, event: event({ type: "text_delta", delta: "late" }) },
      ]),
    )
    const started = startPiLlmStream(runtime, request())
    const terminals = terminalPromises(started)
    const collected = collect(started.stream)
    void collected.catch(() => undefined)

    await vi.advanceTimersByTimeAsync(600_009)
    const { options } = recordedCall(stream)
    expect(options.signal).toMatchObject({ aborted: false })
    await vi.advanceTimersByTimeAsync(1)
    await expect(collected).rejects.toMatchObject({ name: "TimeoutError" })
    expect(options.signal).toMatchObject({ aborted: true })
    await terminals
  })

  it("continues beyond twenty minutes while text and reasoning each reset the inactivity deadline", async () => {
    vi.useFakeTimers()
    const { runtime } = harness(
      delayedEvents([
        { delay: 240_000, event: event({ type: "text_delta", delta: "first" }) },
        { delay: 540_000, event: event({ type: "thinking_delta", delta: "consider" }) },
        { delay: 540_000, event: event({ type: "text_delta", delta: "answer" }) },
        { delay: 1, event: event({ type: "done", reason: "stop" }) },
      ]),
    )
    const started = startPiLlmStream(runtime, request())
    const collected = collect(started.stream)
    void collected.catch(() => undefined)

    await vi.advanceTimersByTimeAsync(1_320_001)
    await expect(collected).resolves.toEqual([
      { type: "text-delta", text: "first" },
      { type: "reasoning-delta", text: "consider" },
      { type: "text-delta", text: "answer" },
    ])
    await expect(started.finishReason).resolves.toBe("stop")
  })

  it("still aborts immediately when the user stops an otherwise active stream", async () => {
    vi.useFakeTimers()
    const workflowController = new AbortController()
    const { runtime, stream } = harness(
      delayedEvents([
        { delay: 10, event: event({ type: "thinking_delta", delta: "consider" }) },
        { delay: 540_000, event: event({ type: "text_delta", delta: "answer" }) },
      ]),
    )
    const started = startPiLlmStream(runtime, request({
      workflowSignal: workflowController.signal,
    }))
    const terminals = terminalPromises(started)
    const collected = collect(started.stream)
    void collected.catch(() => undefined)

    await vi.advanceTimersByTimeAsync(11)
    const reason = workflowAbortReason("user-stop")
    workflowController.abort(reason)

    await expect(collected).rejects.toMatchObject({ cause: reason })
    const { options } = recordedCall(stream)
    expect(options.signal).toMatchObject({ aborted: true, reason })
    for (const terminal of await terminals) {
      expect(terminal).toMatchObject({
        status: "rejected",
        reason: { cause: reason },
      })
    }
  })
})
