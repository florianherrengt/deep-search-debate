import { beforeEach, describe, expect, it, vi } from "vitest"
import type { ZodType } from "zod"

const mocks = vi.hoisted(() => ({
  generateArrayStream: vi.fn(),
  webSearch: vi.fn(),
}))

vi.mock("../../llms/generateText.ts", () => ({
  generateArrayStream: mocks.generateArrayStream,
}))

vi.mock("../../web_search/index.ts", () => ({
  webSearch: mocks.webSearch,
}))

import { generateSearchResults, generateWebSearchQueries } from "./queries.ts"

const ignoreStream = () => undefined

describe("generateWebSearchQueries", () => {
  beforeEach(() => vi.clearAllMocks())

  it("generates deduplicated queries from structured output", async () => {
    const onStreamCreated = vi.fn()
    mocks.generateArrayStream.mockResolvedValueOnce({
      id: "stream-id",
      output: Promise.resolve([
        "quantum computing basics",
        "quantum computing applications",
        "quantum computing basics",
      ]),
    })

    const result = await generateWebSearchQueries({
      userId: "test-user-id",
      deepSearchJobId: "deep-search-job-id",
      researchRequest: "quantum computing",
      onStreamCreated,
      maxRetries: 0,
    })

    const call = mocks.generateArrayStream.mock.calls[0]?.[0] as
      | {
          prompt: string
          promptName: string
          element: ZodType<string>
          maxRetries?: number
        }
      | undefined
    expect(call).toBeDefined()
    if (!call) throw new Error("generateArrayStream was not called")
    expect(call).toMatchObject({
      prompt: "quantum computing",
      promptName: "generate-websearch-queries",
      maxRetries: 0,
    })
    expect(call.element.parse(" valid query ")).toBe("valid query")
    expect(() => call.element.parse("  ")).toThrow()
    expect(onStreamCreated).toHaveBeenCalledWith("stream-id")
    expect(result).toEqual([
      "quantum computing basics",
      "quantum computing applications",
    ])
  })

  it("propagates structured output errors", async () => {
    mocks.generateArrayStream.mockResolvedValueOnce({
      id: "stream-id",
      output: Promise.reject(new Error("API error")),
    })

    await expect(
      generateWebSearchQueries({
        userId: "test-user-id",
        deepSearchJobId: "deep-search-job-id",
        researchRequest: "test",
        onStreamCreated: ignoreStream,
      }),
    ).rejects.toThrow("API error")
  })

  it("emits the query stream and searches only the configured limit", async () => {
    const onEvent = vi.fn()
    const onQueriesGenerated = vi.fn()
    mocks.generateArrayStream.mockResolvedValueOnce({
      id: "stream-id",
      output: Promise.resolve(["first", "second", "third"]),
    })
    mocks.webSearch.mockResolvedValue([])

    const searches = await generateSearchResults({
      userId: "test-user-id",
      deepSearchJobId: "deep-search-job-id",
      researchRequest: "test",
      maxSearches: 2,
      onEvent,
      onQueriesGenerated,
    })

    expect(onEvent).toHaveBeenCalledWith({
      type: "query-stream",
      streamId: "stream-id",
    })
    expect(mocks.webSearch).toHaveBeenCalledTimes(2)
    expect(onQueriesGenerated).toHaveBeenCalledWith([
      "first",
      "second",
      "third",
    ])
    expect(searches.map(({ query }) => query)).toEqual(["first", "second"])
  })
})
