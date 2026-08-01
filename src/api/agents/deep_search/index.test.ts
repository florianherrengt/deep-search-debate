import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  generateSearchResults: vi.fn(),
  selectSearchResults: vi.fn(),
  startPageSummary: vi.fn(),
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
    mocks.startPageSummary.mockResolvedValue(undefined)
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
    ])
  })

  it("does nothing after query generation returns no searches", async () => {
    mocks.generateSearchResults.mockResolvedValueOnce([])

    await deepSearch({ researchRequest: "Research this", onEvent: ignoreEvent })

    expect(mocks.selectSearchResults).not.toHaveBeenCalled()
    expect(mocks.startPageSummary).not.toHaveBeenCalled()
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
  })

  it("waits until every summary stream has been registered", async () => {
    const registration = Promise.withResolvers<void>()
    mocks.startPageSummary.mockReturnValueOnce(registration.promise)
    let completed = false

    const run = deepSearch({
      researchRequest: "Research this",
      onEvent: ignoreEvent,
    }).then(() => {
      completed = true
    })
    await Promise.resolve()

    expect(completed).toBe(false)
    registration.resolve()
    await run
    expect(completed).toBe(true)
  })
})
