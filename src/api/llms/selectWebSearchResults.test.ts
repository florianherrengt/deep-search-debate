import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  deepseek: vi.fn((model: string) => model),
  loadPrompt: vi.fn(),
  generateText: vi.fn(),
}))

vi.mock("@ai-sdk/deepseek", () => ({
  createDeepSeek: () => mocks.deepseek,
}))

vi.mock("ai", () => ({
  generateText: mocks.generateText,
  Output: { array: (opts: { element: unknown }) => opts },
}))

vi.mock("./prompts.ts", () => ({
  PromptName: {
    SelectWebSearchResults: "select-websearch-results",
  },
  loadPrompt: mocks.loadPrompt,
}))

vi.mock("../config.ts", () => ({
  config: {
    llm: { deepseek: { apiKey: "test-key", model: "test-model" } },
  },
}))

import { selectWebSearchResults } from "./selectWebSearchResults.ts"

describe("selectWebSearchResults", () => {
  beforeEach(() => vi.clearAllMocks())

  it("generates prompt and returns selected IDs", async () => {
    mocks.loadPrompt.mockResolvedValue("System prompt")
    mocks.generateText.mockResolvedValueOnce({ output: ["result-1", "result-3"] })

    const result = await selectWebSearchResults({
      userQuery: "What is quantum computing?",
      searchQuery: "quantum computing basics",
      results: [
        { id: "result-1", title: "Intro to QC", url: "https://a.com", snippet: "..." },
        { id: "result-2", title: "Classical computing", url: "https://b.com", snippet: "..." },
        { id: "result-3", title: "QC applications", url: "https://c.com", snippet: "..." },
      ],
    })

    expect(mocks.loadPrompt).toHaveBeenCalledWith("select-websearch-results")
    expect(mocks.generateText).toHaveBeenCalled()
    expect(result).toEqual(["result-1", "result-3"])
  })

  it("returns empty array when no results selected", async () => {
    mocks.loadPrompt.mockResolvedValue("System prompt")
    mocks.generateText.mockResolvedValueOnce({ output: [] })

    const result = await selectWebSearchResults({
      userQuery: "test",
      searchQuery: "test",
      results: [],
    })

    expect(result).toEqual([])
  })
})
