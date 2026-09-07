import {
  completedGenerationHandle,
  mockPreparedGeneration,
  mocks,
  resetGenerateTextMocks,
  startedLlmStream,
  subscriptionLlmCall,
} from "./generateText.testSupport.ts"
import { createModels, InMemoryCredentialStore } from "@earendil-works/pi-ai"
import { openaiCodexProvider } from "@earendil-works/pi-ai/providers/openai-codex"
import { zstdDecompressSync } from "node:zlib"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import z from "zod"
import { researchAnalysisSchema } from "../agents/deep_search/schemas.ts"

import {
  generateArrayStream,
  generateObjectStream,
} from "./generateText.ts"
import { startPiLlmStream, type PiLlmRequest } from "./piGeneration.ts"
import type { LlmStreamPart, StartedLlmStream } from "./streamTypes.ts"

describe("structured generation", () => {
  beforeEach(resetGenerateTextMocks)
  afterEach(() => vi.unstubAllGlobals())

  it("sends nested research URLs without unsupported URI formats through the real Codex transport", async () => {
    const tokenPayload = Buffer.from(JSON.stringify({
      "https://api.openai.com/auth": { chatgpt_account_id: "test-account" },
    })).toString("base64url")
    const credentials = new InMemoryCredentialStore()
    await credentials.modify("openai-codex", () => Promise.resolve({
      type: "oauth",
      access: `test.${tokenPayload}.test`,
      refresh: "test-refresh",
      expires: Date.now() + 3_600_000,
      accountId: "test-account",
    }))
    const models = createModels({ credentials })
    models.setProvider(openaiCodexProvider())
    const model = models.getModel("openai-codex", "gpt-5.6-sol")
    if (!model) throw new Error("Expected the configured Codex model")
    const schema = researchAnalysisSchema.extend({
      contact: z.email(),
      createdAt: z.iso.datetime(),
    })
    const originalSchema = z.toJSONSchema(schema, { target: "draft-7" })
    const output = {
      facts: [{ title: "Waste", description: "Track waste", sources: ["https://example.com/research"] }],
      disagreements: [],
      gaps: [],
      assumptions: [],
      contact: "cafe@example.com",
      createdAt: "2026-09-07T12:00:00Z",
    }
    const text = JSON.stringify(output)
    let payload: unknown
    let outboundUrl: string | undefined
    const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
      const outbound = new Request(input, init)
      outboundUrl = outbound.url
      const bytes = Buffer.from(await outbound.arrayBuffer())
      const json = outbound.headers.get("content-encoding") === "zstd"
        ? zstdDecompressSync(bytes).toString("utf8")
        : bytes.toString("utf8")
      payload = JSON.parse(json) as unknown
      const item = {
        id: "fc_test",
        type: "function_call",
        call_id: "call_test",
        name: "submit_structured_output",
        arguments: text,
        status: "completed",
      }
      const chunks = [
        { type: "response.created", response: { id: "resp_test", status: "in_progress" } },
        { type: "response.output_item.added", output_index: 0, item: { ...item, arguments: "", status: "in_progress" } },
        { type: "response.function_call_arguments.delta", output_index: 0, delta: text },
        { type: "response.function_call_arguments.done", output_index: 0, arguments: text },
        { type: "response.output_item.done", output_index: 0, item },
        { type: "response.completed", response: { id: "resp_test", status: "completed", output: [item] } },
      ]
      return new Response(
        chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join(""),
        { headers: { "content-type": "text/event-stream" } },
      )
    })
    vi.stubGlobal("fetch", fetch)
    const streams: StartedLlmStream[] = []
    mocks.resolveLlmCall.mockResolvedValueOnce(subscriptionLlmCall({
      start: (request) => {
        const started = startPiLlmStream(
          { models, model, provider: "codex", reasoningEffort: "medium" },
          request,
        )
        streams.push(started)
        return started
      },
    }))
    mocks.loadPrompt.mockResolvedValue("Research analysis prompt")
    mockPreparedGeneration(completedGenerationHandle(text))

    const result = await generateObjectStream({
      userId: "connected-user-id",
      owner: { standalone: true },
      prompt: "Analyze this research",
      promptName: "default",
      schema,
    })
    const started = streams[0]
    if (!started) throw new Error("Expected the real Pi stream")
    const parts: LlmStreamPart[] = []
    for await (const part of started.stream) parts.push(part)

    expect(outboundUrl).toBe("https://chatgpt.com/backend-api/codex/responses")
    expect(fetch).toHaveBeenCalledOnce()
    expect(parts).toEqual([{ type: "text-delta", text }])
    expect(payload).toMatchObject({
      model: "gpt-5.6-sol",
      tool_choice: "required",
      tools: [{ type: "function", name: "submit_structured_output", strict: true }],
    })
    for (const collection of ["facts", "disagreements", "assumptions"]) {
      const sourcePath = `properties.${collection}.items.properties.sources.items`
      expect(originalSchema).toHaveProperty(`${sourcePath}.format`, "uri")
      expect(payload).toHaveProperty(`tools.0.parameters.${sourcePath}.type`, "string")
      expect(payload).not.toHaveProperty(`tools.0.parameters.${sourcePath}.format`)
    }
    expect(payload).toHaveProperty("tools.0.parameters.properties.contact.format", "email")
    expect(payload).toHaveProperty("tools.0.parameters.properties.createdAt.format", "date-time")
    expect(z.toJSONSchema(schema, { target: "draft-7" })).toEqual(originalSchema)
    await expect(started.finishReason).resolves.toBe("stop")
    await expect(result.output).resolves.toEqual(output)
  })

  it("sends a JSON Schema to Pi and parses the persisted array result", async () => {
    const started = startedLlmStream()
    const generation = completedGenerationHandle(
      '{"elements":["first","second"]}',
    )
    const prepared = mockPreparedGeneration(generation)
    mocks.loadPrompt.mockResolvedValue("System prompt")
    mocks.start.mockReturnValue(started)

    const result = await generateArrayStream({
      userId: "test-user-id",
      owner: { standalone: true },
      prompt: "Hello",
      promptName: "generate-websearch-queries",
      element: z.string(),
    })

    const request = z
      .object({
        prompt: z.literal("Hello"),
        system: z.string(),
        jsonSchema: z.object({
          type: z.literal("object"),
          properties: z.object({
            elements: z.object({ type: z.literal("array") }).loose(),
          }).loose(),
        }).loose(),
      })
      .loose()
      .parse(mocks.start.mock.calls[0]?.[0])
    expect(request).not.toHaveProperty("maxOutputTokens")
    expect(request.system).toContain("System prompt")
    expect(request.system).toContain("Return only valid JSON")
    expect(request.system).toContain('"elements"')
    expect(prepared.start).toHaveBeenCalledWith(started.stream, {
      finishReason: started.finishReason,
      rawFinishReason: started.rawFinishReason,
      usage: started.usage,
    })
    expect(result.id).toBe("stream-id")
    expect(result.completion).toBe(generation.completion)
    await expect(result.output).resolves.toEqual(["first", "second"])
  })

  it("validates an array inside the terminal transaction before calling its hook", async () => {
    const onCompleted = vi.fn()
    mocks.loadPrompt.mockResolvedValue("System prompt")
    mockPreparedGeneration(completedGenerationHandle('{"elements":[]}'))

    await generateArrayStream({
      userId: "test-user-id",
      owner: { standalone: true },
      prompt: "Hello",
      promptName: "generate-websearch-queries",
      element: z.string(),
      onCompleted,
    })

    const options = mocks.prepareTextGeneration.mock.calls[0]?.[2] as {
      onCompleted: (
        completed: { id: string; text: string; reasoning: string },
        transaction: unknown,
      ) => void
    }
    const transaction = { id: "transaction" }
    options.onCompleted(
      {
        id: "stream-id",
        text: '{"elements":["first","second"]}',
        reasoning: "",
      },
      transaction,
    )
    expect(onCompleted).toHaveBeenCalledWith(
      { id: "stream-id", output: ["first", "second"] },
      transaction,
    )

    expect(() =>
      options.onCompleted(
        {
          id: "stream-id",
          text: '{"elements":["valid",1]}',
          reasoning: "",
        },
        transaction,
      ),
    ).toThrow()
    expect(onCompleted).toHaveBeenCalledTimes(1)
  })

  it("omits unsupported URI formats from Codex array requests", async () => {
    const start = vi.fn<(request: PiLlmRequest) => StartedLlmStream>(() =>
      startedLlmStream()
    )
    mocks.resolveLlmCall.mockResolvedValueOnce(subscriptionLlmCall({ start }))
    mocks.loadPrompt.mockResolvedValue("Select source URLs")
    mockPreparedGeneration(completedGenerationHandle(
      '{"elements":["https://example.com/research"]}',
    ))

    const result = await generateArrayStream({
      userId: "connected-user-id",
      owner: { standalone: true },
      prompt: "Select sources",
      promptName: "default",
      element: z.url({ protocol: /^https?$/ }),
    })

    const schema = start.mock.calls[0]?.[0].jsonSchema
    expect(schema).toHaveProperty("properties.elements.items.type", "string")
    expect(schema).not.toHaveProperty("properties.elements.items.format")
    await expect(result.output).resolves.toEqual(["https://example.com/research"])
  })

  it("keeps the Codex system prompt unchanged and passes the schema to Pi", async () => {
    const start = vi.fn<(request: PiLlmRequest) => StartedLlmStream>(() =>
      startedLlmStream()
    )
    const call = subscriptionLlmCall({ start })
    mocks.resolveLlmCall.mockResolvedValueOnce(call)
    mocks.loadPrompt.mockResolvedValue("Codex system prompt")
    mockPreparedGeneration(completedGenerationHandle('{"winnerSlot":0}'))

    const result = await generateObjectStream({
      userId: "connected-user-id",
      owner: { standalone: true },
      prompt: "Judge this",
      promptName: "default",
      schema: z.object({ winnerSlot: z.number().int() }),
    })

    const request = start.mock.calls[0]?.[0]
    expect(request).toMatchObject({
      prompt: "Judge this",
      system: "Codex system prompt",
    })
    expect(request?.jsonSchema).toMatchObject({
      properties: { winnerSlot: {} },
    })
    expect(mocks.requirePositiveCreditBalance).not.toHaveBeenCalled()
    expect(
      (
        mocks.prepareTextGeneration.mock.calls[0]?.[2] as {
          metadata: Record<string, unknown>
        }
      ).metadata,
    ).toEqual({
      modelId: "gpt-5.6-sol",
      promptName: "default",
      provider: "codex",
    })
    await expect(result.output).resolves.toEqual({ winnerSlot: 0 })
  })

  it("sanitizes a Codex structured startup failure before persistence", async () => {
    const rawSecret = "Codex startup envelope: bearer structured-secret-token"
    const release = vi.fn(() => Promise.resolve())
    const call = subscriptionLlmCall({
      start: () => {
        throw new Error(rawSecret)
      },
      release,
    })
    const prepared = mockPreparedGeneration()
    mocks.resolveLlmCall.mockResolvedValueOnce(call)
    mocks.loadPrompt.mockResolvedValue("System prompt")

    const result = await generateObjectStream({
      userId: "connected-user-id",
      owner: { standalone: true },
      prompt: "Judge this",
      promptName: "default",
      schema: z.object({ winnerSlot: z.number() }),
    })

    expect(release).toHaveBeenCalled()
    expect(prepared.start).not.toHaveBeenCalled()
    expect(prepared.fail).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "OpenAiCodexError",
        code: "temporarily-unavailable",
        message: "OpenAI Codex is temporarily unavailable. Try again later.",
      }),
    )
    expect(JSON.stringify(prepared.fail.mock.calls)).not.toContain(rawSecret)
    await expect(result.output).rejects.toMatchObject({
      name: "OpenAiCodexError",
      code: "temporarily-unavailable",
    })
  })

  it("rejects invalid persisted object output", async () => {
    const schema = z.object({ winnerSlot: z.number().int().min(0).max(1) })
    mocks.loadPrompt.mockResolvedValue("System prompt")
    mockPreparedGeneration(completedGenerationHandle('{"winnerSlot":"0"}'))

    const result = await generateObjectStream({
      userId: "test-user-id",
      owner: { standalone: true },
      prompt: "Judge this",
      promptName: "default",
      schema,
    })

    await expect(result.output).rejects.toBeInstanceOf(z.ZodError)
  })

  it.each(["not-a-url", "ftp://example.com/research"])(
    "rejects an invalid research source %s before completing Codex generation",
    async (source) => {
      const onCompleted = vi.fn()
      const output = {
        facts: [{ title: "Waste", description: "Track waste", sources: [source] }],
        disagreements: [],
        gaps: [],
        assumptions: [],
      }
      const text = JSON.stringify(output)
      mocks.resolveLlmCall.mockResolvedValueOnce(subscriptionLlmCall())
      mocks.loadPrompt.mockResolvedValue("Research analysis prompt")
      mockPreparedGeneration(completedGenerationHandle(text))

      const result = await generateObjectStream({
        userId: "connected-user-id",
        owner: { standalone: true },
        prompt: "Analyze this research",
        promptName: "default",
        schema: researchAnalysisSchema,
        onCompleted,
      })

      await expect(result.output).rejects.toBeInstanceOf(z.ZodError)
      const options = mocks.prepareTextGeneration.mock.calls[0]?.[2] as {
        onCompleted: (
          completed: { id: string; text: string; reasoning: string },
          transaction: unknown,
        ) => void
      }
      expect(() => options.onCompleted(
        { id: "stream-id", text, reasoning: "" },
        {},
      )).toThrow(z.ZodError)
      expect(onCompleted).not.toHaveBeenCalled()
    },
  )

  it("keeps URL constraints in the server provider's structured prompt", async () => {
    mocks.loadPrompt.mockResolvedValue("Research analysis prompt")
    mockPreparedGeneration(completedGenerationHandle(JSON.stringify({
      facts: [{ title: "Waste", description: "Track waste", sources: ["https://example.com/research"] }],
      disagreements: [],
      gaps: [],
      assumptions: [],
    })))

    const result = await generateObjectStream({
      userId: "test-user-id",
      owner: { standalone: true },
      prompt: "Analyze this research",
      promptName: "default",
      schema: researchAnalysisSchema,
    })

    const request = mocks.start.mock.calls[0]?.[0]
    expect(request?.system).toContain('"format":"uri"')
    expect(request?.jsonSchema).toHaveProperty(
      "properties.facts.items.properties.sources.items.format",
      "uri",
    )
    await expect(result.output).resolves.toMatchObject({
      facts: [{ sources: ["https://example.com/research"] }],
    })
  })

  it("rejects prototype properties before running a terminal transaction hook", async () => {
    const schema = z.object({ winnerSlot: z.number().int().min(0).max(1) })
    const onCompleted = vi.fn()
    mocks.loadPrompt.mockResolvedValue("System prompt")
    mockPreparedGeneration(completedGenerationHandle('{"winnerSlot":0}'))

    await generateObjectStream({
      userId: "test-user-id",
      owner: { standalone: true },
      prompt: "Judge this",
      promptName: "default",
      schema,
      onCompleted,
    })

    const options = mocks.prepareTextGeneration.mock.calls[0]?.[2] as {
      onCompleted: (
        completed: { id: string; text: string; reasoning: string },
        transaction: unknown,
      ) => void
    }
    expect(() =>
      options.onCompleted(
        {
          id: "stream-id",
          text: '{"winnerSlot":0,"__proto__":{"polluted":true}}',
          reasoning: "",
        },
        {},
      ),
    ).toThrow("forbidden prototype property")
    expect(onCompleted).not.toHaveBeenCalled()
  })

  it("forwards structured generation lifecycle hooks", async () => {
    const onRegistered = vi.fn()
    const onFailed = vi.fn()
    const onInterrupted = vi.fn()
    mocks.loadPrompt.mockResolvedValue("System prompt")
    mockPreparedGeneration(completedGenerationHandle('{"decision":"stop"}'))

    await generateObjectStream({
      userId: "test-user-id",
      owner: { standalone: true },
      prompt: "Review this",
      promptName: "default",
      schema: z.object({ decision: z.literal("stop") }),
      onRegistered,
      onFailed,
      onInterrupted,
    })

    expect(mocks.prepareTextGeneration).toHaveBeenCalledWith(
      "test-user-id",
      { standalone: true },
      expect.objectContaining({ onRegistered, onFailed, onInterrupted }),
    )
  })
})
