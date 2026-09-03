import {
  completedGenerationHandle,
  mockPreparedGeneration,
  mocks,
  resetGenerateTextMocks,
} from "./generateText.testSupport.ts"
import { beforeEach, describe, expect, it, vi } from "vitest"
import z from "zod"

import { config } from "../config.ts"
import {
  generateArrayStream,
  generateObjectStream,
} from "./generateText.ts"

describe("structured generation", () => {
  beforeEach(resetGenerateTextMocks)

  async function expectCodexStartupFailureIsSanitized(
    start: () => Promise<unknown>,
  ): Promise<void> {
    const rawSecret = "Codex startup envelope: bearer structured-secret-token"
    const call = {
      model: { modelId: "gpt-5.6-sol" },
      modelId: "gpt-5.6-sol",
      provider: "codex" as const,
      supportsStructuredOutputs: true,
      callOptions: {},
      wrapStream: vi.fn(),
      release: vi.fn(() => Promise.resolve()),
    }
    const prepared = mockPreparedGeneration()
    mocks.resolveLlmCall.mockResolvedValueOnce(call)
    mocks.loadPrompt.mockResolvedValue("System prompt")
    mocks.streamText.mockImplementationOnce(() => {
      throw new Error(rawSecret)
    })

    await start()

    expect(call.release).toHaveBeenCalledOnce()
    expect(prepared.fail).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "OpenAiCodexError",
        code: "temporarily-unavailable",
        message: "OpenAI Codex is temporarily unavailable. Try again later.",
      }),
    )
    expect(JSON.stringify(prepared.fail.mock.calls)).not.toContain(rawSecret)
  }

  it("uses AI SDK structured array output and exposes its result", async () => {
    const stream = { id: "raw-stream" }
    const output = Promise.resolve(["first", "second"])
    const finishReason = Promise.resolve("stop" as const)
    const usage = Promise.resolve({ inputTokens: 20, outputTokens: 8 })
    const generation = completedGenerationHandle()
    const prepared = mockPreparedGeneration(generation)
    const element = z.string()
    mocks.loadPrompt.mockResolvedValue("System prompt")
    mocks.streamText.mockReturnValue({
      stream,
      output,
      finishReason,
      usage,
    })

    const result = await generateArrayStream({
      userId: "test-user-id",
      owner: { standalone: true },
      prompt: "Hello",
      promptName: "generate-websearch-queries",
      element,
    })

    expect(mocks.outputArray).toHaveBeenCalledWith({ element })
    expect(mocks.streamText).toHaveBeenCalledWith(
      expect.objectContaining({
        maxOutputTokens: config.llmExecution.maxOutputTokens,
        maxRetries: config.llmExecution.maxRetries,
        timeout: {
          totalMs: config.llmExecution.totalTimeoutMs,
          firstChunkMs: config.llmExecution.firstChunkTimeoutMs,
          chunkMs: config.llmExecution.chunkTimeoutMs,
        },
        output: { type: "array", options: { element } },
        providerOptions: {
          test: { reasoningEffort: "xhigh" },
        },
      }),
    )
    const structuredCall = z
      .object({ onError: z.function() })
      .parse(mocks.streamText.mock.calls[0]?.[0] as unknown)
    expect(structuredCall.onError).toBeTypeOf("function")
    const arrayCall = z
      .object({ system: z.string() })
      .parse(mocks.streamText.mock.calls[0]?.[0] as unknown)
    expect(arrayCall.system).toContain('"elements"')
    expect(result.id).toBe("stream-id")
    expect(result.completion).toBe(generation.completion)
    expect(mocks.prepareTextGeneration).toHaveBeenCalledOnce()
    const registration = z
      .object({
        metadata: z.object({
          modelId: z.literal("deepseek-v4-pro"),
          promptName: z.literal("generate-websearch-queries"),
          calculateCredits: z.function(),
        }),
        onRegistered: z.undefined(),
      })
      .parse(mocks.prepareTextGeneration.mock.calls[0]?.[2] as unknown)
    expect(registration.metadata.calculateCredits).toBeTypeOf("function")
    const { onCompleted } = mocks.prepareTextGeneration.mock.calls[0]?.[2] as {
      onCompleted: (
        completed: { id: string; text: string; reasoning: string },
        transaction: unknown,
      ) => void
    }
    expect(() =>
      onCompleted(
        {
          id: "stream-id",
          text: '{"elements":["valid",1]}',
          reasoning: "",
        },
        {},
      ),
    ).toThrow()
    expect(prepared.start).toHaveBeenCalledWith(stream, {
      finishReason,
      usage,
    })
    expect(mocks.callOptions).toHaveBeenCalledWith("xhigh")
    await expect(result.output).resolves.toEqual(["first", "second"])
  })

  it("forwards array-stream registration hooks", async () => {
    const stream = { id: "raw-stream" }
    const onRegistered = vi.fn()
    mocks.loadPrompt.mockResolvedValue("System prompt")
    mocks.streamText.mockReturnValue({
      stream,
      output: Promise.resolve(["first"]),
    })
    mockPreparedGeneration()

    await generateArrayStream({
      userId: "test-user-id",
      owner: { standalone: true },
      prompt: "Hello",
      promptName: "generate-websearch-queries",
      element: z.string(),
      onRegistered,
    })

    expect(mocks.prepareTextGeneration).toHaveBeenCalledWith(
      "test-user-id",
      { standalone: true },
      expect.objectContaining({ onRegistered }),
    )
  })

  it("sanitizes Codex array startup failures before persistence", async () => {
    expect.hasAssertions()
    await expectCodexStartupFailureIsSanitized(() =>
      generateArrayStream({
        userId: "connected-user-id",
        owner: { standalone: true },
        prompt: "Hello",
        promptName: "generate-websearch-queries",
        element: z.string(),
      }),
    )
  })

  it("parses structured array output before running a terminal transaction hook", async () => {
    const stream = { id: "raw-stream" }
    const onCompleted = vi.fn()
    mocks.loadPrompt.mockResolvedValue("System prompt")
    mocks.streamText.mockReturnValue({
      stream,
      output: Promise.resolve(["first"]),
    })
    mockPreparedGeneration()

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
    const transaction = {}
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
  })

  it("uses AI SDK structured object output and exposes its result", async () => {
    const stream = { id: "raw-stream" }
    const output = Promise.resolve({ winnerSlot: 0 })
    const schema = z.object({ winnerSlot: z.number() })
    const generation = completedGenerationHandle()
    mockPreparedGeneration(generation)
    mocks.loadPrompt.mockResolvedValue("System prompt")
    mocks.streamText.mockReturnValue({ stream, output })

    const result = await generateObjectStream({
      userId: "test-user-id",
      owner: { standalone: true },
      prompt: "Judge this",
      promptName: "default",
      schema,
    })

    expect(mocks.outputObject).toHaveBeenCalledWith({ schema })
    expect(mocks.streamText).toHaveBeenCalledWith(
      expect.objectContaining({
        maxOutputTokens: config.llmExecution.maxOutputTokens,
        maxRetries: config.llmExecution.maxRetries,
        output: { type: "object", options: { schema } },
        providerOptions: {
          test: { reasoningEffort: "xhigh" },
        },
      }),
    )
    expect(result.id).toBe("stream-id")
    expect(result.completion).toBe(generation.completion)
    const { onCompleted } = mocks.prepareTextGeneration.mock.calls[0]?.[2] as {
      onCompleted: (
        completed: { id: string; text: string; reasoning: string },
        transaction: unknown,
      ) => void
    }
    expect(() =>
      onCompleted(
        {
          id: "stream-id",
          text: JSON.stringify({ winnerSlot: "invalid" }),
          reasoning: "",
        },
        {},
      ),
    ).toThrow()
    expect(mocks.callOptions).toHaveBeenCalledWith("xhigh")
    await expect(result.output).resolves.toEqual({ winnerSlot: 0 })
  })

  it("parses structured output before running a terminal transaction hook", async () => {
    const stream = { id: "raw-stream" }
    const output = Promise.resolve({ winnerSlot: 1 })
    const schema = z.object({ winnerSlot: z.number().int().min(0).max(1) })
    const onCompleted = vi.fn()
    const transaction = { id: "transaction" }
    mocks.loadPrompt.mockResolvedValue("System prompt")
    mocks.streamText.mockReturnValue({ stream, output })
    mockPreparedGeneration()

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
    options.onCompleted(
      {
        id: "stream-id",
        text: JSON.stringify({ winnerSlot: 1 }),
        reasoning: "reasoning",
      },
      transaction,
    )

    expect(onCompleted).toHaveBeenCalledWith(
      { id: "stream-id", output: { winnerSlot: 1 } },
      transaction,
    )
  })

  it("sanitizes Codex object startup failures before persistence", async () => {
    expect.hasAssertions()
    await expectCodexStartupFailureIsSanitized(() =>
      generateObjectStream({
        userId: "connected-user-id",
        owner: { standalone: true },
        prompt: "Judge this",
        promptName: "default",
        schema: z.object({ winnerSlot: z.number() }),
      }),
    )
  })

  it("rejects prototype properties before running a terminal transaction hook", async () => {
    const schema = z.object({ winnerSlot: z.number().int().min(0).max(1) })
    const onCompleted = vi.fn()
    mocks.loadPrompt.mockResolvedValue("System prompt")
    mocks.streamText.mockReturnValue({
      stream: { id: "raw-stream" },
      output: Promise.resolve({ winnerSlot: 0 }),
    })
    mockPreparedGeneration()

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

  it("forwards structured-stream registration hooks", async () => {
    const stream = { id: "raw-stream" }
    const schema = z.object({ decision: z.literal("stop") })
    const onRegistered = vi.fn()
    mocks.loadPrompt.mockResolvedValue("System prompt")
    mocks.streamText.mockReturnValue({
      stream,
      output: Promise.resolve({ decision: "stop" }),
    })
    mockPreparedGeneration()

    await generateObjectStream({
      userId: "test-user-id",
      owner: { standalone: true },
      prompt: "Review this",
      promptName: "default",
      schema,
      onRegistered,
    })

    expect(mocks.prepareTextGeneration).toHaveBeenCalledWith(
      "test-user-id",
      { standalone: true },
      expect.objectContaining({ onRegistered }),
    )
  })
})
