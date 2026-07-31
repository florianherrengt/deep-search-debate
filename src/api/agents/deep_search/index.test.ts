import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  generateWebSearchQueries: vi.fn(),
  webSearch: vi.fn(),
}))

vi.mock("../../llms/generateWebSearchQueries.ts", () => ({
  generateWebSearchQueries: mocks.generateWebSearchQueries,
}))

vi.mock("../../web_search/index.ts", () => ({
  webSearch: mocks.webSearch,
}))

import { deepSearch } from "./index.ts"

const mockResults = [
  { title: "Result 1", shortText: "Snippet 1", link: "https://example.com/1" },
  { title: "Result 2", shortText: "Snippet 2", link: "https://example.com/2" },
]

describe("deepSearch", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("generates queries and executes searches for each", async () => {
    mocks.generateWebSearchQueries.mockResolvedValueOnce(["query one", "query two"])
    mocks.webSearch.mockResolvedValue(mockResults)

    const results = await deepSearch({ researchRequest: "test topic" })

    expect(mocks.generateWebSearchQueries).toHaveBeenCalledWith({ researchRequest: "test topic" })
    expect(mocks.webSearch).toHaveBeenCalledTimes(2)
    expect(mocks.webSearch).toHaveBeenCalledWith({ query: "query one" })
    expect(mocks.webSearch).toHaveBeenCalledWith({ query: "query two" })
    expect(results).toEqual([
      { query: "query one", results: mockResults },
      { query: "query two", results: mockResults },
    ])
  })

  it("returns empty array when no queries are generated", async () => {
    mocks.generateWebSearchQueries.mockResolvedValueOnce([])

    const results = await deepSearch({ researchRequest: "empty topic" })

    expect(results).toEqual([])
    expect(mocks.webSearch).not.toHaveBeenCalled()
  })
})
