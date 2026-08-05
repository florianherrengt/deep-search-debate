import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  answerResearchRequest: vi.fn(),
  collectStreamText: vi.fn(),
  generateSearchResults: vi.fn(),
  selectSearchResults: vi.fn(),
  startPageSummary: vi.fn(),
  summarizeSearchQuery: vi.fn(),
}))

vi.mock("../../helpers/index.ts", () => ({
  collectStreamText: mocks.collectStreamText,
}))

vi.mock("./finalAnswer.ts", () => ({
  answerResearchRequest: mocks.answerResearchRequest,
}))

vi.mock("./queries.ts", () => ({
  generateSearchResults: mocks.generateSearchResults,
}))

vi.mock("./selection.ts", () => ({
  selectSearchResults: mocks.selectSearchResults,
}))

vi.mock("./summaries.ts", () => ({
  startPageSummary: mocks.startPageSummary,
}))

vi.mock("./querySummaries.ts", () => ({
  summarizeSearchQuery: mocks.summarizeSearchQuery,
}))

import { deepSearch, type DeepSearchEvent } from "./index.ts"

const ignoreEvent = (_event: DeepSearchEvent) => undefined

const results = [
  {
    title: "Result",
    shortText: "Useful result",
    link: "https://example.com/result",
  },
]

