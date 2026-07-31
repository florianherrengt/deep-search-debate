import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  generateWebSearchQueries: vi.fn(),
  webSearch: vi.fn(),
  selectWebSearchResults: vi.fn(),
  webExtract: vi.fn(),
}))

vi.mock("../../llms/generateWebSearchQueries.ts", () => ({
  generateWebSearchQueries: mocks.generateWebSearchQueries,
}))

vi.mock("../../llms/selectWebSearchResults.ts", () => ({
  selectWebSearchResults: mocks.selectWebSearchResults,
}))

vi.mock("../../web_search/index.ts", () => ({
  webSearch: mocks.webSearch,
}))

vi.mock("../../web_search/webExtract.ts", () => ({
  webExtract: mocks.webExtract,
}))

import { deepSearch } from "./index.ts"

const mockResults = [
  { title: "Result 1", shortText: "Snippet 1", link: "https://example.com/1" },
  { title: "Result 2", shortText: "Snippet 2", link: "https://example.com/2" },
  { title: "Result 3", shortText: "Snippet 3", link: "https://example.com/3" },
]

describe("deepSearch", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("generates queries, searches, selects, and extracts", async () => {
    mocks.generateWebSearchQueries.mockResolvedValueOnce(["query one"])
    mocks.webSearch.mockResolvedValue(mockResults)
    mocks.selectWebSearchResults.mockResolvedValueOnce(["result-0", "result-2"])
    mocks.webExtract
      .mockResolvedValueOnce({ url: "https://example.com/1", content: "Page 1 content" })
      .mockResolvedValueOnce({ url: "https://example.com/3", content: "Page 3 content" })

    const results = await deepSearch({ researchRequest: "test topic" })

    expect(mocks.generateWebSearchQueries).toHaveBeenCalledWith({ researchRequest: "test topic" })
    expect(mocks.webSearch).toHaveBeenCalledWith({ query: "query one" })
    expect(mocks.selectWebSearchResults).toHaveBeenCalledWith({
      userQuery: "test topic",
      searchQuery: "query one",
      results: [
        { id: "result-0", title: "Result 1", url: "https://example.com/1", snippet: "Snippet 1" },
        { id: "result-1", title: "Result 2", url: "https://example.com/2", snippet: "Snippet 2" },
        { id: "result-2", title: "Result 3", url: "https://example.com/3", snippet: "Snippet 3" },
      ],
    })
    expect(mocks.webExtract).toHaveBeenCalledTimes(2)
    expect(results).toEqual([
      {
        query: "query one",
        results: mockResults,
        extractedPages: [
          { url: "https://example.com/1", content: "Page 1 content" },
          { url: "https://example.com/3", content: "Page 3 content" },
        ],
      },
    ])
  })

  it("returns empty extractedPages when nothing is selected", async () => {
    mocks.generateWebSearchQueries.mockResolvedValueOnce(["query one"])
    mocks.webSearch.mockResolvedValue(mockResults)
    mocks.selectWebSearchResults.mockResolvedValueOnce([])

    const results = await deepSearch({ researchRequest: "test" })

    expect(results[0].extractedPages).toEqual([])
    expect(mocks.webExtract).not.toHaveBeenCalled()
  })

  it("handles extraction failures gracefully", async () => {
    mocks.generateWebSearchQueries.mockResolvedValueOnce(["query one"])
    mocks.webSearch.mockResolvedValue([mockResults[0]])
    mocks.selectWebSearchResults.mockResolvedValueOnce(["result-0"])
    mocks.webExtract.mockRejectedValueOnce(new Error("extract failed"))

    const results = await deepSearch({ researchRequest: "test" })

    expect(results[0].extractedPages).toEqual([
      { url: "https://example.com/1", content: "" },
    ])
  })

  it("returns empty array when no queries are generated", async () => {
    mocks.generateWebSearchQueries.mockResolvedValueOnce([])

    const results = await deepSearch({ researchRequest: "empty" })

    expect(results).toEqual([])
    expect(mocks.webSearch).not.toHaveBeenCalled()
  })
})
