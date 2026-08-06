import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({ generateTextStream: vi.fn() }))

vi.mock("../../llms/generateText.ts", () => ({
  generateTextStream: mocks.generateTextStream,
}))

import { summarizeSearchQuery } from "./querySummaries.ts"

describe("query summaries", () => {
  beforeEach(() => vi.clearAllMocks())

  it("registers a synthesis stream with uniform result content", async () => {
    mocks.generateTextStream.mockResolvedValueOnce({
      id: "query-summary-stream-id",
    })

    const streamId = await summarizeSearchQuery({
      userId: "test-user-id",
      deepSearchJobId: "deep-search-job-id",
      researchRequest: "Find the best longboard for a beginner",
      query: "best beginner longboards",
      results: [
        {
          title: "Beginner boards",
          url: "https://example.com/beginners",
          content: "A detailed summary of the explored page.",
        },
        {
          title: "Cruising boards",
          url: "https://example.com/cruising",
          content: "Search result description for cruising boards.",
        },
      ],
      maxRetries: 0,
    })

    expect(mocks.generateTextStream).toHaveBeenCalledWith({
      userId: "test-user-id",
      owner: { deepSearchJobId: "deep-search-job-id" },
      prompt: [
        "user_query: Find the best longboard for a beginner",
        "search_query: best beginner longboards",
        "results:",
        "<results>",
        "<result>",
        "Title: Beginner boards",
        "URL: https://example.com/beginners",
        "Content:",
        "A detailed summary of the explored page.",
        "</result>",
        "",
        "<result>",
        "Title: Cruising boards",
        "URL: https://example.com/cruising",
        "Content:",
        "Search result description for cruising boards.",
        "</result>",
        "</results>",
      ].join("\n"),
      promptName: "summarize-search-query",
      maxRetries: 0,
    })
    expect(streamId).toBe("query-summary-stream-id")
  })

  it("propagates stream registration failures", async () => {
    mocks.generateTextStream.mockRejectedValueOnce(
      new Error("Stream registration failed"),
    )

    await expect(
      summarizeSearchQuery({
        userId: "test-user-id",
        deepSearchJobId: "deep-search-job-id",
        researchRequest: "Research this",
        query: "search this",
        results: [],
      }),
    ).rejects.toThrow("Stream registration failed")
  })
})
