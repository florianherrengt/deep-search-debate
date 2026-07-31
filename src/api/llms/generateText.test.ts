import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  deepseek: vi.fn((model: string) => model),
  loadPrompt: vi.fn(),
  registerTextStream: vi.fn(),
  streamText: vi.fn(),
}))

vi.mock("@ai-sdk/deepseek", () => ({
  createDeepSeek: () => mocks.deepseek,
}))

vi.mock("ai", () => ({
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

import { generateTextStream } from "./generateText.ts"

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
})
