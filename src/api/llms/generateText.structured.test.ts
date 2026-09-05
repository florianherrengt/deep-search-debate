import {
  completedGenerationHandle,
  mockPreparedGeneration,
  mocks,
  resetGenerateTextMocks,
  startedLlmStream,
  subscriptionLlmCall,
} from "./generateText.testSupport.ts"
import { beforeEach, describe, expect, it, vi } from "vitest"
import z from "zod"

import {
  generateArrayStream,
  generateObjectStream,
} from "./generateText.ts"
import type { PiLlmRequest } from "./piGeneration.ts"
import type { StartedLlmStream } from "./streamTypes.ts"

describe("structured generation", () => {
  beforeEach(resetGenerateTextMocks)

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
