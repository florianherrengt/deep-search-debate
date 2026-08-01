import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  generateTextStream: vi.fn(),
  subscribeToTextStream: vi.fn(),
}))

vi.mock("../../llms/generateText.ts", () => ({
  generateTextStream: mocks.generateTextStream,
}))

vi.mock("../../llms/streams.ts", () => ({
  subscribeToTextStream: mocks.subscribeToTextStream,
}))

import { selectSearchResults, selectWebSearchResults } from "./selection.ts"

const ignoreStream = () => undefined

async function* textStream(events: Array<{ type: string; text?: string; message?: string }>) {
  for (const e of events) {
    await Promise.resolve()
    yield e
  }
}

const sampleResults = [
  { id: "result-0", title: "Intro to QC", url: "https://a.com", snippet: "..." },
  { id: "result-1", title: "Classical computing", url: "https://b.com", snippet: "..." },
  { id: "result-2", title: "QC applications", url: "https://c.com", snippet: "..." },
]

describe("selectWebSearchResults", () => {
  beforeEach(() => vi.clearAllMocks())

  it("selects results from streamed JSON response", async () => {
    const onStreamCreated = vi.fn()
    mocks.generateTextStream.mockResolvedValueOnce({ id: "stream-id" })
    mocks.subscribeToTextStream.mockReturnValueOnce(
      textStream([
        { type: "text", text: '["result-0"' },
        { type: "text", text: ', "result-2"]' },
        { type: "done" },
      ]),
    )

    const result = await selectWebSearchResults({
      userQuery: "What is quantum computing?",
      searchQuery: "quantum computing basics",
      results: sampleResults,
      onStreamCreated,
    })

    const callArgs = mocks.generateTextStream.mock.calls[0]?.[0] as Record<string, unknown> | undefined
    expect(callArgs?.promptName).toBe("select-websearch-results")
    expect(callArgs?.prompt).toContain("user_query: What is quantum computing?")
    expect(callArgs?.prompt).toContain("max_results_to_explore: 3")
    expect(onStreamCreated).toHaveBeenCalledWith("stream-id")
    expect(result).toEqual(["result-0", "result-2"])
  })

  it("keeps only the highest-priority results up to the limit", async () => {
    mocks.generateTextStream.mockResolvedValueOnce({ id: "stream-id" })
    mocks.subscribeToTextStream.mockReturnValueOnce(
      textStream([
        {
          type: "text",
          text: '["result-2", "result-0", "result-1"]',
        },
        { type: "done" },
      ]),
    )

    const result = await selectWebSearchResults({
      userQuery: "test",
      searchQuery: "test",
      results: sampleResults,
      maxResultsToExplore: 2,
      onStreamCreated: ignoreStream,
    })

    expect(result).toEqual(["result-2", "result-0"])
  })

  it("returns empty array when no results selected", async () => {
    mocks.generateTextStream.mockResolvedValueOnce({ id: "stream-id" })
    mocks.subscribeToTextStream.mockReturnValueOnce(
      textStream([
        { type: "text", text: "[]" },
        { type: "done" },
      ]),
    )

    const result = await selectWebSearchResults({
      userQuery: "test",
      searchQuery: "test",
      results: [],
      onStreamCreated: ignoreStream,
    })

    expect(result).toEqual([])
  })

  it("strips markdown code fences", async () => {
    mocks.generateTextStream.mockResolvedValueOnce({ id: "stream-id" })
    mocks.subscribeToTextStream.mockReturnValueOnce(
      textStream([
        { type: "text", text: '```json\n["result-1"]\n```' },
        { type: "done" },
      ]),
    )

    const result = await selectWebSearchResults({
      userQuery: "test",
      searchQuery: "test",
      results: sampleResults,
      onStreamCreated: ignoreStream,
    })

    expect(result).toEqual(["result-1"])
  })

  it("throws on stream error", async () => {
    mocks.generateTextStream.mockResolvedValueOnce({ id: "stream-id" })
    mocks.subscribeToTextStream.mockReturnValueOnce(
      textStream([
        { type: "error", message: "model error" },
        { type: "done" },
      ]),
    )

    await expect(
      selectWebSearchResults({
        userQuery: "test",
        searchQuery: "test",
        results: sampleResults,
        onStreamCreated: ignoreStream,
      }),
    ).rejects.toThrow("model error")
  })

  it("emits the selection stream and maps selected IDs back to links", async () => {
    const onEvent = vi.fn()
    mocks.generateTextStream.mockResolvedValueOnce({ id: "stream-id" })
    mocks.subscribeToTextStream.mockReturnValueOnce(
      textStream([
        { type: "text", text: '["result-2", "result-0"]' },
        { type: "done" },
      ]),
    )

    const selected = await selectSearchResults({
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