describe("deepSearch", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.generateSearchResults.mockResolvedValue([
      { query: "test query", results },
    ])
    mocks.selectSearchResults.mockResolvedValue({
      query: "test query",
      results,
      selectedLinks: ["https://example.com/result"],
    })
    mocks.startPageSummary.mockResolvedValue("Completed page summary")
    mocks.summarizeSearchQuery.mockResolvedValue("query-summary-stream-id")
    mocks.collectStreamText.mockResolvedValue("Completed query summary")
    mocks.answerResearchRequest.mockResolvedValue("final-answer-stream-id")
  })

  it("emits pipeline progress through one event callback", async () => {
    const events: DeepSearchEvent[] = []
    mocks.generateSearchResults.mockImplementationOnce(
      (input: { onEvent: (event: DeepSearchEvent) => void }) => {
        input.onEvent({ type: "query-stream", streamId: "query-stream-id" })
        return Promise.resolve([{ query: "test query", results }])
      },
    )
    mocks.selectSearchResults.mockImplementationOnce(
      (input: { onEvent: (event: DeepSearchEvent) => void }) => {
        input.onEvent({
          type: "selection-stream",
          query: "test query",
          streamId: "selection-stream-id",
        })
        return Promise.resolve({
          query: "test query",
          results,
          selectedLinks: ["https://example.com/result"],
        })
      },
    )
    mocks.startPageSummary.mockImplementationOnce(
      (input: { onEvent: (event: DeepSearchEvent) => void }) => {
        input.onEvent({
          type: "page-summary-stream",
          url: "https://example.com/result",
          streamId: "summary-stream-id",
        })
        return Promise.resolve()
      },
    )

    await expect(
      deepSearch({
        researchRequest: "Research this",
        onEvent: (event) => {
          events.push(event)
        },
      }),
    ).resolves.toBeUndefined()

    expect(events).toEqual([
      { type: "query-stream", streamId: "query-stream-id" },
      {
        type: "search-results",
        searches: [{ query: "test query", results }],
      },
      {
        type: "selection-stream",
        query: "test query",
        streamId: "selection-stream-id",
      },
      {
        type: "selected-search-results",
        query: "test query",
        selectedLinks: ["https://example.com/result"],
      },
      {
        type: "page-summary-stream",
        url: "https://example.com/result",
        streamId: "summary-stream-id",
      },
      {
        type: "query-summary-stream",
        query: "test query",
        streamId: "query-summary-stream-id",
      },
      {
        type: "final-answer-stream",
        streamId: "final-answer-stream-id",
      },
    ])
  })

  it("generates an explicit final answer when no searches are returned", async () => {
    mocks.generateSearchResults.mockResolvedValueOnce([])

    await deepSearch({ researchRequest: "Research this", onEvent: ignoreEvent })

    expect(mocks.selectSearchResults).not.toHaveBeenCalled()
    expect(mocks.startPageSummary).not.toHaveBeenCalled()
    expect(mocks.summarizeSearchQuery).not.toHaveBeenCalled()
    expect(mocks.answerResearchRequest).toHaveBeenCalledWith({
      researchRequest: "Research this",
      searchSummaries: [],
    })
  })

  it("passes configured limits to each pipeline stage", async () => {
    await deepSearch({
      researchRequest: "Research this",
      maxSearches: 5,
      maxResultsPerSearch: 2,
      onEvent: ignoreEvent,
    })

    expect(mocks.generateSearchResults).toHaveBeenCalledWith(
      expect.objectContaining({ maxSearches: 5 }),
    )
    expect(mocks.selectSearchResults).toHaveBeenCalledWith(
      expect.objectContaining({ maxResultsPerSearch: 2 }),
    )
  })

  it("passes the retry policy to every model-backed stage", async () => {
    await deepSearch({
      researchRequest: "Research this",
      maxRetries: 0,
      onEvent: ignoreEvent,
    })

    for (const modelStage of [
      mocks.generateSearchResults,
      mocks.selectSearchResults,
      mocks.startPageSummary,
      mocks.summarizeSearchQuery,
      mocks.answerResearchRequest,
    ]) {
      expect(modelStage).toHaveBeenCalledWith(
        expect.objectContaining({ maxRetries: 0 }),
      )
    }
  })

  it("starts a summary only once for duplicate selected URLs", async () => {
    mocks.generateSearchResults.mockResolvedValueOnce([
      { query: "first query", results },
      { query: "second query", results },
    ])
    mocks.selectSearchResults
      .mockResolvedValueOnce({
        query: "first query",
        results,
        selectedLinks: ["https://example.com/result"],
      })
      .mockResolvedValueOnce({
        query: "second query",
        results,
        selectedLinks: ["https://example.com/result"],
      })

    await deepSearch({ researchRequest: "Research this", onEvent: ignoreEvent })

    expect(mocks.startPageSummary).toHaveBeenCalledTimes(1)
    expect(mocks.summarizeSearchQuery).toHaveBeenCalledTimes(2)
    expect(mocks.answerResearchRequest).toHaveBeenCalledWith({
      researchRequest: "Research this",
      searchSummaries: [
        { query: "first query", content: "Completed query summary" },
        { query: "second query", content: "Completed query summary" },
      ],
    })
  })

  it("waits for page summary text before starting the query summary", async () => {
    const completion = Promise.withResolvers<string | undefined>()
    mocks.startPageSummary.mockReturnValueOnce(completion.promise)
    let completed = false

    const run = deepSearch({
      researchRequest: "Research this",
      onEvent: ignoreEvent,
    }).then(() => {
      completed = true
    })
    await Promise.resolve()

    expect(completed).toBe(false)
    expect(mocks.summarizeSearchQuery).not.toHaveBeenCalled()
    completion.resolve("Completed page summary")
    await run
    expect(completed).toBe(true)
    expect(mocks.summarizeSearchQuery).toHaveBeenCalled()
  })

  it("uses page summaries when available and descriptions as fallback", async () => {
    const mixedResults = [
      {
        title: "Explored result",
        shortText: "Explored result description",
        link: "https://example.com/explored",
      },
      {
        title: "Failed result",
        shortText: "Failed result description",
        link: "https://example.com/failed",
      },
      {
        title: "Unselected result",
        shortText: "Unselected result description",
        link: "https://example.com/unselected",
      },
    ]
    mocks.generateSearchResults.mockResolvedValueOnce([
      { query: "mixed query", results: mixedResults },
    ])
    mocks.selectSearchResults.mockResolvedValueOnce({
      query: "mixed query",
      results: mixedResults,
      selectedLinks: [
        "https://example.com/explored",
        "https://example.com/failed",
      ],
    })
    mocks.startPageSummary.mockImplementation(
      ({ url }: { url: string }) =>
        Promise.resolve(
          url === "https://example.com/explored"
            ? "Full explored-page summary"
            : undefined,
        ),
    )

    await deepSearch({ researchRequest: "Research this", onEvent: ignoreEvent })

    expect(mocks.summarizeSearchQuery).toHaveBeenCalledWith({
      researchRequest: "Research this",
      query: "mixed query",
      results: [
        {
          title: "Explored result",
          url: "https://example.com/explored",
          content: "Full explored-page summary",
        },
        {
          title: "Failed result",
          url: "https://example.com/failed",
          content: "Failed result description",
        },
        {
          title: "Unselected result",
          url: "https://example.com/unselected",
          content: "Unselected result description",
        },
      ],
    })
  })

  it("waits for every query summary before starting the final answer", async () => {
    const completion = Promise.withResolvers<string>()
    mocks.collectStreamText.mockReturnValueOnce(completion.promise)

    const run = deepSearch({
      researchRequest: "Research this",
      onEvent: ignoreEvent,
    })
    await Promise.resolve()
    await Promise.resolve()

    expect(mocks.answerResearchRequest).not.toHaveBeenCalled()
    completion.resolve("Top-level findings")
    await run

    expect(mocks.answerResearchRequest).toHaveBeenCalledWith({
      researchRequest: "Research this",
      searchSummaries: [
        { query: "test query", content: "Top-level findings" },
      ],
    })
  })
})
