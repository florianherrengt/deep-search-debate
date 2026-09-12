import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({ generateTextStream: vi.fn() }))

vi.mock("../../llms/generateText.ts", () => ({
  generateTextStream: mocks.generateTextStream,
}))

import { summarizeSearchQuery } from "./querySummaries.ts"
import { config } from "../../config.ts"

function completedGeneration(text = "Completed query summary") {
  return {
    id: "query-summary-stream-id",
    completion: Promise.resolve({
      status: "completed" as const,
      text,
      reasoning: "",
    }),
  }
}

describe("query summaries", () => {
  beforeEach(() => vi.clearAllMocks())

  it("distinguishes explored-page evidence from search snippets", async () => {
    mocks.generateTextStream.mockResolvedValueOnce(completedGeneration())

    const generation = await summarizeSearchQuery({
      userId: "test-user-id",
      deepSearchJobId: "deep-search-job-id",
      researchRequest: "Find the best longboard for a beginner",
      query: "best beginner longboards",
      results: [
        {
          title: "Beginner boards",
          url: "https://example.com/beginners",
          content: "A detailed summary of the explored page.",
          evidenceType: "page-summary",
        },
        {
          title: "Cruising boards",
          url: "https://example.com/cruising",
          content: "Search result description for cruising boards.",
          evidenceType: "search-snippet",
        },
      ],
    })

    expect(mocks.generateTextStream).toHaveBeenCalledWith({
      userId: "test-user-id",
      owner: { deepSearchJobId: "deep-search-job-id" },
      prompt: [
        "user_query: Find the best longboard for a beginner",
        "search_query: best beginner longboards",
        "results:",
        "<results>",
        "<source_evidence>",
        JSON.stringify({
          url: "https://example.com/beginners",
          title: "Beginner boards",
          evidenceType: "page-summary",
        }),
        "Content:",
        "A detailed summary of the explored page.",
        "</source_evidence>",
        "",
        "<source_evidence>",
        JSON.stringify({
          url: "https://example.com/cruising",
          title: "Cruising boards",
          evidenceType: "search-snippet",
        }),
        "Content:",
        "Search result description for cruising boards.",
        "</source_evidence>",
        "</results>",
      ].join("\n"),
      promptName: "summarize-search-query",
      reasoning: "disabled",
    })
    expect(generation.streamId).toBe("query-summary-stream-id")
    await expect(generation.summary).resolves.toBe("Completed query summary")
  })

  it("retains every source URL and evidence type when result content is truncated", async () => {
    mocks.generateTextStream.mockResolvedValueOnce(completedGeneration())
    await summarizeSearchQuery({
      userId: "test-user-id",
      deepSearchJobId: "deep-search-job-id",
      researchRequest: "Compare the published terms",
      query: "published terms",
      results: [
        {
          title: "Terms",
          url: "https://example.com/terms?version=2026-09",
          evidenceType: "page-summary",
          content: "A published qualification. ".repeat(10_000),
        },
        {
          title: "Other terms",
          url: "https://other.example.com/terms",
          evidenceType: "search-snippet",
          content: "An unverified search description. ".repeat(10_000),
        },
      ],
    })

    const { prompt } = mocks.generateTextStream.mock.calls[0]?.[0] as { prompt: string }
    const context = /<results>\n([\s\S]*)\n<\/results>/.exec(prompt)?.[1]
    expect(context?.length).toBeLessThanOrEqual(config.deepSearch.maxSummaryContextChars)
    expect(context).toContain('"url":"https://example.com/terms?version=2026-09"')
    expect(context).toContain('"url":"https://other.example.com/terms"')
    expect(context).toContain('"evidenceType":"page-summary"')
    expect(context).toContain('"evidenceType":"search-snippet"')
    expect(context).toContain("[... omitted ...]")
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
