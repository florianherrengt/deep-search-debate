import { beforeEach, describe, expect, it, vi } from "vitest"
import type { ZodType } from "zod"

const mocks = vi.hoisted(() => ({
  generateArrayStream: vi.fn(),
}))

vi.mock("../../llms/generateText.ts", () => ({
  generateArrayStream: mocks.generateArrayStream,
}))

import { selectSearchResults, selectWebSearchResults } from "./selection.ts"

const ignoreStream = () => undefined

const sampleResults = [
  { id: "result-0", title: "Intro to QC", url: "https://a.com", snippet: "..." },
  { id: "result-1", title: "Classical computing", url: "https://b.com", snippet: "..." },
  { id: "result-2", title: "QC applications", url: "https://c.com", snippet: "..." },
]

describe("selectWebSearchResults", () => {
  beforeEach(() => vi.clearAllMocks())

  it("selects results from structured output", async () => {
    const onStreamCreated = vi.fn()
    mocks.generateArrayStream.mockResolvedValueOnce({
      id: "stream-id",
      output: Promise.resolve(["result-0", "result-2"]),
    })

    const result = await selectWebSearchResults({
      userId: "test-user-id",
      deepSearchJobId: "deep-search-job-id",
      userQuery: "What is quantum computing?",
      searchQuery: "quantum computing basics",
      results: sampleResults,
      onStreamCreated,
      maxRetries: 0,
    })

    const callArgs = mocks.generateArrayStream.mock.calls[0]?.[0] as
      | {
          prompt: string
          promptName: string
          element: ZodType<string>
          maxRetries?: number
        }
      | undefined
    expect(callArgs).toBeDefined()
    if (!callArgs) throw new Error("generateArrayStream was not called")
    expect(callArgs.promptName).toBe("select-websearch-results")
    expect(callArgs.maxRetries).toBe(0)
    expect(callArgs.prompt).toContain("user_query: What is quantum computing?")
    expect(callArgs.prompt).toContain("max_results_to_explore: 3")
    expect(callArgs.element.parse("result-0")).toBe("result-0")
    expect(() => callArgs.element.parse(1)).toThrow()
    expect(onStreamCreated).toHaveBeenCalledWith("stream-id")
    expect(result).toEqual(["result-0", "result-2"])
  })

  it("keeps only the highest-priority results up to the limit", async () => {
    mocks.generateArrayStream.mockResolvedValueOnce({
      id: "stream-id",
      output: Promise.resolve(["result-2", "result-0", "result-1"]),
    })

    const result = await selectWebSearchResults({
      userId: "test-user-id",
      deepSearchJobId: "deep-search-job-id",
      userQuery: "test",
      searchQuery: "test",
      results: sampleResults,
      maxResultsToExplore: 2,
      onStreamCreated: ignoreStream,
    })

    expect(result).toEqual(["result-2", "result-0"])
  })

  it("returns empty array when no results selected", async () => {
    mocks.generateArrayStream.mockResolvedValueOnce({
      id: "stream-id",
      output: Promise.resolve([]),
    })

    const result = await selectWebSearchResults({
      userId: "test-user-id",
      deepSearchJobId: "deep-search-job-id",
      userQuery: "test",
      searchQuery: "test",
      results: [],
      onStreamCreated: ignoreStream,
    })

    expect(result).toEqual([])
  })

  it("propagates structured output errors", async () => {
    mocks.generateArrayStream.mockResolvedValueOnce({
      id: "stream-id",
      output: Promise.reject(new Error("model error")),
    })

    await expect(
      selectWebSearchResults({
        userId: "test-user-id",
        deepSearchJobId: "deep-search-job-id",
        userQuery: "test",
        searchQuery: "test",
        results: sampleResults,
        onStreamCreated: ignoreStream,
      }),
    ).rejects.toThrow("model error")
  })

  it("emits the selection stream and maps selected IDs back to links", async () => {
    const onEvent = vi.fn()
    mocks.generateArrayStream.mockResolvedValueOnce({
      id: "stream-id",
      output: Promise.resolve(["result-2", "result-0"]),
    })

    const selected = await selectSearchResults({
      userId: "test-user-id",
      deepSearchJobId: "deep-search-job-id",
      researchRequest: "What is quantum computing?",
      maxResultsPerSearch: 2,
      search: {
        query: "quantum computing",
        results: sampleResults.map((result) => ({
          title: result.title,
          shortText: result.snippet,
          link: result.url,
        })),
      },
      onEvent,
    })

    expect(onEvent).toHaveBeenCalledWith({
      type: "selection-stream",
      query: "quantum computing",
      streamId: "stream-id",
    })
    expect(selected.selectedLinks).toEqual([
      "https://c.com",
      "https://a.com",
    ])
  })
})
