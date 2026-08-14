import { beforeEach, describe, expect, it, vi } from "vitest"
import z from "zod"

const mocks = vi.hoisted(() => ({
  callOptions: vi.fn((reasoning: "enabled" | "disabled") => ({
    providerOptions: { test: { reasoning } },
  })),
  generateText: vi.fn(),
  loadPrompt: vi.fn(),
  model: vi.fn((model?: string) => ({
    modelId: model ?? "configured-model",
  })),
  outputArray: vi.fn((options: unknown) => ({ type: "array", options })),
  outputObject: vi.fn((options: unknown) => ({ type: "object", options })),
  prepareTextGeneration: vi.fn(),
  streamText: vi.fn(),
}))

vi.mock("ai", () => ({
  generateText: mocks.generateText,
  Output: { array: mocks.outputArray, object: mocks.outputObject },
  streamText: mocks.streamText,
}))

vi.mock("./prompts.ts", () => ({
  PromptName: {
    Default: "default",
    GeneratePromptTitle: "generate-prompt-title",
    GenerateWebSearchQueries: "generate-websearch-queries",
  },
  loadPrompt: mocks.loadPrompt,
}))

vi.mock("./streams.ts", () => ({
  awaitGenerationOutput: async (
    generation: { completion: Promise<{ status: string; error?: string }> },
    output: Promise<unknown>,
  ) => {
    const outcome = await generation.completion
    if (outcome.status === "failed") throw new Error(outcome.error)
    return output
  },
  getUnsuccessfulFinishReasonMessage: (
    finishReason: string | undefined,
  ) =>
    finishReason === "stop"
      ? undefined
      : finishReason === undefined
        ? "Text generation did not report a finish reason"
        : `Text generation ended with finish reason "${finishReason}"`,
  prepareTextGeneration: mocks.prepareTextGeneration,
}))

vi.mock("./provider.ts", () => ({
  llm: {
    callOptions: mocks.callOptions,
    model: mocks.model,
    supportsStructuredOutputs: false,
  },
}))

import {
  generateArrayStream,
  generateObjectStream,
  generatePromptTitle,
  generateTextStream,
} from "./generateText.ts"
import { config } from "../config.ts"

function completedGenerationHandle() {
  return {
    id: "stream-id",
    completion: Promise.resolve({
      status: "completed" as const,
      text: "Persisted output",
      reasoning: "Persisted reasoning",
    }),
  }
}

function mockPreparedGeneration(
  generation: {
    id: string
    completion: Promise<{
      status: "completed" | "failed"
      text: string
      reasoning: string
      error?: string
      failureKind?: string
    }>
  } = completedGenerationHandle(),
) {
  const prepared = {
    id: generation.id,
    start: vi.fn(() => generation),
    fail: vi.fn(() => generation),
  }
  mocks.prepareTextGeneration.mockReturnValueOnce(prepared)
  return prepared
}

