import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  deepseek: vi.fn((model: string) => model),
  loadPrompt: vi.fn(),
  outputArray: vi.fn((options: unknown) => ({ type: "array", options })),
  registerTextStream: vi.fn(),
  streamText: vi.fn(),
}))

vi.mock("@ai-sdk/deepseek", () => ({
  createDeepSeek: () => mocks.deepseek,
}))

vi.mock("ai", () => ({
  Output: { array: mocks.outputArray },
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

import { generateArrayStream, generateTextStream } from "./generateText.ts"

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
      expect.objectContaining({ output: { type: "array", options: { element } } }),
    )
    expect(result.id).toBe("stream-id")
    expect(result.elementStream).toBe(elementStream)
    await expect(result.output).resolves.toEqual(["first", "second"])
  })
})
