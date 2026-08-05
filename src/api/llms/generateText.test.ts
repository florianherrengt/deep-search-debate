import { beforeEach, describe, expect, it, vi } from "vitest"
import z from "zod"

const mocks = vi.hoisted(() => ({
  deepseek: vi.fn((model: string) => model),
  loadPrompt: vi.fn(),
  outputArray: vi.fn((options: unknown) => ({ type: "array", options })),
  outputObject: vi.fn((options: unknown) => ({ type: "object", options })),
  registerTextStream: vi.fn(),
  streamText: vi.fn(),
}))

vi.mock("@ai-sdk/deepseek", () => ({
  createDeepSeek: () => mocks.deepseek,
}))

vi.mock("ai", () => ({
  Output: { array: mocks.outputArray, object: mocks.outputObject },
  streamText: mocks.streamText,
}))

vi.mock("./prompts.ts", () => ({
  PromptName: {
    Default: "default",
    GenerateWebSearchQueries: "generate-websearch-queries",
  },
  loadPrompt: mocks.loadPrompt,
}))

vi.mock("./streams.ts", () => ({
  registerTextStream: mocks.registerTextStream,
}))

import {
  generateArrayStream,
  generateObjectStream,
  generateTextStream,
} from "./generateText.ts"

describe("generateTextStream", () => {
  beforeEach(() => vi.clearAllMocks())

  it("registers and returns every provider stream", async () => {
    const stream = { id: "raw-stream" }
    mocks.loadPrompt.mockResolvedValue("System prompt")
    mocks.streamText.mockReturnValue({ stream })
    mocks.registerTextStream.mockReturnValue("stream-id")

    const result = await generateTextStream({
      prompt: "Hello",
      promptName: "default",
    })

    expect(mocks.registerTextStream).toHaveBeenCalledWith(stream)
    expect(mocks.streamText).toHaveBeenCalledWith(
      expect.objectContaining({
        providerOptions: {
          deepseek: { thinking: { type: "enabled" } },
        },
      }),
    )
    expect(result).toEqual({ id: "stream-id" })
  })

  it("uses AI SDK structured array output and exposes its result", async () => {
    const stream = { id: "raw-stream" }
    const output = Promise.resolve(["first", "second"])
    const elementStream = { id: "element-stream" }
    const element = { type: "schema" }
    mocks.loadPrompt.mockResolvedValue("System prompt")
    mocks.streamText.mockReturnValue({ stream, output, elementStream })
    mocks.registerTextStream.mockReturnValue("stream-id")

    const result = await generateArrayStream({
      prompt: "Hello",
      promptName: "generate-websearch-queries",
      element: element as never,
    })

    expect(mocks.outputArray).toHaveBeenCalledWith({ element })
    expect(mocks.streamText).toHaveBeenCalledWith(
      expect.objectContaining({
        output: { type: "array", options: { element } },
        providerOptions: {
          deepseek: { thinking: { type: "disabled" } },
        },
      }),
    )
    expect(result.id).toBe("stream-id")
    expect(result.elementStream).toBe(elementStream)
    await expect(result.output).resolves.toEqual(["first", "second"])
  })

  it("uses AI SDK structured object output and exposes its result", async () => {
    const stream = { id: "raw-stream" }
    const output = Promise.resolve({ winnerSlot: 0 })
    const schema = { type: "schema" }
    mocks.loadPrompt.mockResolvedValue("System prompt")
    mocks.streamText.mockReturnValue({ stream, output })
    mocks.registerTextStream.mockReturnValue("stream-id")

    const result = await generateObjectStream({
      prompt: "Judge this",
      promptName: "default",
      schema: schema as never,
    })

    expect(mocks.outputObject).toHaveBeenCalledWith({ schema })
    expect(mocks.streamText).toHaveBeenCalledWith(
      expect.objectContaining({
        output: { type: "object", options: { schema } },
        providerOptions: {
          deepseek: { thinking: { type: "disabled" } },
        },
      }),
    )
    expect(result.id).toBe("stream-id")
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
    mocks.registerTextStream.mockReturnValue("stream-id")

    await generateObjectStream({
      prompt: "Judge this",
      promptName: "default",
      schema,
      onCompleted,
    })

    const options = mocks.registerTextStream.mock.calls[0]?.[1] as {
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
})
