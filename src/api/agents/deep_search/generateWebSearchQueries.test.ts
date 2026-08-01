import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  generateTextStream: vi.fn(),
  subscribeToTextStream: vi.fn(),
  webSearch: vi.fn(),
}))

vi.mock("../../llms/generateText.ts", () => ({
  generateTextStream: mocks.generateTextStream,
}))

vi.mock("../../llms/streams.ts", () => ({
  subscribeToTextStream: mocks.subscribeToTextStream,
}))

vi.mock("../../web_search/index.ts", () => ({
  webSearch: mocks.webSearch,
}))

import { generateSearchResults, generateWebSearchQueries } from "./queries.ts"

const ignoreStream = () => undefined

async function* textStream(events: Array<{ type: string; text?: string; message?: string }>) {
  for (const e of events) {
    await Promise.resolve()
    yield e
  }
}

describe("generateWebSearchQueries", () => {
  beforeEach(() => vi.clearAllMocks())

  it("generates queries from streamed text", async () => {
    const onStreamCreated = vi.fn()
    mocks.generateTextStream.mockResolvedValueOnce({ id: "stream-id" })
    mocks.subscribeToTextStream.mockReturnValueOnce(
      textStream([
        { type: "text", text: "quantum computing basics\n" },
        { type: "text", text: "quantum computing applications\n" },
        { type: "text", text: "quantum computing history" },
        { type: "done" },
      ]),
    )

    const result = await generateWebSearchQueries({
      researchRequest: "quantum computing",
      onStreamCreated,
    })

    expect(mocks.generateTextStream).toHaveBeenCalledWith({
      prompt: "quantum computing",
      promptName: "generate-websearch-queries",
    })
    expect(onStreamCreated).toHaveBeenCalledWith("stream-id")
    expect(result).toEqual([
      "quantum computing basics",
      "quantum computing applications",
      "quantum computing history",
    ])
  })

  it("filters empty lines", async () => {
    mocks.generateTextStream.mockResolvedValueOnce({ id: "stream-id" })
    mocks.subscribeToTextStream.mockReturnValueOnce(
      textStream([
        { type: "text", text: "query one\n\nquery two\n" },
        { type: "done" },
      ]),
    )

    const result = await generateWebSearchQueries({
      researchRequest: "test",
      onStreamCreated: ignoreStream,
    })

    expect(result).toEqual(["query one", "query two"])
  })

  it("throws on stream error", async () => {
    mocks.generateTextStream.mockResolvedValueOnce({ id: "stream-id" })
    mocks.subscribeToTextStream.mockReturnValueOnce(
      textStream([
        { type: "error", message: "API error" },
        { type: "done" },
      ]),
    )

    await expect(
      generateWebSearchQueries({
        researchRequest: "test",
        onStreamCreated: ignoreStream,
      }),
    ).rejects.toThrow("API error")
  })

  it("emits the query stream and searches only the configured limit", async () => {
    const onEvent = vi.fn()
    mocks.generateTextStream.mockResolvedValueOnce({ id: "stream-id" })
    mocks.subscribeToTextStream.mockReturnValueOnce(
      textStream([
        { type: "text", text: "first\nsecond\nthird" },
        { type: "done" },
      ]),
    )
    mocks.webSearch.mockResolvedValue([])

    const searches = await generateSearchResults({
      researchRequest: "test",
      maxSearches: 2,
      onEvent,
    })

    expect(onEvent).toHaveBeenCalledWith({
      type: "query-stream",
      streamId: "stream-id",
    })
    expect(mocks.webSearch).toHaveBeenCalledTimes(2)
    expect(searches.map(({ query }) => query)).toEqual(["first", "second"])
  })
})