describe("generateTextStream", () => {
  beforeEach(() => vi.clearAllMocks())

  it("registers and returns every provider stream", async () => {
    const stream = { id: "raw-stream" }
    const finishReason = Promise.resolve("stop" as const)
    const usage = Promise.resolve({ inputTokens: 12, outputTokens: 4 })
    const generation = completedGenerationHandle()
    const prepared = mockPreparedGeneration(generation)
    mocks.loadPrompt.mockResolvedValue("System prompt")
    mocks.streamText.mockReturnValue({ stream, finishReason, usage })

    const result = await generateTextStream({
      userId: "test-user-id",
      owner: { standalone: true },
      prompt: "Hello",
      promptName: "default",
      reasoning: "enabled",
    })

    expect(mocks.prepareTextGeneration).toHaveBeenCalledOnce()
    const registration = z
      .object({
        onRegistered: z.undefined(),
        onCompleted: z.undefined(),
        onFailed: z.undefined(),
        metadata: z.object({
          modelId: z.literal("configured-model"),
          promptName: z.literal("default"),
          calculateCredits: z.function(),
        }),
      })
      .parse(mocks.prepareTextGeneration.mock.calls[0]?.[2] as unknown)
    expect(registration.metadata.calculateCredits).toBeTypeOf("function")
    expect(prepared.start).toHaveBeenCalledWith(stream, {
      finishReason,
      usage,
    })
    expect(mocks.streamText).toHaveBeenCalledWith(
      expect.objectContaining({
        maxOutputTokens: config.llmExecution.maxOutputTokens,
        maxRetries: config.llmExecution.maxRetries,
        timeout: {
          totalMs: config.llmExecution.totalTimeoutMs,
          firstChunkMs: config.llmExecution.firstChunkTimeoutMs,
          chunkMs: config.llmExecution.chunkTimeoutMs,
        },
        providerOptions: {
          test: { reasoning: "enabled" },
        },
      }),
    )
    const textCall = z
      .object({ onError: z.function() })
      .parse(mocks.streamText.mock.calls[0]?.[0] as unknown)
    expect(textCall.onError).toBeTypeOf("function")
    expect(mocks.callOptions).toHaveBeenCalledWith("enabled")
    expect(result).toBe(generation)
    await expect(result.completion).resolves.toMatchObject({
      status: "completed",
    })
  })

  it("allows callers to disable provider reasoning", async () => {
    const stream = { id: "raw-stream" }
    mocks.loadPrompt.mockResolvedValue("System prompt")
    mocks.streamText.mockReturnValue({ stream })
    mockPreparedGeneration()

    await generateTextStream({
      userId: "test-user-id",
      owner: { standalone: true },
      prompt: "Critique this idea",
      promptName: "default",
      reasoning: "disabled",
    })

    expect(mocks.streamText).toHaveBeenCalledWith(
      expect.objectContaining({
        providerOptions: {
          test: { reasoning: "disabled" },
        },
      }),
    )
    expect(mocks.callOptions).toHaveBeenCalledWith("disabled")
  })

  it("forwards text-generation persistence hooks", async () => {
    const stream = { id: "raw-stream" }
    const onRegistered = vi.fn()
    const onCompleted = vi.fn()
    const onFailed = vi.fn()
    mocks.loadPrompt.mockResolvedValue("System prompt")
    mocks.streamText.mockReturnValue({ stream })
    mockPreparedGeneration()

    await generateTextStream({
      userId: "test-user-id",
      owner: { standalone: true },
      prompt: "Hello",
      promptName: "default",
      reasoning: "enabled",
      onRegistered,
      onCompleted,
      onFailed,
    })

    expect(mocks.prepareTextGeneration).toHaveBeenCalledWith(
      "test-user-id",
      { standalone: true },
      expect.objectContaining({ onRegistered, onCompleted, onFailed }),
    )
  })

  it("does not start provider work when durable registration fails", async () => {
    mocks.loadPrompt.mockResolvedValue("System prompt")
    mocks.prepareTextGeneration.mockImplementationOnce(() => {
      throw new Error("Stage registration failed")
    })

    await expect(
      generateTextStream({
        userId: "test-user-id",
        owner: { standalone: true },
        prompt: "Hello",
        promptName: "default",
        reasoning: "disabled",
      }),
    ).rejects.toThrow("Stage registration failed")
    expect(mocks.streamText).not.toHaveBeenCalled()
  })

  it("bounds mixed streaming work with one process-wide queue", async () => {
    mocks.loadPrompt.mockResolvedValue("System prompt")
    const completions = Array.from(
      { length: config.llmExecution.maxConcurrentGenerations + 1 },
      () => Promise.withResolvers<ReturnType<typeof completedGenerationHandle> extends {
        completion: Promise<infer Outcome>
      } ? Outcome : never>(),
    )
    for (const [index, completion] of completions.entries()) {
      mockPreparedGeneration({
        id: `stream-${index}`,
        completion: completion.promise,
      })
      mocks.streamText.mockReturnValueOnce({ stream: { index } })
    }

    const starts = completions.map((_, index) =>
      generateTextStream({
        userId: "test-user-id",
        owner: { standalone: true },
        prompt: `Request ${index}`,
        promptName: "default",
        reasoning: "disabled",
      }),
    )
    await Promise.all(
      starts.slice(0, config.llmExecution.maxConcurrentGenerations),
    )
    expect(mocks.streamText).toHaveBeenCalledTimes(
      config.llmExecution.maxConcurrentGenerations,
    )

    completions[0].resolve({
      status: "completed",
      text: "done",
      reasoning: "",
    })
    await expect(starts.at(-1)).resolves.toMatchObject({
      id: `stream-${completions.length - 1}`,
    })
    expect(mocks.streamText).toHaveBeenCalledTimes(completions.length)

    for (const completion of completions.slice(1)) {
      completion.resolve({ status: "completed", text: "done", reasoning: "" })
    }
  })

  it("generates a structured title with the configured model", async () => {
    const stream = { id: "raw-stream" }
    const output = Promise.resolve({ title: "London Renter Energy Options" })
    const finishReason = Promise.resolve("stop" as const)
    const usage = Promise.resolve({ inputTokens: 12, outputTokens: 4 })
    mocks.loadPrompt.mockResolvedValue("Title system prompt")
    mocks.streamText.mockReturnValue({
      stream,
      output,
      finishReason,
      usage,
    })
    const prepared = mockPreparedGeneration()

    await expect(generatePromptTitle("test-user-id", "How can renters save energy?")).resolves.toBe(
      "London Renter Energy Options",
    )
    const titleOptions = z
      .object({
        timeout: z.object({ totalMs: z.number() }),
        maxRetries: z.number(),
        providerOptions: z.object({
          test: z.object({ reasoning: z.literal("disabled") }),
        }),
      })
      .loose()
      .parse(mocks.streamText.mock.calls[0]?.[0] as unknown)
    expect(titleOptions.timeout.totalMs).toBe(
      config.llmExecution.totalTimeoutMs,
    )
    expect(titleOptions.maxRetries).toBe(config.llmExecution.maxRetries)
    expect(mocks.model).toHaveBeenCalledWith(undefined)
    expect(mocks.callOptions).toHaveBeenCalledWith("disabled")
    expect(mocks.outputObject).toHaveBeenCalledOnce()
    expect(prepared.start).toHaveBeenCalledWith(stream, {
      finishReason,
      usage,
    })
    const titleCall = z
      .object({ system: z.string() })
      .parse(mocks.streamText.mock.calls[0]?.[0] as unknown)
    expect(titleCall.system).toContain("Title system prompt")
    expect(titleCall.system).toContain('"title"')
  })

  it("rejects a title that did not finish normally", async () => {
    mocks.loadPrompt.mockResolvedValue("Title system prompt")
    mocks.streamText.mockReturnValue({
      stream: { id: "raw-stream" },
      output: Promise.resolve({ title: "Truncated title" }),
      finishReason: Promise.resolve("length"),
    })
    mockPreparedGeneration({
      id: "stream-id",
      completion: Promise.resolve({
        status: "failed" as const,
        text: "partial",
        reasoning: "",
        error: 'Text generation ended with finish reason "length"',
        failureKind: "finish-reason" as const,
      }),
    })

    await expect(generatePromptTitle("test-user-id", "Research this topic")).rejects.toThrow(
      'Text generation ended with finish reason "length"',
    )
  })

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
          test: { reasoning: "disabled" },
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
          modelId: z.literal("configured-model"),
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
    expect(mocks.callOptions).toHaveBeenCalledWith("disabled")
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
          test: { reasoning: "disabled" },
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
    expect(mocks.callOptions).toHaveBeenCalledWith("disabled")
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
